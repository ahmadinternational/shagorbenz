#!/usr/bin/env node
// SHAGORBENZ supplier catalog importer — runs on YOUR machine / CI, never in the browser.
//
//   node --env-file=.env.supplier scripts/supplier/import.mjs import --file catalog.json --dry-run
//   node --env-file=.env.supplier scripts/supplier/import.mjs import --file catalog.json --complete
//   node scripts/supplier/import.mjs validate --file catalog.json          (no database needed)
//   node --env-file=.env.supplier scripts/supplier/import.mjs report
//
// Input is an export you are AUTHORIZED to use (reseller panel / official feed). This tool does not scrape.
// Environment: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY. Run `import.mjs help` for flags.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseFeed, normalizeProduct } from './lib/feed.mjs';
import { runImport, DEFAULTS } from './lib/engine.mjs';
import { createSupabaseRepo } from './lib/repo-supabase.mjs';
import { summariseFailures } from './lib/explain.mjs';

const SUPPLIER = 'badhons-world';
const STATE_DIR = path.resolve('.supplier-state');

const { positionals, values: v } = parseArgs({
    allowPositionals: true,
    options: {
        file: { type: 'string' }, supplier: { type: 'string', default: SUPPLIER }, mode: { type: 'string', default: 'all' },
        'dry-run': { type: 'boolean' }, complete: { type: 'boolean' }, force: { type: 'boolean' },
        'sync-prices': { type: 'boolean' }, 'sync-images': { type: 'boolean' }, 'sync-content': { type: 'boolean' }, 'no-sync-stock': { type: 'boolean' },
        'markup-percent': { type: 'string', default: '0' }, 'category-map': { type: 'string' }, priority: { type: 'string', default: String(DEFAULTS.priority) },
        batch: { type: 'string', default: String(DEFAULTS.batchSize) }, 'delay-ms': { type: 'string', default: String(DEFAULTS.delayMs) },
        limit: { type: 'string' }, resume: { type: 'string' }, 'retry-failed': { type: 'boolean' }, 'verify-images': { type: 'boolean' },
        'missing-threshold': { type: 'string', default: String(DEFAULTS.missingThreshold) }, help: { type: 'boolean' }
    }
});
const command = positionals[0] || 'help';

const HELP = `
SHAGORBENZ supplier importer

  import    read a supplier export and create/update products
  validate  check the export only (no database, no credentials)
  report    last runs, open errors and mapping counts

import flags
  --file <path>            .json | .jsonl | .csv  (required)
  --mode all|new|update    all = create + update (default) · new = only create · update = only update existing
  --dry-run                read-only: shows what WOULD happen
  --complete               the file is the WHOLE catalog → enables "no longer listed" detection (needs ${DEFAULTS.missingThreshold} such runs)
  --sync-prices            move the selling price when the supplier price changed (never over a hand-edited price)
  --sync-images            refresh main + gallery images (never over hand-edited ones)
  --sync-content           refresh title/description/category/brand/sku/specs/options (never over hand-edited fields)
  --no-sync-stock          do not touch availability
  --markup-percent N       optional pricing rule applied to supplier prices (default 0 = supplier price exactly)
  --category-map file.json { "Supplier Category": "SHAGORBENZ Category" }
  --priority N             storefront sort priority for new products (default ${DEFAULTS.priority}; smaller = earlier)
  --batch N --delay-ms N   batch size (default ${DEFAULTS.batchSize}) and pause between batches (default ${DEFAULTS.delayMs})
  --limit N                process only the first N rows (partial run)
  --resume <runId>         continue an interrupted run   --retry-failed   re-process products that failed before
  --verify-images          HEAD-check image URLs (slow; 2 at a time)   --force   re-process unchanged products
`;

