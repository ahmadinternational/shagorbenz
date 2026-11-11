// In-memory stand-in for the database, with the same uniqueness rules, used by the engine tests.
export function createMemoryRepo() {
    const db = { products: [], mappings: [], runs: [], errors: [], nextProductId: 1, nextMappingId: 1, calls: { updateProduct: 0, insert: 0 }, inject: [] };
    const maybeFail = (op) => {
        const i = db.inject.findIndex((f) => f.op === op && (!f.when || f.when()));
        if (i >= 0) {
            const [f] = db.inject.splice(i, 1);
            throw Object.assign(new Error(f.message), { status: f.status, code: f.code });
        }
    };
    const clone = (x) => JSON.parse(JSON.stringify(x));
    return {
        db,
        async findRunningRun() { return db.runs.find((r) => r.status === 'running') || null; },
        async startRun(r) { const run = { id: `run-${db.runs.length + 1}`, status: 'running', ...r }; db.runs.push(run); return run.id; },
        async updateRun() {},
        async finishRun(id, f) { Object.assign(db.runs.find((r) => r.id === id), f); },
        async loadMappings(supplier, ids) { maybeFail('loadMappings'); return new Map(db.mappings.filter((m) => m.supplier === supplier && ids.includes(m.supplier_product_id)).map((m) => [m.supplier_product_id, clone(m)])); },
        async loadMappingsByUrl(supplier, urls) { return new Map(db.mappings.filter((m) => m.supplier === supplier && urls.includes(m.canonical_url)).map((m) => [m.canonical_url, clone(m)])); },
        async loadProducts(ids) { return new Map(db.products.filter((p) => ids.map(String).includes(String(p.id))).map((p) => [String(p.id), clone(p)])); },
        async insertProductWithMapping(product, mapping) {
            maybeFail('insert');
            db.calls.insert++;
            if (db.mappings.some((m) => m.supplier === mapping.supplier && m.supplier_product_id === mapping.supplier_product_id))
                throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
            if (mapping.canonical_url && db.mappings.some((m) => m.supplier === mapping.supplier && m.canonical_url === mapping.canonical_url))
                throw Object.assign(new Error('duplicate key (url)'), { code: '23505' });
            const id = String(db.nextProductId++);
            db.products.push({ id, is_supplier_product: true, is_active: true, manual_overrides: {}, ...clone(product) });
            db.mappings.push({ id: db.nextMappingId++, product_id: id, import_status: 'imported', missing_runs: 0, ...clone(mapping) });
            return id;
        },
        async updateProduct(id, patch) { maybeFail('updateProduct'); db.calls.updateProduct++; Object.assign(db.products.find((p) => String(p.id) === String(id)), clone(patch)); },
        async updateMapping(id, patch) { Object.assign(db.mappings.find((m) => m.id === id), clone(patch)); },
        async touchMappings(ids) { db.mappings.filter((m) => ids.includes(m.id)).forEach((m) => (m.missing_runs = 0)); },
        async listMappings(supplier) { return db.mappings.filter((m) => m.supplier === supplier).map(clone); },
        async logError(runId, row) { db.errors.push({ run_id: runId, ...row }); }
    };
}
