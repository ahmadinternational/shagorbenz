# SHAGORBENZ

Bengali-language e-commerce storefront + admin panel — **"Technology Meets Luxury"**. Vite (vanilla JS) on the front, Supabase as the backend, deployed on Vercel.

```bash
npm install
npm run dev        # http://localhost:5173  (admin: /admin)
npm run build      # → dist/
npm run supplier:test   # importer + migration tests
```

Optional `.env` for the website (defaults to the project already in the code — the public anon key only):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Structure

```
index.html              storefront
admin.html              admin panel (served at /admin)
public/icons.svg        icon sprite (Lucide, ISC) — referenced as /icons.svg#i-<name>
src/lib/                supabase client, utils, <dialog>-based overlay + toast manager
src/store/              config.js (delivery zones, coupons, icons) · api.js · templates.js · app.js
src/admin/app.js        admin logic
src/styles/             base.css  design tokens + shared UI (also used by the admin, light theme)
                        glass.css storefront dark-glass theme: re-points tokens, restyles buttons/forms/dialogs/toasts
                        store.css storefront layout & components
                        admin.css admin only
supabase/migrations/    SQL for supplier-catalog support (additive, idempotent)
supabase/rollbacks/     matching rollback
scripts/supplier/       supplier import engine (server-side CLI) + tests
```

## Design system

Dark glassmorphism, tokens in [src/styles/glass.css](src/styles/glass.css): `#050608` / `#090D12` backgrounds, glass = white 4.5 % + 10 % hairline border, cyan `#00E5FF → #00A8FF` accent, Sora (display) + Inter + Noto Sans Bengali. `backdrop-filter` is used on the header, panels, dialogs and dock — **not** on every product card (a flat translucent surface looks identical there and is much cheaper to paint). Product photos sit on a dark "stage" with `object-fit: contain`; broken images swap to a placeholder. Animations are transform/opacity only and switch off under `prefers-reduced-motion`.

Notes: the muted text colour is `#7D8B9C` rather than `#657383` (that one is 4.2 : 1 on `#050608`, below WCAG AA for small text; this is 4.7–5.8 : 1). The sale badge is a deeper red so white text stays ≥ 4.6 : 1.

Grid: 2 columns on phones, 4 on tablets (≥ 768 px), 6 on desktop (≥ 1200 px, where the filter bar becomes inline).

Business rules live in [src/store/config.js](src/store/config.js): delivery zones/charges, coupon codes, page size, low-stock threshold.

## Product data

The storefront reads the `products` table (`select *`, paged 1000 rows at a time, cached in `localStorage`). Columns it understands:

| column | notes |
|---|---|
| `id, title, price, old_price, image, category, stock, description, priority, created_at` | existing |
| `options` (jsonb) | colour/size options, see below |
| `brand`, `sku` | shown on cards/detail; **brand filter** appears automatically when any product has a brand; search matches both |
| `images` (jsonb array of URLs) | extra gallery photos (the main photo stays in `image`) |
| `specifications` (jsonb `[{label, value}]`) | shown as a table on the detail view |
| `is_active` (bool) | `false` hides a product everywhere (and it can no longer be ordered) |
| `is_supplier_product` (bool), `manual_overrides` (jsonb) | used by the importer/admin, never displayed |

All new columns are optional: until the migration below is run the storefront and admin behave exactly as before.

### Product options (colour / size)

Options are stored in one `jsonb` column on `products` (the migration below also adds it if missing):

```sql
alter table public.products
  add column if not exists options jsonb not null default '[]'::jsonb;
```

Each option looks like `{ "id": "gold", "label": "Gold", "image": "https://…", "price": 619, "old_price": 799, "stock": 5 }`. `price`, `old_price` and `stock` are optional: blank price inherits the product price, blank stock means unlimited. When a product has options the customer must pick one before adding to the cart; each option is its own cart line, has its own stock cap, and the chosen option is written into the order item (`variant`, plus the label inside `title`).

## Checkout fields

