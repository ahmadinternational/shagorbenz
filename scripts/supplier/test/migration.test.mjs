// Runs the SQL migration + rollback against an in-process Postgres (PGlite) for several `products.id` types.
// Optional: skipped unless `@electric-sql/pglite` is installed  →  npm i --no-save @electric-sql/pglite
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

let PGlite = null;
try {
    ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
    /* not installed */
}
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const up = read('../../../supabase/migrations/20261111000000_supplier_catalog.sql');
const down = read('../../../supabase/rollbacks/20261111000000_supplier_catalog_rollback.sql');
const ID_DEFS = {
    text: "text primary key default (floor(random()*1e9))::text",
    bigint: 'bigint generated always as identity primary key',
    uuid: 'uuid primary key default gen_random_uuid()'
};

for (const [idType, idDef] of Object.entries(ID_DEFS)) {
    test(`migration (products.id = ${idType})`, { skip: !PGlite && 'install @electric-sql/pglite to run' }, async () => {
        const db = new PGlite();
        await db.exec('create role anon nologin; create role authenticated nologin;');
        await db.exec(`create table public.products (id ${idDef}, title text, price numeric, old_price numeric, image text, category text, stock int, description text, priority int default 0);
                       insert into public.products (title, price, image, category, stock) values ('Existing', 100, 'https://x/a.jpg', 'lamp', 5);`);
        await db.exec(up);
        await db.exec(up); // idempotent
        const row = (await db.query('select * from public.products')).rows[0];
        assert.equal(row.title, 'Existing');
        assert.equal(row.is_active, true);
        assert.equal(row.is_supplier_product, false);

        const fk = (await db.query(`select format_type(a.atttypid,a.atttypmod) t from pg_attribute a where a.attrelid='public.supplier_products'::regclass and a.attname='product_id'`)).rows[0].t;
        assert.equal(fk, idType, 'FK column copies products.id type');

        const product = { title: 'P', price: 10, image: 'https://s/i.jpg', category: 'c', stock: null, description: '', priority: 1000, brand: 'B', images: ['https://s/2.jpg'], specifications: [{ label: 'a', value: 'b' }], options: [] };
        const mapping = { supplier: 's', supplier_product_id: 'X1', canonical_url: 'https://s/x1', supplier_price: 10, content_hash: 'h' };
        await db.query('select public.supplier_insert_product($1::jsonb,$2::jsonb)', [JSON.stringify(product), JSON.stringify(mapping)]);
        await assert.rejects(db.query('select public.supplier_insert_product($1::jsonb,$2::jsonb)', [JSON.stringify(product), JSON.stringify(mapping)]));
        assert.equal((await db.query('select count(*)::int n from public.products')).rows[0].n, 2, 'failed duplicate left no orphan product (atomic)');

        for (const role of ['anon', 'authenticated']) {
            await assert.rejects(db.exec(`set role ${role}; select * from public.supplier_products;`), undefined, `${role} must not read supplier_products`);
            await db.exec('reset role');
        }
        await db.exec(down);
        const cols = (await db.query(`select column_name from information_schema.columns where table_name='products'`)).rows.map((r) => r.column_name);
        assert.ok(!cols.includes('brand') && cols.includes('options') && cols.includes('title'));
        await db.close();
    });
}
