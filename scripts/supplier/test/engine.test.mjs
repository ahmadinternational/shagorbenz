import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProduct, parseFeed, canonicalUrl, parseMoney } from '../lib/feed.mjs';
import { runImport, sellingPrice } from '../lib/engine.mjs';
import { createMemoryRepo } from './memory-repo.mjs';
import { explainDbError, summariseFailures } from '../lib/explain.mjs';
import { createSupabaseRepo } from '../lib/repo-supabase.mjs';

const SUP = 'badhons-world';
const raw = (n, extra = {}) => ({
    supplier_product_id: `P${n}`, url: `https://shop.example/products/p${n}?utm_source=x`, title: `Product ${n}`, description: `Desc ${n}`,
    category: 'Gadgets', brand: 'Acme', sku: `SKU${n}`, price: 100 + n, regular_price: 150 + n,
    images: [`https://cdn.example/${n}-1.jpg`, `https://cdn.example/${n}-2.jpg`], stock_status: 'in stock', stock_quantity: 10, ...extra
});
const feed = (count, mut = () => ({})) => {
    const records = [], rejected = [];
    for (let n = 1; n <= count; n++) {
        const r = normalizeProduct({ ...raw(n), ...mut(n) }, { supplier: SUP });
        (r.ok ? records : rejected).push(r.ok ? r.record : r);
    }
    return { records, rejected };
};
const run = (repo, { records, rejected = [] }, options = {}) =>
    runImport({ repo, supplier: SUP, records, rejected, options: { delayMs: 0, ...options }, wait: async () => {} });

// ───────── feed normalisation ─────────
test('normalizeProduct: valid row keeps supplier data exactly and strips tracking params from the URL', () => {
    const r = normalizeProduct(raw(1), { supplier: SUP });
    assert.ok(r.ok);
    assert.equal(r.record.price, 101);
    assert.equal(r.record.regularPrice, 151);
    assert.equal(r.record.canonicalUrl, 'https://shop.example/products/p1');
    assert.deepEqual(r.record.images, ['https://cdn.example/1-1.jpg', 'https://cdn.example/1-2.jpg']);
    assert.equal(r.record.stockStatus, 'in_stock');
});
test('normalizeProduct: Bengali digits/currency and Bengali text are preserved', () => {
    assert.equal(parseMoney('৳ ১,২৯০.৫০'), 1290.5);
    const r = normalizeProduct(raw(2, { title: 'ওয়্যারলেস ইয়ারবাডস', description: 'বিস্তারিত বিবরণ\nদ্বিতীয় লাইন' }), { supplier: SUP });
    assert.equal(r.record.title, 'ওয়্যারলেস ইয়ারবাডস');
    assert.equal(r.record.description, 'বিস্তারিত বিবরণ\nদ্বিতীয় লাইন');
});
test('normalizeProduct: refuses rows that cannot be trusted (no id / price / image / title, bad URL)', () => {
    const bad = (patch) => normalizeProduct({ ...raw(3), ...patch }, { supplier: SUP });
    assert.equal(bad({ supplier_product_id: '' }).ok, false);
    assert.equal(bad({ price: 'abc' }).ok, false);
    assert.equal(bad({ price: 0 }).ok, false);
    assert.equal(bad({ images: [] }).ok, false);
    assert.equal(bad({ images: ['ftp://x/y.jpg', 'not a url'] }).ok, false);
    assert.equal(bad({ title: '  ' }).ok, false);
    assert.equal(bad({ url: 'javascript:alert(1)' }).ok, false);
});
test('normalizeProduct: variants stay inside ONE product; regular price below price is ignored', () => {
    const r = normalizeProduct(raw(4, { regular_price: 50, variants: [{ label: 'Black', price: 110 }, { label: 'White', stock: 0 }, { label: 'Black' }] }), { supplier: SUP });
    assert.equal(r.record.regularPrice, null);
    assert.deepEqual(r.record.variants.map((v) => v.label), ['Black', 'White', 'Black']);
    assert.equal(new Set(r.record.variants.map((v) => v.id)).size, 3, 'option ids are unique');
});
test('parseFeed: json / jsonl / csv', () => {
    assert.equal(parseFeed(JSON.stringify({ products: [raw(1)] }), 'x.json').length, 1);
    assert.equal(parseFeed(JSON.stringify(raw(1)) + '\n' + JSON.stringify(raw(2)) + '\n', 'x.jsonl').length, 2);
    const csv = 'supplier_product_id,title,price,images,description\nA1,"Name, with comma",199,https://c/1.jpg|https://c/2.jpg,"line1\nline2 ""quoted"""\n';
    const [row] = parseFeed(csv, 'x.csv');
    assert.equal(row.title, 'Name, with comma');
    assert.equal(row.description, 'line1\nline2 "quoted"');
    assert.equal(normalizeProduct(row, { supplier: SUP }).record.images.length, 2);
});
test('canonicalUrl', () => {
    assert.equal(canonicalUrl('HTTPS://Shop.Example/p/1/?utm_campaign=a&id=5#frag'), 'https://shop.example/p/1?id=5');
    assert.equal(canonicalUrl('https://shop.example/p/1'), canonicalUrl('https://shop.example/p/1/'));
    assert.equal(canonicalUrl('https://shop.example/'), 'https://shop.example');
    assert.equal(canonicalUrl('mailto:x@y.z'), null);
});

