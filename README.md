# SHAGORBENZ

Bengali-language e-commerce storefront + admin panel. Vite (vanilla JS) on the front, Supabase as the backend, deployed on Vercel.

```bash
npm install
npm run dev        # http://localhost:5173  (admin: /admin)
npm run build      # → dist/
```

Optional `.env` (defaults to the project already in the code):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Structure

```
index.html            storefront
admin.html            admin panel (served at /admin)
public/icons.svg      icon sprite (Lucide, ISC) — referenced as /icons.svg#i-<name>
src/lib/              supabase client, utils, <dialog>-based overlay + toast manager
src/store/            config.js (delivery zones, coupons) · api.js · templates.js · app.js
src/admin/app.js      admin logic
src/styles/           base.css (tokens, shared UI) · store.css · admin.css
```

Business rules live in [src/store/config.js](src/store/config.js): delivery zones/charges, coupon codes, page size, low-stock threshold.

## Product options (colour / size)

Options are stored in one `jsonb` column on `products`. **Run this once in the Supabase SQL editor** before saving options from the admin panel (the storefront works without it — products just have no options):

```sql
alter table public.products
  add column if not exists options jsonb not null default '[]'::jsonb;
```

Each option looks like `{ "id": "gold", "label": "Gold", "image": "https://…", "price": 619, "old_price": 799, "stock": 5 }`. `price`, `old_price` and `stock` are optional: blank price inherits the product price, blank stock means unlimited. When a product has options the customer must pick one before adding to the cart; each option is its own cart line, has its own stock cap, and the chosen option is written into the order item (`variant`, plus the label inside `title`).

## Checkout fields

Name, mobile, optional alternate mobile, district (all 64), thana/upazila and address. The `orders` table has no columns for them, so thana, district, alternate mobile, delivery zone, coupon and note are appended to the `address` text. Choosing any district other than Dhaka switches the delivery charge to "outside Dhaka".

## Things to harden on the Supabase side

The browser only ever holds the public **anon** key, so real protection must come from Row Level Security. Worth reviewing:

1. **Admin login.** `admins` stores plaintext passwords and is queried with the anon key. Anyone who can `select` that table can read every password. Move to **Supabase Auth** (email + password), then give the `products`, `reviews` (delete) and `orders` (update/select-all) write policies to `auth.uid()` of admin users only, and drop the `admins` table.
2. **Order history lives in the customer's browser.** After checkout the order is saved in `localStorage` (`shagorbenzMyOrders`) and shown under "আমার অর্ডার" with no phone number needed; live status is fetched by the saved **order ids** (`orders.select().in('order_id', …)`). That still needs an RLS policy that lets the anon key `select` from `orders`, which also lets anyone who guesses ids read other orders. For a tighter setup, expose a `security definer` RPC such as `get_orders_by_ids(ids text[])`, allow anon **insert only** on `orders`, and switch `fetchOrdersByIds` in [src/store/api.js](src/store/api.js) to call it. Customers on a new device (or after clearing browser data) will not see old orders.
3. **Price / total / coupons are computed in the browser.** The storefront re-checks live price and stock right before placing an order, but a malicious client can still send any `total_price`. Validate in a Postgres trigger or an RPC (`place_order`) if that matters.
4. **Order extras.** Add real columns (`district`, `thana`, `alt_phone`, `delivery_zone`, `delivery_charge`, `coupon`, `note`) when convenient, then send them from `placeOrder` in [src/store/app.js](src/store/app.js) instead of appending to `address`.
