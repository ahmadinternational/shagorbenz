-- Rollback for 20261111000000_supplier_catalog.sql
--
-- WARNING: this permanently deletes the supplier mapping, import history and the values stored in the
-- columns below (brand, sku, images, specifications, is_active, is_supplier_product, manual_overrides).
-- Products themselves, their orders and reviews are NOT touched. Imported supplier products stay in
-- `products` as ordinary rows; delete them separately if you want them gone.
-- `options` is intentionally kept — it predates this migration (see README).
begin;
drop function if exists public.supplier_insert_product(jsonb, jsonb);
drop table if exists public.supplier_import_errors;
drop table if exists public.supplier_import_runs;
drop table if exists public.supplier_products;
drop index if exists public.products_hidden_idx;
drop index if exists public.products_brand_idx;
alter table public.products
  drop column if exists manual_overrides,
  drop column if exists is_supplier_product,
  drop column if exists is_active,
  drop column if exists specifications,
  drop column if exists images,
  drop column if exists sku,
  drop column if exists brand;
commit;