// ───────── duplicate prevention ─────────
test('first run inserts everything; an identical second run creates NO duplicates', async () => {
    const repo = createMemoryRepo();
    const a = await run(repo, feed(25));
    assert.equal(a.stats.inserted, 25);
    assert.equal(repo.db.products.length, 25);
    const b = await run(repo, feed(25));
    assert.equal(b.stats.inserted, 0);
    assert.equal(b.stats.unchanged, 25);
    assert.equal(repo.db.products.length, 25, 'still 25 products');
    assert.equal(repo.db.mappings.length, 25);
});
test('duplicates inside one file are imported once and counted', async () => {
    const repo = createMemoryRepo();
    const f = feed(5);
    f.records.push(f.records[0], { ...f.records[1] });
    f.records.push({ ...f.records[2], supplierProductId: 'OTHER-ID' }); // same URL, different id
    const r = await run(repo, f);
    assert.equal(r.stats.inserted, 5);
    assert.equal(r.stats.duplicatesPrevented, 3);
    assert.equal(repo.db.products.length, 5);
});
test('same URL already mapped under another supplier id → not created again', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(3));
    const f = feed(1, () => ({ supplier_product_id: 'NEW-ID-FOR-P1' })); // URL of P1
    const r = await run(repo, f);
    assert.equal(r.stats.inserted, 0);
    assert.equal(r.stats.duplicatesPrevented, 1);
    assert.equal(repo.db.products.length, 3);
});
test('a lost response after a committed insert (retry → unique violation) is a prevented duplicate, not a failure', async () => {
    const repo = createMemoryRepo();
    const f = feed(1);
    let calls = 0;
    const original = repo.insertProductWithMapping;
    repo.insertProductWithMapping = async (p, m) => {
        calls++;
        await original(p, m); // commits
        if (calls === 1) throw Object.assign(new Error('fetch failed'), { transient: true }); // …but the answer is lost
    };
    const r = await run(repo, f);
    assert.equal(repo.db.products.length, 1);
    assert.equal(r.stats.failed, 0);
    assert.equal(r.stats.duplicatesPrevented, 1);
});