Name, mobile, optional alternate mobile, district (all 64), thana/upazila and address. The `orders` table has no columns for them, so thana, district, alternate mobile, delivery zone, coupon and note are appended to the `address` text. Choosing any district other than Dhaka switches the delivery charge to "outside Dhaka". The cart shows subtotal, coupon, delivery and total; the order stores each item's title, quantity and unit price at purchase time. If saving the order fails, no success screen is shown, the cart is kept and a persistent error appears above the confirm button.

---

## Supplier catalog — Badhon's World

### What was found (read before you import)

* `robots.txt` allows ordinary crawlers (`User-agent: *`, `Allow: /`) and blocks named AI-training bots.
* Badhon's World / **MayonsBd** is a **closed reseller programme**. Its public *Seller Terms* say product photos/videos are distributed to resellers through a login-gated reseller panel/private group, that **any MayonsBd image or video may only be shared WITH its watermark**, and that panel access must not be shared. Nothing public says the catalog may be bulk-copied; the shop loads its products from a separate JSON API that is not documented.
* The **importer itself never contacts the supplier**: it reads a feed file (JSON/JSONL/CSV) — ideally an export the supplier gives you. When none exists, a separate, polite collector can build that file from the public pages (and, with your own login, the reseller prices) — see "Collecting the catalog from the supplier's website" below. Whether you may republish their photos and text is a question for the supplier; the watermark must stay.
* Images are stored **by URL only** (never re-hosted, cropped or edited), so the supplier's watermark is preserved exactly as served.

### One-time database setup

1. Back up (Supabase → Database → Backups).
2. Run [supabase/migrations/20261111000000_supplier_catalog.sql](supabase/migrations/20261111000000_supplier_catalog.sql) in the SQL editor. It is **additive and idempotent** — it drops nothing, existing rows only get safe defaults, and it copies whatever type `products.id` really has. Rollback: [supabase/rollbacks/…rollback.sql](supabase/rollbacks/20261111000000_supplier_catalog_rollback.sql).

What it adds: customer-facing columns on `products` (above) and three **private** tables — `supplier_products` (supplier id/URL/category/**cost price**/stock/sync state), `supplier_import_runs` (history) and `supplier_import_errors` (failures) — with RLS enabled, **no policies** and all privileges revoked from `anon`/`authenticated`. Supplier cost prices and URLs therefore never reach the browser. It also adds `supplier_insert_product()`, which creates a product **and** its mapping in one transaction so a crash can never leave an orphan that would be re-imported as a duplicate.

### Running an import

The importer is a Node script that runs on your machine/CI with the **service-role key** (`.env.supplier`, git-ignored; never a `VITE_*` variable, never in the browser):

```bash
cp .env.supplier.example .env.supplier        # fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

npm run supplier:validate -- --file supplier-feeds/catalog.json     # checks the file only, no database
npm run supplier:import   -- --file supplier-feeds/catalog.json --dry-run     # read-only preview
npm run supplier:import   -- --file supplier-feeds/catalog.json --complete    # real import
npm run supplier:report                                                       # history, open errors, counts
```

Input: `.json` (array or `{ "products": [...] }`), `.jsonl`, or `.csv` (header row = field names, `images` separated by `|`). Fields — only `supplier_product_id`, `title`, `price` and one valid `images` URL are required; everything else stays empty if absent (nothing is invented):

| field | meaning |
|---|---|
| `supplier_product_id` | stable id (**required**) |
| `url` | product page (canonicalised: no `#`, no `utm_*`, no trailing `/`) |
| `title` / `title_en` / `title_bn`, `description` | text is stored as given (Bengali/English preserved, not translated) |
| `category` | string or array (`["Electronics","Earbuds"]` → leaf = storefront category, full path kept as `supplier_category`) |
| `brand`, `sku` | |
| `price`, `regular_price` | numbers or strings like `৳ ১,২৯০` |
| `images` | array (or `a\|b` in CSV); first = main |
| `variants` | `[{ label, image?, price?, stock? }]` → one product with options (never separate products) |
| `specifications` | `[{label,value}]` or `{ "Battery": "500 mAh" }` |
| `stock_status` / `stock_quantity` | `in_stock` / `out_of_stock` / quantity |

