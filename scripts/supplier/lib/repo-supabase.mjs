// Supabase storage for the import engine. SERVER-SIDE ONLY: it needs the service-role key, which bypasses
// Row Level Security. Never put that key in the browser bundle, a VITE_* variable, or the repository.

import { createClient } from '@supabase/supabase-js';
import { explainDbError } from './explain.mjs';

export function createSupabaseRepo({ url, serviceKey }) {
    if (!url) throw new Error('SUPABASE_URL is not set');
    if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set (server-side secret — see README)');
    if (/PASTE_YOUR/.test(serviceKey)) throw new Error(explainDbError('PASTE_YOUR placeholder'));
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    /** Unwraps a PostgREST response; keeps status/code so the engine can tell temporary errors from real ones. */
    const ok = ({ data, error, status }) => {
        if (error) throw Object.assign(new Error(error.message || String(error)), { code: error.code, status });
        return data;
    };
    const guarded = async (fn) => {
        try {
            return await fn();
        } catch (err) {
            if (err?.status || err?.code) throw err;
            throw Object.assign(new Error(err?.message || String(err)), { transient: /fetch|network|timeout|ECONN/i.test(String(err?.message)) });
        }
    };

    return {
        /** One cheap read before anything else, so a wrong key / missing migration is reported once, clearly. */
        async preflight() {
            const { error, status } = await db.from('supplier_products').select('id').limit(1);
            if (error) throw new Error(explainDbError({ message: error.message, code: error.code, status }));
        },
        async findRunningRun(supplier) {
            const since = new Date(Date.now() - 6 * 3600e3).toISOString();
            const rows = ok(await db.from('supplier_import_runs').select('id, started_at').eq('supplier', supplier).eq('status', 'running').gte('started_at', since).limit(1));
            return rows[0] || null;
        },
        async startRun({ supplier, mode, options }) {
            return ok(await db.from('supplier_import_runs').insert({ supplier, mode, options }).select('id').single()).id;
        },
        async updateRun(id, s) {
            if (!id) return;
            ok(await db.from('supplier_import_runs').update({
                total_discovered: s.discovered, processed: s.processed, inserted: s.inserted, updated: s.updated, skipped: s.skipped,
                failed: s.failed, duplicates_prevented: s.duplicatesPrevented, newly_unavailable: s.newlyUnavailable
            }).eq('id', id));
        },
        async finishRun(id, { status, complete_catalog, stats: s }) {
            ok(await db.from('supplier_import_runs').update({
                status, complete_catalog, finished_at: new Date().toISOString(),
                total_discovered: s.discovered, processed: s.processed, inserted: s.inserted, updated: s.updated, skipped: s.skipped,
                failed: s.failed, duplicates_prevented: s.duplicatesPrevented, newly_unavailable: s.newlyUnavailable
            }).eq('id', id));
        },
        async abortRun(id, message) {
            ok(await db.from('supplier_import_runs').update({ status: 'aborted', finished_at: new Date().toISOString(), options: { aborted: message } }).eq('id', id));
        },
        loadMappings: (supplier, ids) => guarded(async () => {
            const rows = ok(await db.from('supplier_products').select('*').eq('supplier', supplier).in('supplier_product_id', ids));
            return new Map(rows.map((r) => [r.supplier_product_id, r]));
        }),
        loadMappingsByUrl: (supplier, urls) => guarded(async () => {
            const rows = ok(await db.from('supplier_products').select('*').eq('supplier', supplier).in('canonical_url', urls));
            return new Map(rows.map((r) => [r.canonical_url, r]));
        }),
        loadProducts: (ids) => guarded(async () => {
            const rows = ok(await db.from('products').select('id, price, old_price, stock, image, images, title, description, category, brand, sku, specifications, options, manual_overrides').in('id', ids));
            return new Map(rows.map((r) => [String(r.id), r]));
        }),
        insertProductWithMapping: (product, mapping) => guarded(async () => {
            const result = ok(await db.rpc('supplier_insert_product', { p_product: product, p_mapping: mapping }));
            return result?.product_id;
        }),
        updateProduct: (id, patch) => guarded(async () => ok(await db.from('products').update(patch).eq('id', id))),
        updateMapping: (id, patch) => guarded(async () => ok(await db.from('supplier_products').update({ ...patch, supplier_last_synced_at: new Date().toISOString(), last_seen_at: patch.missing_runs === undefined || patch.missing_runs === 0 ? new Date().toISOString() : undefined }).eq('id', id))),
        touchMappings: (ids) => guarded(async () => ok(await db.from('supplier_products').update({ last_seen_at: new Date().toISOString(), missing_runs: 0 }).in('id', ids))),
        listMappings: (supplier) => guarded(async () => {
            const rows = [];
            for (let from = 0; ; from += 1000) {
                const page = ok(await db.from('supplier_products').select('id, supplier_product_id, product_id, missing_runs, import_status').eq('supplier', supplier).order('id').range(from, from + 999));
                rows.push(...page);
                if (page.length < 1000) break;
            }
            return rows;
        }),
        async logError(runId, row) {
            ok(await db.from('supplier_import_errors').insert({ run_id: runId, ...row }));
        },
        async openErrorIds(supplier) {
            const rows = ok(await db.from('supplier_import_errors').select('supplier_product_id').eq('supplier', supplier).eq('resolved', false).not('supplier_product_id', 'is', null));
            return [...new Set(rows.map((r) => r.supplier_product_id))];
        },
        async resolveErrors(supplier, ids) {
            if (ids.length) ok(await db.from('supplier_import_errors').update({ resolved: true }).eq('supplier', supplier).in('supplier_product_id', ids).eq('resolved', false));
        },
        async report(supplier) {
            const runs = ok(await db.from('supplier_import_runs').select('*').eq('supplier', supplier).order('started_at', { ascending: false }).limit(5));
            const mappings = ok(await db.from('supplier_products').select('supplier_stock_status, import_status').eq('supplier', supplier).limit(100000));
            const errors = ok(await db.from('supplier_import_errors').select('id', { count: 'exact', head: true }).eq('supplier', supplier).eq('resolved', false));
            return { runs, mappings, openErrors: errors };
        }
    };
}