// ───────── prices & manual edits ─────────
test('selling price equals the supplier price exactly unless a markup is configured', async () => {
    assert.equal(sellingPrice(1290.5, 0), 1290.5);
    assert.equal(sellingPrice(1000, 10), 1100);
    const repo = createMemoryRepo();
    await run(repo, feed(2));
    assert.equal(repo.db.products[0].price, 101);
    assert.equal(repo.db.mappings[0].supplier_price, 101);
});
test('a supplier price change updates ONLY the private supplier price by default', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(3));
    const r = await run(repo, feed(3, (n) => (n === 2 ? { price: 500, regular_price: 600 } : {})));
    assert.equal(r.stats.updated, 1);
    assert.equal(repo.db.mappings.find((m) => m.supplier_product_id === 'P2').supplier_price, 500);
    assert.equal(repo.db.products.find((p) => p.title === 'Product 2').price, 102, 'selling price untouched');
});
test('--sync-prices moves an untouched selling price but NEVER overwrites a hand-edited one', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(3));
    repo.db.products.find((p) => p.title === 'Product 3').price = 999; // an admin edited this price
    const r = await run(repo, feed(3, () => ({ price: 700 })), { syncPrices: true });
    assert.equal(repo.db.products.find((p) => p.title === 'Product 1').price, 700, 'untouched → follows supplier');
    assert.equal(repo.db.products.find((p) => p.title === 'Product 3').price, 999, 'hand-edited price preserved');
    assert.ok(r.stats.preservedEdits >= 1);
});
test('fields in manual_overrides are never overwritten by --sync-content / --sync-images', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(2));
    const p1 = repo.db.products.find((p) => p.title === 'Product 1');
    p1.title = 'My own title';
    p1.manual_overrides = { title: true, image: true };
    await run(repo, feed(2, () => ({ title: 'Supplier renamed', description: 'New desc', images: ['https://cdn.example/new.jpg'] })), { syncContent: true, syncImages: true });
    assert.equal(p1.title, 'My own title');
    assert.equal(p1.description, 'New desc', 'non-overridden field still syncs');
    assert.equal(p1.image, 'https://cdn.example/1-1.jpg', 'image override respected');
    assert.equal(repo.db.products.find((p) => p.title === 'Supplier renamed').description, 'New desc');
});
test('default sync never rewrites content, images or category of existing products', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(1));
    await run(repo, feed(1, () => ({ title: 'X', description: 'Y', category: 'Z', images: ['https://c/new.jpg'] })));
    const p = repo.db.products[0];
    assert.deepEqual([p.title, p.description, p.category, p.image], ['Product 1', 'Desc 1', 'Gadgets', 'https://cdn.example/1-1.jpg']);
});

// ───────── stock, variants, categories ─────────
test('availability syncs: out of stock → 0, back in stock → quantity', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(1));
    await run(repo, feed(1, () => ({ stock_status: 'out of stock', stock_quantity: 0 })));
    assert.equal(repo.db.products[0].stock, 0);
    await run(repo, feed(1, () => ({ stock_status: 'in stock', stock_quantity: 7 })));
    assert.equal(repo.db.products[0].stock, 7);
    await run(repo, feed(1, () => ({ stock_status: 'in stock', stock_quantity: 7 })), { syncStock: false, force: true });
    assert.equal(repo.db.products[0].stock, 7);
});
test('variants become ONE product with options (colour/size are not separate products)', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(1, () => ({ variants: [{ label: 'Black', price: 110, stock: 3 }, { label: 'White', price: 120 }] })));
    assert.equal(repo.db.products.length, 1);
    assert.deepEqual(repo.db.products[0].options.map((o) => [o.label, o.price, o.stock]), [['Black', 110, 3], ['White', 120, null]]);
});
test('supplier category is kept separately; a category map renames only the storefront category', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(1, () => ({ category: ['Electronics', 'Earbuds'] })), { categoryMap: { Earbuds: 'TWS Earbuds' } });
    assert.equal(repo.db.products[0].category, 'TWS Earbuds');
    assert.equal(repo.db.mappings[0].supplier_category, 'Electronics / Earbuds');
});
test('storefront_category (chosen by SHAGORBENZ) is used for the shop, while the supplier category stays empty/untouched', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(1, () => ({ category: undefined, storefront_category: 'Power Bank' })));
    assert.equal(repo.db.products[0].category, 'Power Bank');
    assert.equal(repo.db.mappings[0].supplier_category, null, 'never presented as a supplier category');
});
test('buy rate (what we pay) and minimum selling price go to the PRIVATE mapping; the shop price is the proposed selling price', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(1, () => ({ price: 1209, supplier_price: 699, min_selling_price: 749 })));
    assert.equal(repo.db.products[0].price, 1209);
    assert.equal(repo.db.mappings[0].supplier_price, 699);
    assert.equal(repo.db.mappings[0].min_selling_price, 749);
    assert.ok(!('supplier_price' in repo.db.products[0]) && !('min_selling_price' in repo.db.products[0]));
    // a later buy-rate change updates only the private value
    await run(repo, feed(1, () => ({ price: 1209, supplier_price: 650, min_selling_price: 700 })));
    assert.equal(repo.db.mappings[0].supplier_price, 650);
    assert.equal(repo.db.products[0].price, 1209);
});
test('supplier cost/URL/status never appear on the public product row', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(1));
    const keys = Object.keys(repo.db.products[0]);
    for (const secret of ['supplier_price', 'supplier_product_url', 'canonical_url', 'supplier', 'last_import_price', 'content_hash']) assert.ok(!keys.includes(secret), secret);
});

