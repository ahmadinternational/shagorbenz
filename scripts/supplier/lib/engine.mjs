// Supplier import engine. Pure logic over a `repo` object, so the very same code runs against Supabase
// (repo-supabase.mjs) and against an in-memory store in the tests.
//
// What it guarantees
//   • No duplicates: a product is identified by (supplier, supplier_product_id) and by its canonical URL;
//     repeated runs only update. New products are created together with their mapping in ONE transaction.
//   • Hand edits survive: the selling price is only touched when --sync-prices is on AND it still equals the
//     value this importer wrote; fields listed in products.manual_overrides are never overwritten.
//   • Nothing is deleted. A product the supplier stops listing is marked unavailable (stock 0) only after it
//     was missing from `missingThreshold` consecutive COMPLETE catalog runs.
//   • Failures are isolated: one bad record is logged and skipped; the batch carries on.

export const DEFAULTS = {
    mode: 'all', // all | new | update
    batchSize: 50,
    delayMs: 200,
    retries: 4,
    markupPercent: 0, // 0 = selling price equals the supplier price exactly
    priority: 1000, // after the store's own products in the default sort
    syncStock: true,
    syncPrices: false,
    syncImages: false,
    syncContent: false,
    force: false,
    complete: false, // true only when the input is the WHOLE catalog → enables removal detection
    dryRun: false,
    missingThreshold: 2,
    categoryMap: {},
    onlyIds: null, // Set — retry-failed
    skipIds: null, // Set — resume
    verifyImage: null // async (url) => boolean
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const isTransient = (err) =>
    [408, 425, 429, 500, 502, 503, 504].includes(Number(err?.status)) ||
    /fetch failed|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|timeout/i.test(String(err?.message || '')) ||
    err?.transient === true;

export async function withRetry(fn, { retries = 4, baseMs = 500, wait = sleep, onRetry } = {}) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt >= retries || !isTransient(err)) throw err;
            const delay = Math.min(8000, baseMs * 2 ** attempt);
            onRetry?.(err, attempt + 1, delay);
            await wait(delay);
        }
    }
}

/** Selling price from the supplier price. With the default markup of 0 it is returned unchanged. */
export const sellingPrice = (supplierPrice, markupPercent = 0) =>
    supplierPrice === null || supplierPrice === undefined
        ? null
        : markupPercent ? Math.round(supplierPrice * (1 + markupPercent / 100) * 100) / 100 : supplierPrice;

function mapCategory(category, map) {
    if (!category) return 'Other';
    return map[category] ?? map[category.toLowerCase()] ?? category;
}

/** Product `stock` column for a record: 0 = out, a number = tracked, null = available / not tracked. */
export function stockValue(rec) {
    if (rec.stockStatus === 'out_of_stock') return 0;
    if (rec.stockStatus === 'in_stock') return rec.stockQuantity > 0 ? rec.stockQuantity : null;
    return null; // unknown → treated as available, flagged 'unknown' on the mapping
}

export function buildOptions(rec, opts) {
    return rec.variants.map((v) => ({
        id: v.id,
        label: v.label,
        image: v.image || '',
        price: v.price !== null ? sellingPrice(v.price, opts.markupPercent) : null,
        old_price: v.regularPrice && v.price !== null && v.regularPrice > v.price ? sellingPrice(v.regularPrice, opts.markupPercent) : 0,
        stock: v.stock
    }));
}

export function buildProductRow(rec, opts) {
    return {
        title: rec.title,
        description: rec.description,
        category: mapCategory(rec.category, opts.categoryMap),
        brand: rec.brand,
        sku: rec.sku,
        image: rec.images[0],
        images: rec.images.slice(1),
        specifications: rec.specifications,
        options: buildOptions(rec, opts),
        price: sellingPrice(rec.price, opts.markupPercent),
        old_price: rec.regularPrice ? sellingPrice(rec.regularPrice, opts.markupPercent) : 0,
        stock: stockValue(rec),
        priority: opts.priority,
        is_active: true
    };
}

function mappingRow(rec, opts) {
    return {
        supplier: rec.supplier,
        supplier_product_id: rec.supplierProductId,
        supplier_product_url: rec.url,
        canonical_url: rec.canonicalUrl,
        supplier_category: rec.supplierCategory,
        supplier_title: rec.title,
        supplier_price: rec.price,
        supplier_regular_price: rec.regularPrice,
        supplier_stock_status: rec.stockStatus,
        supplier_stock_quantity: rec.stockQuantity,
        last_import_price: sellingPrice(rec.price, opts.markupPercent),
        content_hash: rec.hash
    };
}

/**
 * What an update may change on an existing product. Returns { patch, preserved } where `preserved`
 * lists fields skipped because an admin edited them by hand.
 */
