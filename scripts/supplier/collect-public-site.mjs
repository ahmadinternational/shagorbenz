#!/usr/bin/env node
// Collects the PUBLIC product pages of badhonsworld.com the way a visitor sees them and writes a feed file
// for scripts/supplier/import.mjs. It reads only what is rendered on the pages:
//   • no login, no reseller panel, no CAPTCHA/Cloudflare tricks, and it never calls the site's JSON API itself
//   • one page at a time with a pause (default 2 s), images/fonts are NOT downloaded (only their addresses are read)
//   • resumable: every collected page is cached in <out>/raw, so a re-run only fetches what is missing
// Images are kept as the supplier's own URLs (watermark untouched); nothing is re-hosted or edited.
//
// Needs a browser driver that is not a project dependency:  npm i --no-save playwright-core
// and Chrome/Chromium (CHROME_PATH, default /usr/bin/google-chrome).
//
//   node scripts/supplier/collect-public-site.mjs --out supplier-feeds [--limit 3] [--delay-ms 2000]
//
// --reseller: signs in ONCE with YOUR OWN reseller account (env SUPPLIER_LOGIN / SUPPLIER_PASSWORD — never written
// to disk, never logged) and re-reads the same product pages, which then also show the buy rate, commission and
// minimum selling price. Read-only: it only opens product pages, then signs out. The pages go to <out>/raw-reseller.
// Note: the supplier's reseller terms forbid sharing panel access with others — you are responsible for using your own login.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: v } = parseArgs({
    options: { out: { type: 'string', default: 'supplier-feeds' }, limit: { type: 'string' }, 'delay-ms': { type: 'string', default: '2000' }, 'list-only': { type: 'boolean' }, reseller: { type: 'boolean' } }
});
const BASE = 'https://badhonsworld.com';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 SHAGORBENZ-reseller-catalog/1.0';
const delay = Number(v['delay-ms']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = path.join(v.out, v.reseller ? 'raw-reseller' : 'raw');
fs.mkdirSync(RAW, { recursive: true });

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
// We only need the page text and the image ADDRESSES — do not pull image/font/media bytes from the supplier.
await context.route('**/*', (route) => (['image', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.continue()));
const page = await context.newPage();

async function signIn() {
    const { SUPPLIER_LOGIN: user, SUPPLIER_PASSWORD: pass } = process.env;
    if (!user || !pass) throw new Error('set SUPPLIER_LOGIN and SUPPLIER_PASSWORD in the environment (not on disk)');
    await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('input[name="username"]', { timeout: 30000 });
    if (await page.locator('iframe[src*="captcha" i], iframe[src*="turnstile" i], .cf-turnstile, .g-recaptcha').count()) throw new Error('a CAPTCHA is shown — stopping (it is never bypassed)');
    await page.fill('input[name="username"]', user);
    await page.fill('input[name="password"]', pass);
    await page.click('button:has-text("Sign In")');
    await page.waitForURL(/seller|my-account/, { timeout: 30000 }).catch(() => {});
    const signedIn = await page.evaluate(() => /লগ আউট|Log ?out/i.test(document.body.innerText));
    if (!signedIn) throw new Error('sign-in did not succeed (wrong credentials, or the site asked for something else) — stopping');
    console.log('signed in to the reseller account');
}
async function signOut() {
    await page.goto(`${BASE}/seller/my-account`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.locator('text=লগ আউট').first().click({ timeout: 5000 }).catch(() => {});
    console.log('signed out');
}

try {
    if (v.reseller) await signIn();
    // 1 · list: scroll the shop exactly like a visitor until no more products appear
    const listFile = path.join(v.out, 'list.json');
    let list;
    if (fs.existsSync(listFile)) list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
    else {
        await page.goto(`${BASE}/shop`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('a[href^="/products/"]', { timeout: 30000 });
        const count = () => page.evaluate(() => new Set([...document.querySelectorAll('a[href^="/products/"]')].map((a) => a.getAttribute('href').split('?')[0])).size);
        let last = await count(), stable = 0;
        for (let round = 0; stable < 4 && round < 200; round++) {
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            await sleep(1800);
            const c = await count();
            stable = c === last ? stable + 1 : 0;
            last = c;
            console.log(`  listing: ${c} products`);
        }
        list = await page.evaluate(() => {
            const seen = new Map();
            for (const a of document.querySelectorAll('a[href^="/products/"]')) {
                const href = a.getAttribute('href');
                const id = href.split('?')[0].split('/')[2];
                if (!id || seen.has(id)) continue;
                seen.set(id, { id, name: new URL(href, location.origin).searchParams.get('name') || '' });
            }
            return [...seen.values()];
        });
        fs.writeFileSync(listFile, JSON.stringify(list, null, 1));
    }
    console.log(`discovered ${list.length} products in the public shop`);
    if (v['list-only']) process.exit(0);

    // 2 · details: one product page at a time
    const todo = v.limit ? list.slice(0, Number(v.limit)) : list;
    let done = 0, failed = 0;
    for (const item of todo) {
        const file = path.join(RAW, `${item.id}.json`);
        if (fs.existsSync(file)) { done++; continue; }
        try {
            await page.goto(`${BASE}/products/${item.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForFunction(() => /Quantity|Description/.test(document.body.innerText) && !!document.querySelector('h1,h2'), null, { timeout: 30000 });
            await sleep(900); // let the gallery and description render
            const data = await page.evaluate(() => ({
                url: location.href,
                headings: [...document.querySelectorAll('h1,h2')].map((h) => h.textContent.trim()),
                text: document.body.innerText,
                images: [...document.querySelectorAll('img')].map((i) => ({ src: i.getAttribute('src') || '', alt: i.alt || '' }))
            }));
            fs.writeFileSync(file, JSON.stringify({ ...item, collectedAt: new Date().toISOString(), ...data }));
            done++;
            console.log(`  [${done}/${todo.length}] ${item.id} ${(item.name || data.headings[2] || '').slice(0, 60)}`);
        } catch (err) {
            failed++;
            console.log(`  ✗ ${item.id}: ${err.message.split('\n')[0]}`);
        }
        await sleep(delay);
    }
    console.log(`\ncollected ${done}/${todo.length} (${failed} failed). Raw pages: ${RAW}`);
    if (v.reseller) await signOut();
} finally {
    await browser.close();
}