// ───────── removal detection ─────────
test('missing products are only marked unavailable after 2 COMPLETE runs, never deleted, and recover when listed again', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(4));
    const without3 = () => { const f = feed(4); f.records = f.records.filter((r) => r.supplierProductId !== 'P3'); return f; };
    await run(repo, without3(), { complete: true });
    assert.equal(repo.db.products.find((p) => p.title === 'Product 3').stock, 10, 'one miss is not enough');
    const r2 = await run(repo, without3(), { complete: true });
    assert.equal(r2.stats.newlyUnavailable, 1);
    assert.equal(repo.db.products.length, 4, 'nothing deleted');
    assert.equal(repo.db.products.find((p) => p.title === 'Product 3').stock, 0);
    assert.equal(repo.db.mappings.find((m) => m.supplier_product_id === 'P3').import_status, 'unavailable');
    await run(repo, feed(4), { complete: true });
    assert.equal(repo.db.products.find((p) => p.title === 'Product 3').stock, 10, 'back in the feed → available again');
    assert.equal(repo.db.mappings.find((m) => m.supplier_product_id === 'P3').missing_runs, 0);
});
test('a partial run (no --complete, a retry subset, or a limit) never marks anything unavailable', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(4));
    const part = feed(4); part.records = part.records.slice(0, 1);
    for (const o of [{}, { complete: true, onlyIds: new Set(['P1']) }, { complete: true, limited: true }]) {
        await run(repo, part, o); await run(repo, part, o); await run(repo, part, o);
    }
    assert.ok(repo.db.products.every((p) => p.stock === 10));
});
test('a row that failed validation is still "listed", so it is not marked unavailable', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(2));
    const f = feed(2, (n) => (n === 2 ? { price: 'broken' } : {}));
    assert.equal(f.rejected.length, 1);
    await run(repo, f, { complete: true }); await run(repo, f, { complete: true });
    assert.equal(repo.db.products.find((p) => p.title === 'Product 2').stock, 10);
});
test('a product an admin deleted (mapping detached) is not resurrected', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(2));
    repo.db.products.splice(0, 1);
    repo.db.mappings[0].product_id = null;
    const r = await run(repo, feed(2));
    assert.equal(repo.db.products.length, 1);
    assert.equal(r.stats.detached, 1);
});