export function buildPatch(rec, mapping, product, opts) {
    const overrides = product.manual_overrides && typeof product.manual_overrides === 'object' ? product.manual_overrides : {};
    const patch = {};
    const preserved = [];
    const set = (column, value, overrideKey = column) => {
        if (overrides[overrideKey]) return void (!same(product[column], value) && preserved.push(overrideKey));
        if (!same(product[column], value)) patch[column] = value;
    };
    const next = buildProductRow(rec, opts);

    if (opts.syncStock && rec.stockStatus !== 'unknown') set('stock', next.stock);

    if (opts.syncPrices) {
        const untouchedByHand = Number(product.price) === Number(mapping.last_import_price);
        if (overrides.price || !untouchedByHand) {
            if (Number(product.price) !== Number(next.price)) preserved.push('price');
        } else {
            set('price', next.price);
            set('old_price', next.old_price);
        }
    }
    if (opts.syncImages) {
        if (overrides.image || overrides.images) preserved.push('images');
        else {
            set('image', next.image);
            set('images', next.images, 'images');
        }
    }
    if (opts.syncContent) {
        for (const column of ['title', 'description', 'category', 'brand', 'sku', 'specifications', 'options']) set(column, next[column]);
    }
    return { patch, preserved };
}

/**
 * @param {object}   args
 * @param {object}   args.repo       storage (see repo-supabase.mjs for the contract)
 * @param {object[]} args.records    validated records (feed.mjs → normalizeProduct)
 * @param {object[]} args.rejected   rows refused by validation: { supplier_product_id, title, error }
 * @param {string}   args.supplier
 */