const num = (s, name) => {
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a non-negative number`);
    return n;
};
const log = (...a) => console.log(...a);

function readFeed(file) {
    if (!file) throw new Error('--file is required');
    const raw = parseFeed(fs.readFileSync(file, 'utf8'), file);
    const records = [], rejected = [];
    for (const row of raw) {
        const r = normalizeProduct(row, { supplier: v.supplier });
        (r.ok ? records : rejected).push(r.ok ? r.record : r);
    }
    return { rawCount: raw.length, records, rejected };
}

function printStats(s) {
    log(`  discovered ${s.discovered} · processed ${s.processed} · inserted ${s.inserted} · updated ${s.updated} · skipped ${s.skipped} (unchanged ${s.unchanged}) · failed ${s.failed} · duplicates prevented ${s.duplicatesPrevented}`);
    if (s.preservedEdits || s.newlyUnavailable || s.detached) log(`  hand-edits preserved ${s.preservedEdits} · newly unavailable ${s.newlyUnavailable} · deleted-locally skipped ${s.detached}`);
}

async function main() {
    if (command === 'help' || v.help) return log(HELP);

    if (command === 'validate') {
        const { rawCount, records, rejected } = readFeed(v.file);
        const ids = new Set(records.map((r) => r.supplierProductId));
        log(`rows: ${rawCount} · valid: ${records.length} · rejected: ${rejected.length} · unique ids: ${ids.size} · in-file duplicates: ${records.length - ids.size}`);
        const cats = new Map();
        for (const r of records) cats.set(r.supplierCategory || '(none)', (cats.get(r.supplierCategory || '(none)') || 0) + 1);
        log(`categories: ${cats.size}  ·  with variants: ${records.filter((r) => r.variants.length).length}  ·  with brand: ${records.filter((r) => r.brand).length}  ·  with sku: ${records.filter((r) => r.sku).length}`);
        rejected.slice(0, 20).forEach((r) => log(`  ✗ ${r.supplier_product_id ?? '(no id)'}: ${r.error}`));
        if (rejected.length > 20) log(`  … and ${rejected.length - 20} more`);
        return void (process.exitCode = rejected.length ? 2 : 0);
    }

    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const repo = createSupabaseRepo({ url, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
    await repo.preflight(); // stops here with a plain explanation if the key is wrong or the migration has not been run

    if (command === 'report') {
        const { runs, mappings, openErrors } = await repo.report(v.supplier);
        const count = (key, val) => mappings.filter((m) => m[key] === val).length;
        log(`${v.supplier}: ${mappings.length} mapped products (in stock ${count('supplier_stock_status', 'in_stock')}, out of stock ${count('supplier_stock_status', 'out_of_stock')}, unavailable ${count('supplier_stock_status', 'unavailable')}) · open errors: ${openErrors ?? 0}`);
        for (const r of runs) log(`  ${r.started_at}  ${r.status.padEnd(9)} ${r.mode.padEnd(6)} discovered ${r.total_discovered} inserted ${r.inserted} updated ${r.updated} skipped ${r.skipped} failed ${r.failed} dup ${r.duplicates_prevented}  [${r.id}]`);
        return;
    }
    if (command !== 'import') throw new Error(`unknown command "${command}" (try: help)`);

    const { rawCount, records, rejected } = readFeed(v.file);
    log(`feed: ${rawCount} rows → ${records.length} valid, ${rejected.length} rejected`);
    if (!records.length && !rejected.length) throw new Error('the file contains no products');

    let limited = false, rows = records;
    if (v.limit) (rows = records.slice(0, num(v.limit, 'limit')), (limited = true));
    fs.mkdirSync(STATE_DIR, { recursive: true });

    // one importer at a time: a live "running" row in the database, or a lock file with a live PID
    const lock = path.join(STATE_DIR, 'lock');
    if (!v['dry-run']) {
        const running = await repo.findRunningRun(v.supplier);
        if (running) throw new Error(`another import is marked running (run ${running.id}, started ${running.started_at}). If it crashed, wait 6 h or set its status to 'aborted'.`);
        if (fs.existsSync(lock)) {
            const pid = Number(fs.readFileSync(lock, 'utf8'));
            try { process.kill(pid, 0); throw new Error(`another importer (pid ${pid}) is running on this machine`); } catch (e) { if (e.code !== 'ESRCH') throw e; }
        }
        fs.writeFileSync(lock, String(process.pid));
    }
    const release = () => { try { fs.unlinkSync(lock); } catch { /* already gone */ } };
    process.on('exit', release);
    process.on('SIGINT', () => { log('\ninterrupted — progress is saved; continue with --resume'); process.exit(130); });

    const options = {
        mode: v.mode, batchSize: num(v.batch, 'batch'), delayMs: num(v['delay-ms'], 'delay-ms'), markupPercent: num(v['markup-percent'], 'markup-percent'),
        priority: num(v.priority, 'priority'), syncStock: !v['no-sync-stock'], syncPrices: !!v['sync-prices'], syncImages: !!v['sync-images'], syncContent: !!v['sync-content'],
        force: !!v.force, complete: !!v.complete, dryRun: !!v['dry-run'], missingThreshold: num(v['missing-threshold'], 'missing-threshold'), limited,
        categoryMap: v['category-map'] ? JSON.parse(fs.readFileSync(v['category-map'], 'utf8')) : {}
    };
    if (!['all', 'new', 'update'].includes(options.mode)) throw new Error('--mode must be all, new or update');
    if (v.complete && limited) log('note: --limit makes this a partial run, so --complete is ignored (no removal detection).');

    if (v['retry-failed']) {
        options.onlyIds = new Set(await repo.openErrorIds(v.supplier));
        log(`retrying ${options.onlyIds.size} product(s) with open errors`);
    }
    let stateFile = null, done = new Set();
    if (v.resume) {
        stateFile = path.join(STATE_DIR, `${v.resume}.json`);
        if (!fs.existsSync(stateFile)) throw new Error(`no saved state for run ${v.resume}`);
        done = new Set(JSON.parse(fs.readFileSync(stateFile, 'utf8')).done);
        options.skipIds = done;
        log(`resuming: ${done.size} products already processed`);
    }
    if (v['verify-images']) {
        let last = 0;
        options.verifyImage = async (u) => {
            const wait = Math.max(0, last + 350 - Date.now()); // ≈ 3 requests / second, one at a time
            if (wait) await new Promise((r) => setTimeout(r, wait));
            last = Date.now();
            try { return (await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(10000) })).ok; } catch { return false; }
        };
    }

    log(options.dryRun ? '— DRY RUN: nothing will be written —' : `importing into ${new URL(url).host} …`);
    const result = await runImport({
        repo, supplier: v.supplier, records: rows, rejected, options, log,
        onBatch: ({ stats, ids }) => {
            ids.forEach((id) => done.add(id));
            log(`  batch done · ${stats.processed}/${stats.discovered}  (inserted ${stats.inserted}, updated ${stats.updated}, skipped ${stats.skipped}, failed ${stats.failed})`);
            if (!options.dryRun) fs.writeFileSync(stateFile || (stateFile = path.join(STATE_DIR, `pending.json`)), JSON.stringify({ done: [...done] }));
        }
    });
    if (result.runId && stateFile?.endsWith('pending.json')) fs.renameSync(stateFile, path.join(STATE_DIR, `${result.runId}.json`));
    if (!options.dryRun && result.failures.length === 0 && options.onlyIds) await repo.resolveErrors(v.supplier, [...options.onlyIds]);
    log('\nresult' + (result.runId ? ` (run ${result.runId})` : ' (dry run)'));
    printStats(result.stats);
    if (result.failures.length) {
        log(`  ${result.failures.length} failure(s), grouped:`);
        for (const g of summariseFailures(result.failures)) log(`   ✗ ×${g.count}  ${g.key}   (e.g. ${g.example})`);
        log('  retry them with: --retry-failed');
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error(`\n✗ ${err.message}`);
    process.exitCode = 1;
});