// ───────── modes, dry run, failures ─────────
test('mode "new" creates only; mode "update" updates only', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(2));
    const n = await run(repo, feed(4, (k) => ({ price: 900 + k })), { mode: 'new' });
    assert.equal(n.stats.inserted, 2);
    assert.equal(repo.db.mappings.find((m) => m.supplier_product_id === 'P1').supplier_price, 101, 'existing not updated');
    const u = await run(repo, feed(6, (k) => ({ price: 800 + k })), { mode: 'update' });
    assert.equal(u.stats.inserted, 0);
    assert.equal(repo.db.products.length, 4);
    assert.equal(repo.db.mappings.find((m) => m.supplier_product_id === 'P1').supplier_price, 801);
});
test('dry run writes nothing', async () => {
    const repo = createMemoryRepo();
    const r = await run(repo, feed(10), { dryRun: true });
    assert.equal(r.stats.inserted, 10);
    assert.equal(repo.db.products.length + repo.db.mappings.length + repo.db.runs.length, 0);
});
test('one failing product is isolated, logged, and the rest still import', async () => {
    const repo = createMemoryRepo();
    repo.db.inject.push({ op: 'insert', status: 400, message: 'bad row', code: '22P02' });
    const r = await run(repo, feed(5));
    assert.equal(r.stats.inserted, 4);
    assert.equal(r.stats.failed, 1);
    assert.equal(repo.db.errors.length, 1);
    assert.equal(repo.db.errors[0].stage, 'write');
});
test('validation rejects are logged as failures and counted in "discovered"', async () => {
    const repo = createMemoryRepo();
    const f = feed(5, (n) => (n === 4 ? { images: [] } : {}));
    const r = await run(repo, f);
    assert.equal(r.stats.discovered, 5);
    assert.equal(r.stats.failed, 1);
    assert.equal(repo.db.errors[0].stage, 'validation');
});
test('temporary errors (429/503/network) are retried with back-off and then succeed', async () => {
    const repo = createMemoryRepo();
    repo.db.inject.push({ op: 'loadMappings', status: 503, message: 'service unavailable' }, { op: 'insert', status: 429, message: 'rate limited' });
    const waits = [];
    const r = await runImport({ repo, supplier: SUP, ...feed(2), options: { delayMs: 0, retries: 4 }, wait: async (ms) => waits.push(ms) });
    assert.equal(r.stats.inserted, 2);
    assert.equal(r.stats.failed, 0);
    assert.deepEqual(waits.slice(0, 2), [500, 500]);
});
test('--retry-failed (onlyIds) re-processes only the failed ids', async () => {
    const repo = createMemoryRepo();
    repo.db.inject.push({ op: 'insert', status: 400, message: 'boom', code: 'XX' });
    await run(repo, feed(3));
    assert.deepEqual(repo.db.errors.map((e) => e.supplier_product_id), ['P1']);
    const r = await run(repo, feed(3), { onlyIds: new Set(['P1']) });
    assert.equal(r.stats.inserted, 1);
    assert.equal(repo.db.products.length, 3);
});
test('--resume (skipIds) skips what an interrupted run already processed', async () => {
    const repo = createMemoryRepo();
    await run(repo, feed(3), { limited: true });
    const r = await run(repo, feed(6), { skipIds: new Set(['P1', 'P2', 'P3']) });
    assert.equal(r.stats.inserted, 3);
    assert.equal(repo.db.products.length, 6);
});
test('batching: 120 products in batches of 50 → every product once, progress reported per batch', async () => {
    const repo = createMemoryRepo();
    const seen = [];
    const r = await runImport({ repo, supplier: SUP, ...feed(120), options: { delayMs: 0, batchSize: 50 }, wait: async () => {}, onBatch: ({ stats }) => seen.push(stats.processed) });
    assert.deepEqual(seen, [50, 100, 120]);
    assert.equal(r.stats.inserted, 120);
    assert.equal(repo.db.products.length, 120);
});
test('image verification: unreachable main image fails the product; unreachable gallery images are dropped', async () => {
    const repo = createMemoryRepo();
    const r = await run(repo, feed(2), { verifyImage: async (u) => !u.includes('1-1') && !u.includes('2-2') });
    assert.equal(r.stats.inserted, 1);
    assert.equal(r.stats.failed, 1);
    assert.equal(r.failures[0].stage, 'image');
    assert.deepEqual(repo.db.products[0].images, [], 'broken gallery image dropped');
});

// ───────── clear errors ─────────
test('a placeholder key is refused before any request, with an instruction (and the key is never echoed)', () => {
    assert.throws(() => createSupabaseRepo({ url: 'https://x.supabase.co', serviceKey: 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE' }), /still the placeholder/);
    assert.throws(() => createSupabaseRepo({ url: 'https://x.supabase.co', serviceKey: '' }), /not set/);
});
test('database/network errors are explained as actions', () => {
    assert.match(explainDbError({ status: 401, message: 'Invalid API key' }), /service_role/);
    assert.match(explainDbError({ code: '42501', message: 'permission denied for table supplier_products' }), /service_role/);
    assert.match(explainDbError({ code: '42P01', message: 'relation "public.supplier_products" does not exist' }), /migration/i);
    assert.match(explainDbError({ code: 'PGRST205', message: "Could not find the table 'public.supplier_products' in the schema cache" }), /migration/i);
    assert.match(explainDbError(new Error('fetch failed')), /internet/i);
    assert.equal(explainDbError({ message: 'something else' }), 'something else');
});
test('identical failures are grouped into one line with a count', () => {
    const f = [...Array(141).fill({ supplier_product_id: 'A', stage: 'lookup', message: 'Invalid API key' }), ...Array(26).fill({ supplier_product_id: 'B', stage: 'validation', message: 'invalid price: 0' })];
    const g = summariseFailures(f);
    assert.deepEqual(g.map((x) => [x.key, x.count]), [['[lookup] Invalid API key', 141], ['[validation] invalid price: 0', 26]]);
});