export async function runImport({ repo, supplier, records, rejected = [], options = {}, log = () => {}, onBatch, wait = sleep }) {
    const opts = { ...DEFAULTS, ...options };
    const stats = {
        discovered: records.length + rejected.length, processed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0,
        duplicatesPrevented: 0, newlyUnavailable: 0, unchanged: 0, preservedEdits: 0, detached: 0
    };
    const failures = [];
    const retry = (fn) => withRetry(fn, { retries: opts.retries, wait, onRetry: (e, n, d) => log(`  ↻ temporary error (${e.message}); retry ${n} in ${d} ms`) });

    const runId = opts.dryRun ? null : await repo.startRun({ supplier, mode: opts.mode, options: summarise(opts) });
    const logFailure = async (rec, stage, message, payload) => {
        stats.failed++;
        failures.push({ supplier_product_id: rec.supplierProductId ?? rec.supplier_product_id, stage, message });
        if (!opts.dryRun) {
            try {
                await repo.logError(runId, { supplier, supplier_product_id: rec.supplierProductId ?? rec.supplier_product_id ?? null, title: rec.title ?? null, stage, message, payload: payload ?? null });
            } catch (err) {
                log(`  ! could not record error: ${err.message}`);
            }
        }
    };

    // 1 · identities seen in the input (also rows that failed validation — they are still LISTED by the supplier)
    const seenAll = new Set([...records.map((r) => r.supplierProductId), ...rejected.map((r) => r.supplier_product_id).filter(Boolean)]);
    for (const bad of rejected) await logFailure(bad, 'validation', bad.error);

    // 2 · in-feed duplicates
    const unique = new Map();
    const urlOwner = new Map();
    for (const rec of records) {
        const clash = rec.canonicalUrl && urlOwner.get(rec.canonicalUrl);
        if (unique.has(rec.supplierProductId) || (clash && clash !== rec.supplierProductId)) {
            stats.duplicatesPrevented++;
            continue;
        }
        unique.set(rec.supplierProductId, rec);
        if (rec.canonicalUrl) urlOwner.set(rec.canonicalUrl, rec.supplierProductId);
    }
    let queue = [...unique.values()];
    if (opts.onlyIds) queue = queue.filter((r) => opts.onlyIds.has(r.supplierProductId));
    if (opts.skipIds) queue = queue.filter((r) => !opts.skipIds.has(r.supplierProductId));
    const resumedSkips = opts.skipIds ? unique.size - queue.length : 0;

    // 3 · batches
    for (const batch of chunk(queue, opts.batchSize)) {
        const ids = batch.map((r) => r.supplierProductId);
        let mappings, urlMappings = new Map(), products = new Map();
        try {
            mappings = await retry(() => repo.loadMappings(supplier, ids));
            const unmatchedUrls = batch.filter((r) => !mappings.has(r.supplierProductId) && r.canonicalUrl).map((r) => r.canonicalUrl);
            if (unmatchedUrls.length) urlMappings = await retry(() => repo.loadMappingsByUrl(supplier, unmatchedUrls));
            const productIds = [...mappings.values()].map((m) => m.product_id).filter((v) => v !== null && v !== undefined);
            if (productIds.length) products = await retry(() => repo.loadProducts(productIds));
        } catch (err) {
            for (const rec of batch) await logFailure(rec, 'lookup', err.message);
            stats.processed += batch.length;
            continue;
        }

        const touch = [];
        for (const rec of batch) {
            try {
                await retry(() => processOne(rec, mappings.get(rec.supplierProductId), urlMappings, products, touch));
            } catch (err) {
                await logFailure(rec, err.stage || 'write', err.message, { code: err.code });
            }
        }
        if (touch.length && !opts.dryRun) await retry(() => repo.touchMappings(touch)).catch((err) => log(`  ! touch failed: ${err.message}`));
        stats.processed += batch.length;
        if (!opts.dryRun) await repo.updateRun(runId, stats).catch(() => {});
        onBatch?.({ stats: { ...stats }, ids });
        if (opts.delayMs) await wait(opts.delayMs);
    }
    stats.skipped += resumedSkips;

    async function processOne(rec, existing, urlMappings, products, touch) {
        // ── new ──
        if (!existing) {
            const owner = rec.canonicalUrl && urlMappings.get(rec.canonicalUrl);
            if (owner) {
                stats.duplicatesPrevented++;
                await logFailureSilently(rec, 'duplicate_url', `URL already mapped to supplier id ${owner.supplier_product_id}`);
                return;
            }
            if (opts.mode === 'update') return void stats.skipped++;
            const row = buildProductRow(rec, opts);
            if (opts.verifyImage) {
                if (!(await opts.verifyImage(row.image))) throw Object.assign(new Error(`main image not reachable: ${row.image}`), { stage: 'image' });
                const checks = await Promise.all(row.images.map((u) => opts.verifyImage(u)));
                row.images = row.images.filter((_, i) => checks[i]);
            }
            if (!opts.dryRun) {
                try {
                    await repo.insertProductWithMapping(row, mappingRow(rec, opts));
                } catch (err) {
                    // 23505 = unique violation: the identity already exists (e.g. an earlier attempt committed but its
                    // response was lost). The unique key did its job — nothing was duplicated.
                    if (err?.code === '23505') return void stats.duplicatesPrevented++;
                    throw err;
                }
            }
            stats.inserted++;
            return;
        }

        // ── already imported ──
        if (existing.product_id === null || existing.product_id === undefined) return void (stats.skipped++, stats.detached++); // deleted by an admin: never resurrect
        if (opts.mode === 'new') return void (stats.skipped++, touch.push(existing.id));
        const product = products.get(String(existing.product_id));
        if (!product) return void (stats.skipped++, stats.detached++);

        const reappeared = existing.import_status === 'unavailable';
        if (existing.content_hash === rec.hash && !reappeared && !opts.force) {
            stats.unchanged++;
            stats.skipped++;
            touch.push(existing.id);
            return;
        }
        const { patch, preserved } = buildPatch(rec, existing, product, opts);
        const priceWritten = 'price' in patch;
        const mapPatch = {
            supplier_product_url: rec.url ?? existing.supplier_product_url,
            supplier_category: rec.supplierCategory,
            supplier_title: rec.title,
            supplier_price: rec.price,
            supplier_regular_price: rec.regularPrice,
            supplier_stock_status: rec.stockStatus,
            supplier_stock_quantity: rec.stockQuantity,
            content_hash: rec.hash,
            import_status: 'updated',
            missing_runs: 0,
            ...(priceWritten ? { last_import_price: sellingPrice(rec.price, opts.markupPercent) } : {})
        };
        if (!opts.dryRun) {
            if (Object.keys(patch).length) await repo.updateProduct(existing.product_id, patch); // product first …
            await repo.updateMapping(existing.id, mapPatch); // … hash last, so a failure in between is simply retried next run
        }
        stats.preservedEdits += preserved.length;
        stats.updated++;
    }

    async function logFailureSilently(rec, stage, message) {
        if (opts.dryRun) return;
        await repo.logError(runId, { supplier, supplier_product_id: rec.supplierProductId, title: rec.title, stage, message, payload: null }).catch(() => {});
    }

    // 4 · products the supplier no longer lists — only after a COMPLETE run, only after `missingThreshold` such runs
    const partial = !!(opts.onlyIds || opts.limited);
    if (opts.complete && !partial && opts.mode !== 'new' && !opts.dryRun) {
        for (const m of await retry(() => repo.listMappings(supplier))) {
            if (seenAll.has(m.supplier_product_id) || m.product_id === null || m.product_id === undefined || m.import_status === 'unavailable') continue;
            const missing = (m.missing_runs || 0) + 1;
            if (missing < opts.missingThreshold) {
                await repo.updateMapping(m.id, { missing_runs: missing });
                continue;
            }
            const product = (await repo.loadProducts([m.product_id])).get(String(m.product_id));
            const overrides = product?.manual_overrides || {};
            if (product && !overrides.stock) await repo.updateProduct(m.product_id, { stock: 0 }); // availability only — the row stays
            await repo.updateMapping(m.id, { missing_runs: missing, import_status: 'unavailable', supplier_stock_status: 'unavailable' });
            stats.newlyUnavailable++;
        }
    }

    if (!opts.dryRun) await repo.finishRun(runId, { status: stats.failed && !stats.processed ? 'failed' : 'completed', complete_catalog: opts.complete && !partial, stats });
    return { runId, stats, failures };
}

const summarise = (o) => ({
    syncStock: o.syncStock, syncPrices: o.syncPrices, syncImages: o.syncImages, syncContent: o.syncContent,
    markupPercent: o.markupPercent, batchSize: o.batchSize, complete: o.complete, retryOnly: !!o.onlyIds
});
