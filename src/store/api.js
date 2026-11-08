// Data access for the storefront. Everything that talks to Supabase lives here.

import { supabase } from '../lib/supabase.js';
import { storage } from '../lib/utils.js';

const CACHE_KEY = 'sb:products:v3'; // bumped: products now carry `variants`
const PAGE_SIZE = 1000; // PostgREST default max rows per request

const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

/**
 * Product options (colour, size …) live in the `options` jsonb column:
 *   [{ "id": "gold", "label": "Gold", "image": "https://…", "price": 619, "old_price": 799, "stock": 5 }]
 * `price`, `old_price` and `stock` are optional — blank means "inherit from the product" (stock: unlimited).
 */
function normalizeVariants(raw) {
    let list = raw;
    if (typeof list === 'string') {
        try {
            list = JSON.parse(list);
        } catch {
            list = [];
        }
    }
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const blank = (v) => v === null || v === undefined || v === '';
    return list
        .map((v, index) => {
            const label = String(v?.label ?? '').trim();
            if (!label) return null;
            let id = String(v.id ?? `v${index}`);
            if (seen.has(id)) id = `${id}-${index}`;
            seen.add(id);
            const price = blank(v.price) ? null : num(v.price);
            return {
                id,
                label,
                image: v.image || '',
                price: price > 0 ? price : null,
                oldPrice: num(v.old_price ?? v.oldPrice),
                stock: blank(v.stock) ? null : num(v.stock)
            };
        })
        .filter(Boolean);
}

/** DB row (snake_case) → app product (camelCase, ids always strings). */
export function mapProduct(row) {
    const basePrice = num(row.price);
    const baseOldPrice = num(row.old_price);
    const variants = normalizeVariants(row.options);

    // With options, `price`/`oldPrice` describe the cheapest option ("থেকে ৳…") — handy for sorting, filtering, cards.
    let price = basePrice;
    let oldPrice = baseOldPrice;
    if (variants.length) {
        const cheapest = variants
            .map((v) => ({ price: v.price ?? basePrice, oldPrice: v.price !== null ? v.oldPrice : baseOldPrice }))
            .reduce((a, b) => (b.price < a.price ? b : a));
        price = cheapest.price;
        oldPrice = cheapest.oldPrice;
    }

    return {
        id: String(row.id),
        title: String(row.title ?? '').trim(),
        price,
        oldPrice,
        basePrice,
        baseOldPrice,
        variants,
        category: String(row.category ?? '').trim(),
        image: row.image || '',
        // null/undefined stock = "not tracked" → treated as always available.
        stock: row.stock === null || row.stock === undefined ? null : num(row.stock),
        description: row.description || '',
        priority: num(row.priority),
        createdAt: row.created_at || null
    };
}

// ── Options helpers ──
export const hasVariants = (p) => p.variants.length > 0;
export const variantOf = (p, variantId) => (variantId ? p.variants.find((v) => v.id === variantId) || null : null);
/** Cart-line identity: the product id, plus the option id when one was chosen. */
export const lineKey = (id, variantId = null) => (variantId ? `${id}~${variantId}` : String(id));
export const priceOf = (p, v = null) => (v ? (v.price ?? p.basePrice) : p.price);
export const oldPriceOf = (p, v = null) => (v ? (v.price !== null ? v.oldPrice : p.baseOldPrice) : p.oldPrice);
/** True when options are priced differently, i.e. the card should say "থেকে ৳…". */
export const hasPriceRange = (p) => hasVariants(p) && new Set(p.variants.map((v) => v.price ?? p.basePrice)).size > 1;

/** Remaining units (Infinity when not tracked). For a product with options and no option given: the total. */
export function stockOf(p, v = null) {
    if (v) return v.stock === null ? Infinity : Math.max(0, v.stock);
    if (hasVariants(p)) {
        let total = 0;
        for (const x of p.variants) {
            const s = stockOf(p, x);
            if (s === Infinity) return Infinity;
            total += s;
        }
        return total;
    }
    return p.stock === null ? Infinity : Math.max(0, p.stock);
}
export const isSoldOut = (p, v = null) => stockOf(p, v) <= 0;

