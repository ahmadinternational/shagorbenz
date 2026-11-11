-- ============================================================================
-- SHAGORBENZ — supplier catalog support (Badhon's World import / sync)
--
-- ADDITIVE and IDEMPOTENT: nothing is dropped, renamed or rewritten, existing rows
-- only receive safe defaults, and re-running the file is harmless.
-- Rollback: supabase/rollbacks/20261111000000_supplier_catalog_rollback.sql
--
-- Run it once in the Supabase SQL editor (or `supabase db push`) BEFORE the first import.
--
-- Design
--   public.products             customer-facing data only (what the storefront already reads)
--   public.supplier_products    PRIVATE: supplier id/url/price/stock/sync state. RLS on, no policies,
--                               all privileges revoked from anon + authenticated. Only the importer,
--                               which uses the service-role key on a server/CI machine, can touch it.
--   public.supplier_import_runs / supplier_import_errors   PRIVATE import history + failures
--   public.supplier_insert_product()   atomic "new product + its mapping" insert, service-role only
-- ============================================================================

begin;

-- 1 · products: customer-facing columns ---------------------------------------
alter table public.products
  add column if not exists options              jsonb   not null default '[]'::jsonb,  -- colour/size options (README)
  add column if not exists brand                text,
  add column if not exists sku                  text,
  add column if not exists images               jsonb   not null default '[]'::jsonb,  -- extra gallery URLs (main stays in `image`)
  add column if not exists specifications       jsonb   not null default '[]'::jsonb,  -- [{ "label": "...", "value": "..." }]
  add column if not exists is_active            boolean not null default true,         -- false = hidden from the storefront
  add column if not exists is_supplier_product  boolean not null default false,        -- flag only; details live in supplier_products
  add column if not exists manual_overrides     jsonb   not null default '{}'::jsonb;  -- { "price": true, ... } fields an admin edited by hand

comment on column public.products.is_active is 'false hides the product from the storefront (order history is untouched).';
comment on column public.products.manual_overrides is 'Columns an admin edited by hand on a supplier product; the importer never overwrites them.';

create index if not exists products_hidden_idx on public.products (is_active) where is_active = false;
create index if not exists products_brand_idx  on public.products (lower(brand)) where brand is not null;

-- 2 · private supplier mapping -------------------------------------------------
-- products.id may be text, integer, bigint or uuid depending on how the table was created,
-- so the foreign-key column copies whatever type it really has.
do $$
declare
  id_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into id_type
    from pg_attribute a
   where a.attrelid = 'public.products'::regclass
     and a.attname = 'id'
     and not a.attisdropped;

  if id_type is null then
    raise exception 'public.products.id not found';
  end if;

  execute format($sql$
    create table if not exists public.supplier_products (
      id                       bigint generated always as identity primary key,
      supplier                 text        not null,
      supplier_product_id      text        not null,
      product_id               %s          references public.products (id) on delete set null,
      supplier_product_url     text,
      canonical_url            text,
      supplier_category        text,
      supplier_title           text,
      supplier_price           numeric(12,2),
      supplier_regular_price   numeric(12,2),
      supplier_stock_status    text        not null default 'unknown'
                                 check (supplier_stock_status in ('in_stock','out_of_stock','unavailable','unknown')),
      supplier_stock_quantity  integer,
      last_import_price        numeric(12,2),
      content_hash             text,
      import_status            text        not null default 'imported'
                                 check (import_status in ('imported','updated','unavailable','detached')),
      missing_runs             integer     not null default 0,
      first_seen_at            timestamptz not null default now(),
      last_seen_at             timestamptz,
      supplier_last_synced_at  timestamptz,
      constraint supplier_products_supplier_key unique (supplier, supplier_product_id)
    )
  $sql$, id_type);
end
$$;

comment on column public.supplier_products.last_import_price is 'Selling price the importer last wrote to products.price — if products.price differs, an admin changed it and sync leaves it alone.';
comment on column public.supplier_products.missing_runs is 'Consecutive COMPLETE catalog runs in which the supplier no longer listed this product.';

create unique index if not exists supplier_products_url_key
  on public.supplier_products (supplier, canonical_url) where canonical_url is not null;
create index if not exists supplier_products_product_idx on public.supplier_products (product_id);
create index if not exists supplier_products_status_idx  on public.supplier_products (supplier, supplier_stock_status);

-- 3 · import history & failures ------------------------------------------------
create table if not exists public.supplier_import_runs (
  id                   uuid primary key default gen_random_uuid(),
  supplier             text        not null,
  mode                 text        not null,
  status               text        not null default 'running' check (status in ('running','completed','failed','aborted')),
  complete_catalog     boolean     not null default false,   -- true only when the whole catalog was in the input (enables removal detection)
  started_at           timestamptz not null default now(),
  finished_at          timestamptz,
  total_discovered     integer     not null default 0,
  processed            integer     not null default 0,
  inserted             integer     not null default 0,
  updated              integer     not null default 0,
  skipped              integer     not null default 0,
  failed               integer     not null default 0,
  duplicates_prevented integer     not null default 0,
  newly_unavailable    integer     not null default 0,
  options              jsonb       not null default '{}'::jsonb
);

create table if not exists public.supplier_import_errors (
  id                   bigint generated always as identity primary key,
  run_id               uuid        references public.supplier_import_runs (id) on delete cascade,
  supplier             text        not null,
  supplier_product_id  text,
  title                text,
  stage                text,
  message              text        not null,
  payload              jsonb,
  resolved             boolean     not null default false,
  created_at           timestamptz not null default now()
);
create index if not exists supplier_import_errors_run_idx  on public.supplier_import_errors (run_id);
create index if not exists supplier_import_errors_open_idx on public.supplier_import_errors (supplier, created_at desc) where not resolved;

-- 4 · atomic insert: product + mapping in ONE transaction ----------------------
-- A product row without its mapping would be re-imported as a duplicate on the next run, so the importer
-- creates both through this function (a single statement = all-or-nothing). Called with the service-role key only.
create or replace function public.supplier_insert_product(p_product jsonb, p_mapping jsonb)
returns jsonb
language plpgsql
as $fn$
declare
  new_id jsonb;
  r public.products;
begin
  insert into public.products
    (title, price, old_price, image, category, stock, description, priority,
     options, brand, sku, images, specifications, is_active, is_supplier_product, manual_overrides)
  select
    x.title, x.price, coalesce(x.old_price, 0), x.image, x.category, x.stock, x.description, coalesce(x.priority, 0),
    coalesce(x.options, '[]'::jsonb), x.brand, x.sku, coalesce(x.images, '[]'::jsonb),
    coalesce(x.specifications, '[]'::jsonb), coalesce(x.is_active, true), true, '{}'::jsonb
  from jsonb_populate_record(null::public.products, p_product) x
  returning * into r;

  new_id := to_jsonb(r.id);

  insert into public.supplier_products
    (supplier, supplier_product_id, product_id, supplier_product_url, canonical_url, supplier_category, supplier_title,
     supplier_price, supplier_regular_price, supplier_stock_status, supplier_stock_quantity, last_import_price,
     content_hash, import_status, missing_runs, last_seen_at, supplier_last_synced_at)
  select
    m.supplier, m.supplier_product_id, r.id, m.supplier_product_url, m.canonical_url, m.supplier_category, m.supplier_title,
    m.supplier_price, m.supplier_regular_price, coalesce(m.supplier_stock_status, 'unknown'), m.supplier_stock_quantity,
    m.last_import_price, m.content_hash, 'imported', 0, now(), now()
  from jsonb_populate_record(null::public.supplier_products, p_mapping) m;

  return jsonb_build_object('product_id', new_id);
end
$fn$;

revoke all on function public.supplier_insert_product(jsonb, jsonb) from public, anon, authenticated;

-- 5 · security: private tables are invisible to the browser keys --------------
alter table public.supplier_products      enable row level security;
alter table public.supplier_import_runs   enable row level security;
alter table public.supplier_import_errors enable row level security;
-- Deliberately NO policies: the service-role key used by the importer bypasses RLS,
-- the anon / authenticated keys get nothing. Privileges are revoked as a second lock.
revoke all on public.supplier_products, public.supplier_import_runs, public.supplier_import_errors from anon, authenticated;

commit;