Rows that cannot be trusted (no id, price ≤ 0, no usable image, bad URL) are **rejected and logged**, never half-imported.

| flag | effect |
|---|---|
| `--mode all\|new\|update` | create+update (default) · only create · only update |
| `--dry-run` | no writes |
| `--complete` | the file is the *whole* catalog → turns on "no longer listed" detection |
| `--sync-prices` | move the selling price when the supplier price changed |
| `--sync-images`, `--sync-content` | refresh photos / text fields |
| `--no-sync-stock` | leave availability alone |
| `--markup-percent N` | optional explicit pricing rule (default **0** = selling price = supplier price) |
| `--category-map f.json` | `{ "Supplier category": "SHAGORBENZ category" }` (original kept separately) |
| `--batch N --delay-ms N --limit N` | batch size (50) / pause between batches (200 ms) / partial run |
| `--resume <runId>`, `--retry-failed` | continue an interrupted run · re-process products that failed |
| `--verify-images` | HEAD-check URLs, ~3/s (broken main image → product refused; broken gallery image dropped) |

### Guarantees (all covered by `npm run supplier:test`)

* **No duplicates.** Identity = `(supplier, supplier_product_id)` plus canonical URL, enforced by unique indexes. Re-running only updates; duplicates inside one file are imported once and counted.
* **Your edits survive.** Supplier price → stored only in the private table unless `--sync-prices`; even then a selling price you changed by hand is left alone, and any field an admin edited on a supplier product is recorded in `manual_overrides` and never overwritten. Default sync never rewrites titles, text, images or categories.
* **Nothing is deleted.** A product missing from the supplier is first counted; only after it is absent from **2 consecutive complete runs** is it marked unavailable (stock 0). It reappears automatically if the supplier lists it again. Orders and reviews are never touched. Partial runs (`--limit`, `--retry-failed`, no `--complete`) never mark anything unavailable.
* **Safe execution.** Batches, retry with back-off on 429/5xx/network errors, one bad record never stops the batch, a lock prevents two importers at once, every run and failure is logged to the private tables.

### What the admin panel can do today