// ───────────────────────── Products ─────────────────────────

async function fetchAllProducts() {
    const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('priority', { ascending: true })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE);
    if (error) throw error;
    return (data || []).map(mapProduct).filter((p) => p.id && p.title);
}

function readCache() {
    const cached = storage.get(CACHE_KEY);
    return cached && Array.isArray(cached.products) ? cached.products : null;
}

/**
 * Stale-while-revalidate: cached products render instantly, then fresh data
 * replaces them (and `onUpdate` fires) as soon as the network answers.
 * Throws only when there is neither a cache nor a network response.
 */
export async function loadProducts({ onUpdate } = {}) {
    const cached = readCache();

    const revalidate = fetchAllProducts().then((fresh) => {
        storage.set(CACHE_KEY, { products: fresh, savedAt: Date.now() });
        return fresh;
    });

    if (cached?.length) {
        revalidate
            .then((fresh) => {
                if (JSON.stringify(fresh) !== JSON.stringify(cached)) onUpdate?.(fresh);
            })
            .catch((err) => console.warn('Background refresh failed:', err));
        return { products: cached, fromCache: true };
    }

    return { products: await revalidate, fromCache: false };
}

export async function fetchProductsByIds(ids) {
    if (!ids.length) return [];
    const { data, error } = await supabase.from('products').select('*').in('id', ids);
    if (error) throw error;
    return (data || []).map(mapProduct);
}

// ───────────────────────── Reviews ─────────────────────────

/** One query for every product's rating (replaces the old one-query-per-card pattern). */
export async function fetchReviewStats() {
    const stats = new Map();
    try {
        const { data, error } = await supabase.from('reviews').select('product_id, rating').limit(PAGE_SIZE * 5);
        if (error) throw error;
        const sums = new Map();
        for (const row of data || []) {
            const key = String(row.product_id);
            const entry = sums.get(key) || { total: 0, count: 0 };
            entry.total += num(row.rating);
            entry.count += 1;
            sums.set(key, entry);
        }
        sums.forEach(({ total, count }, key) => stats.set(key, { avg: total / count, count }));
    } catch (err) {
        console.warn('Could not load review stats:', err);
    }
    return stats;
}

export async function fetchReviews(productId) {
    const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .eq('product_id', productId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function insertReview(productId, { name, rating, comment }) {
    const { error } = await supabase.from('reviews').insert({
        product_id: productId,
        customer_name: (name || '').trim() || 'ক্রেতা',
        rating: Math.min(5, Math.max(1, Number(rating) || 5)),
        comment: (comment || '').trim()
    });
    if (error) throw error;
}

// ───────────────────────── Orders ─────────────────────────

/** Fetches the latest state of orders this browser placed (looked up by order id, never by phone). */
export async function fetchOrdersByIds(orderIds) {
    if (!orderIds.length) return [];
    const { data, error } = await supabase.from('orders').select('*').in('order_id', orderIds);
    if (error) throw error;
    return data || [];
}

export async function insertOrder(order) {
    const { error } = await supabase.from('orders').insert(order);
    if (error) throw error;
}

let ordersChannel = null;

export function unsubscribeOrders() {
    if (ordersChannel) {
        supabase.removeChannel(ordersChannel);
        ordersChannel = null;
    }
}

/** Live status updates for the orders saved in this browser. */
export function subscribeOrders(orderIds, onUpdate) {
    unsubscribeOrders();
    if (!orderIds.length) return;
    // Realtime's `in` filter accepts at most 100 values; ids are "SB-YYMMDD-NNNNN" so no quoting is needed.
    const filter = `order_id=in.(${orderIds.slice(0, 100).join(',')})`;
    ordersChannel = supabase
        .channel(`my-orders-${Date.now()}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter }, (payload) =>
            onUpdate(payload.new)
        )
        .subscribe();
}
