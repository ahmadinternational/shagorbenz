#!/usr/bin/env node
// Builds the importer feed from the pages saved by collect-public-site.mjs.
//   node scripts/supplier/build-feed.mjs --dir supplier-feeds
// Writes <dir>/badhons-world.json (feed for `import.mjs`) and <dir>/build-report.json (what was kept / refused and why).

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseProductPage, parseResellerPrices } from './lib/public-page.mjs';
import { compileRules, categorize } from './lib/categories.mjs';
import { chooseSellingPrice } from './lib/pricing.mjs';

const { values: v } = parseArgs({
    options: {
        dir: { type: 'string', default: 'supplier-feeds' },
        rules: { type: 'string', default: 'scripts/supplier/category-rules.json' },
        // which price becomes the shop's INITIAL selling price (change prices in the admin panel afterwards):
        //   lowest (default) = the lower of public / reseller price, never below the supplier's minimum selling price
        //   reseller · public — see lib/pricing.mjs
        'selling-price': { type: 'string', default: 'lowest' },
        // The supplier's "previous price" is ITS list price — this shop never charged it, so it is not shown as a discount unless you ask.
        'keep-old-price': { type: 'boolean' }
    }
});
if (!['lowest', 'reseller', 'public'].includes(v['selling-price'])) throw new Error('--selling-price must be lowest, reseller or public');
const raw = path.join(v.dir, 'raw');
const rawReseller = path.join(v.dir, 'raw-reseller');
const rules = compileRules(JSON.parse(fs.readFileSync(v.rules, 'utf8')));
const listed = JSON.parse(fs.readFileSync(path.join(v.dir, 'list.json'), 'utf8'));

const rows = [], refused = [], missing = [];
const priceSource = {};
for (const item of listed) {
    const file = path.join(raw, `${item.id}.json`);
    if (!fs.existsSync(file)) { missing.push(item.id); continue; }
    const parsed = parseProductPage(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (!parsed.ok) { refused.push({ id: item.id, reason: parsed.error }); continue; }
    const category = categorize(parsed.row.title, rules);
    const row = { ...parsed.row, ...(category ? { storefront_category: category } : {}) };
    // buy rate & minimum selling price (private) — from the signed-in reseller page, when it was collected
    const resellerFile = path.join(rawReseller, `${item.id}.json`);
    const rp = fs.existsSync(resellerFile) ? parseResellerPrices(JSON.parse(fs.readFileSync(resellerFile, 'utf8'))) : null;
    row.public_price = row.price;
    if (rp) {
        row.supplier_price = rp.buyRate;
        if (rp.minSellingPrice !== null) row.min_selling_price = rp.minSellingPrice;
        row.reseller_price = rp.shownPrice;
    }
    const chosen = chooseSellingPrice({ policy: v['selling-price'], publicPrice: row.public_price, resellerPrice: rp?.shownPrice, minPrice: rp?.minSellingPrice });
    if (chosen) { row.price = chosen.price; priceSource[chosen.source] = (priceSource[chosen.source] || 0) + 1; }
    if (!v['keep-old-price'] || (row.regular_price && row.regular_price <= row.price)) delete row.regular_price;
    rows.push(row);
}
const byCategory = {};
for (const r of rows) byCategory[r.storefront_category || '(no rule → Other)'] = (byCategory[r.storefront_category || '(no rule → Other)'] || 0) + 1;
const report = {
    listedInShop: listed.length, collectedPages: listed.length - missing.length, missingPages: missing,
    feedRows: rows.length, refused,
    withVariants: rows.filter((r) => r.variants.length).length, withBrand: rows.filter((r) => r.brand).length,
    withSpecifications: rows.filter((r) => r.specifications.length).length, withOldPrice: rows.filter((r) => r.regular_price).length,
    stock: { in_stock: rows.filter((r) => r.stock_status === 'in_stock').length, out_of_stock: rows.filter((r) => r.stock_status === 'out_of_stock').length, unknown: rows.filter((r) => r.stock_status === 'unknown').length },
    imagesTotal: rows.reduce((s, r) => s + r.images.length, 0), noImage: rows.filter((r) => !r.images.length).map((r) => r.supplier_product_id),
    pricing: {
        initialSellingPrice: v['selling-price'], priceSource, withBuyRate: rows.filter((r) => r.supplier_price !== undefined).length,
        belowMinimumSellingPrice: rows.filter((r) => r.min_selling_price && r.price < r.min_selling_price).map((r) => r.supplier_product_id),
        sellingBelowBuyRate: rows.filter((r) => r.supplier_price !== undefined && r.price < r.supplier_price).map((r) => r.supplier_product_id),
        resellerPriceDiffersFromPublic: rows.filter((r) => r.reseller_price && r.reseller_price !== r.public_price).length
    },
    // Listed on the supplier's site with "৳ 0" (buy rate 0, commission 0, minimum 0): not priced yet, so the importer refuses them.
    unpricedAtSupplier: rows.filter((r) => !r.price).map((r) => ({ id: r.supplier_product_id, title: r.title })),
    categories: byCategory,
    unmatchedTitles: rows.filter((r) => !r.storefront_category).map((r) => r.title)
};
fs.writeFileSync(path.join(v.dir, 'badhons-world.json'), JSON.stringify(rows, null, 1));
fs.writeFileSync(path.join(v.dir, 'build-report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, unmatchedTitles: report.unmatchedTitles.length }, null, 1));