Source badge (SHAGORBENZ / Badhon's World), show/hide toggle, brand/SKU/extra photos/specifications/visibility fields, and recording of hand-edited fields — all appear once the migration has run. **Import buttons and the import-history view are deliberately not in the browser admin.** The admin signs in against a plaintext `admins` table using the public key (see below), so nothing in the browser can securely authorize a privileged import or be allowed to read supplier cost prices. Use `supplier:import` / `supplier:report`; the in-browser version should come after the admin moves to Supabase Auth.

### Collecting the catalog from the supplier's website (no API)

When no feed is available, the public pages can be read the way a visitor sees them. This needs a browser driver that is **not** a project dependency: `npm i --no-save playwright-core` and Chrome/Chromium (`CHROME_PATH`, default `/usr/bin/google-chrome`).

```bash
npm run supplier:collect                      # public pages → supplier-feeds/raw   (≈ 2 s pause per page; resumable)
SUPPLIER_LOGIN=01XXXXXXXXX SUPPLIER_PASSWORD='…' \
  node scripts/supplier/collect-public-site.mjs --out supplier-feeds --reseller   # YOUR reseller login → raw-reseller
npm run supplier:build-feed                   # → supplier-feeds/badhons-world.json + build-report.json
npm run supplier:validate -- --file supplier-feeds/badhons-world.json
```

* It reads only what the pages show — never the site's JSON API, never CAPTCHA/Cloudflare tricks — and does not download images (only their addresses). Interrupted runs continue where they stopped.
* `--reseller` signs in **once** with your own account (credentials only from the environment; nothing is written to disk), opens the same product pages, and signs out. The supplier's reseller terms forbid sharing panel access with others, so use your own login and change the password if it was ever shared in chat/email.
* **Prices.** The signed-in page shows *Buy rate* (what you pay), *Commission* and *Minimum selling price*. These go to the **private** `supplier_products` table (`supplier_price`, `min_selling_price`) and are never sent to the browser. The shop's initial selling price is the **lower of the supplier's public price and the price it shows resellers, never below its minimum selling price** (`--selling-price lowest`, default — so the supplier's own website can never undercut the shop); `reseller` / `public` are the alternatives. Change prices afterwards in the admin panel (it does not know the private minimum, so do not go below it). The supplier's "previous price" is *its* list price, which this shop never charged, so it is **not** shown as a discount unless you pass `--keep-old-price`. `build-feed` reports any row whose price is below the minimum or below the buy rate (currently none).
* Products the supplier lists with **price ৳0** are not priced yet; the importer refuses them (`unpricedAtSupplier` in the report) and re-tries them with `--retry-failed` once they have a price.
* The shop publishes **no category**, so categories come from the keyword rules in [scripts/supplier/category-rules.json](scripts/supplier/category-rules.json) (editable; they reuse your existing names such as *Power Bank*, *Lamp*, *Fan*). The supplier's own category stays empty.
* Descriptions drop the supplier's warranty/return-policy footer and "inbox Badhon's World to order" lines (so customers are not sent to the supplier); "Technical specifications" bullet lists move into the specifications table. The untouched original pages stay in `supplier-feeds/raw*`.
* Products with exactly one option (e.g. only "Black") are added to the cart straight from the card; the option is still written to the order item.
* `supplier-feeds/` and `.supplier-state/` are git-ignored because they contain your buy rates.

### Importing into Supabase

1. Run the migration (above) — it is safe to run again after an update.
2. Put the **service-role key** in `.env.supplier` on the machine that runs the import (never in chat, never committed).
3. `npm run supplier:import -- --file supplier-feeds/badhons-world.json --dry-run`, then without `--dry-run` and with `--complete` (this file is the whole public catalog), then `npm run supplier:report`.

## Things to harden on the Supabase side

The browser only ever holds the public **anon** key, so real protection must come from Row Level Security. Worth reviewing:

1. **Admin login.** `admins` stores plaintext passwords and is queried with the anon key, the "logged in" state is a `localStorage` flag, and the admin panel writes/deletes `products` with the anon key — so write access to `products`, `orders` and `reviews` is effectively public unless RLS says otherwise. Anyone who can `select` that table can read every password. Move to **Supabase Auth** (email + password), then give the `products`, `reviews` (delete) and `orders` (update/select-all) write policies to `auth.uid()` of admin users only, and drop the `admins` table.
2. **Order history lives in the customer's browser.** After checkout the order is saved in `localStorage` (`shagorbenzMyOrders`) and shown under "আমার অর্ডার" with no phone number needed; live status is fetched by the saved **order ids** (`orders.select().in('order_id', …)`). That still needs an RLS policy that lets the anon key `select` from `orders`, which also lets anyone who guesses ids read other orders. For a tighter setup, expose a `security definer` RPC such as `get_orders_by_ids(ids text[])`, allow anon **insert only** on `orders`, and switch `fetchOrdersByIds` in [src/store/api.js](src/store/api.js) to call it. Customers on a new device (or after clearing browser data) will not see old orders.
3. **Price / total / coupons are computed in the browser.** The storefront re-checks live price, stock and visibility right before placing an order, but a malicious client can still send any `total_price`. Validate in a Postgres trigger or an RPC (`place_order`) if that matters.
4. **Order extras.** Add real columns (`district`, `thana`, `alt_phone`, `delivery_zone`, `delivery_charge`, `coupon`, `note`) when convenient, then send them from `placeOrder` in [src/store/app.js](src/store/app.js) instead of appending to `address`.
5. `products.is_supplier_product` and `manual_overrides` are readable by the public key (they hold no supplier name, price or URL). Everything sensitive is in the private `supplier_*` tables.
