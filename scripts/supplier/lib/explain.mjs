// Turns a raw database/network error into a sentence that says what to DO. Never prints a key.
export function explainDbError(err) {
    const msg = String(err?.message || err || '');
    const code = String(err?.code || '');
    const status = Number(err?.status) || 0;
    if (/PASTE_YOUR/.test(msg)) return 'The service-role key in .env.supplier is still the placeholder. Paste the real key: Supabase → Project Settings → API → service_role.';
    if (status === 401 || status === 403 || /invalid api key|invalid jwt|jwt|apikey/i.test(msg) && !/42P01/.test(code))
        return 'The database rejected the key. Use the secret "service_role" key from Supabase → Project Settings → API (not the anon/publishable key), pasted on ONE line with no quotes, and make sure it belongs to this project.';
    if (code === '42501' || /permission denied/i.test(msg))
        return 'Permission denied. This key has no access to the supplier tables: use the service_role key (the anon key is deliberately locked out).';
    if (code === '42P01' || code === 'PGRST205' || /does not exist|could not find the table|schema cache/i.test(msg))
        return 'The supplier tables are missing. Run supabase/migrations/20261111000000_supplier_catalog.sql in the Supabase SQL editor first.';
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(msg))
        return 'Could not reach Supabase. Check the internet connection and SUPABASE_URL.';
    return msg;
}

/** Groups failures by "[stage] message" so 141 identical errors read as one line with a count. */
export function summariseFailures(failures, limit = 8) {
    const groups = new Map();
    for (const f of failures) {
        const key = `[${f.stage}] ${f.message}`;
        const g = groups.get(key) || { key, count: 0, example: f.supplier_product_id };
        g.count++;
        groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
