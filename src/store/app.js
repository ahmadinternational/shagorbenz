// SHAGORBENZ storefront — application logic.
// Layout: state → small managers (cart, wishlist, …) → render functions → event wiring → init.

import {
    $, $$, debounce, normalizePhone, isValidPhone, formatNumber, formatPrice,
    storage, copyText, toEnglishDigits
} from '../lib/utils.js';
import { openDialog, closeDialog, bindDialog, Toast } from '../lib/overlay.js';
import { whatsappLink } from '../lib/supabase.js';
import { CONFIG } from './config.js';
import * as api from './api.js';
import * as T from './templates.js';

const state = {
    products: [],
    byId: new Map(),
    stats: new Map(), // productId → { avg, count }
    cart: [],
    wishlist: [], // product ids
    recent: [], // product ids
    orders: [], // orders placed from this browser (same shape as DB rows)
    filters: { category: 'all', brand: 'all', min: '', max: '', discount: false, stock: false, sort: 'default', query: '' },
    categoriesExpanded: false,
    visible: CONFIG.PAGE_SIZE,
    coupon: null,
    deliveryId: CONFIG.DELIVERY[0].id,
    step: 'cart',
    detailId: null,
    detailVariantId: null,
    detailQty: 1, // quantity picked before the product is in the cart
    detailImage: 0, // gallery index
    placing: false
};

const el = {};
const dlg = {};
const baseTitle = document.title;

// ───────────────────────── Helpers ─────────────────────────

const getProduct = (id) => state.byId.get(String(id));
const cartItem = (key) => state.cart.find((i) => i.key === key);
const cartQty = (key) => cartItem(key)?.quantity || 0;
const isWished = (id) => state.wishlist.includes(id);
const cartCount = () => state.cart.reduce((sum, i) => sum + i.quantity, 0);
const zone = () => CONFIG.DELIVERY.find((z) => z.id === state.deliveryId) || CONFIG.DELIVERY[0];
const deliverySentence = () => CONFIG.DELIVERY.map((z) => `${z.label} ${formatPrice(z.charge)}`).join(' · ');

function setBadge(node, count) {
    if (!node) return;
    node.textContent = formatNumber(count);
    node.hidden = count <= 0;
}

/** Re-rendering buttons drops keyboard focus; put it back on the equivalent control. */
const idOf = (node) => node?.dataset?.key ?? node?.dataset?.id;
function captureFocus() {
    const active = document.activeElement;
    if (!active?.dataset?.action || !idOf(active)) return null;
    return {
        scope: active.closest('dialog, #productGrid, #recentGrid') || document,
        action: active.dataset.action,
        id: idOf(active)
    };
}
function restoreFocus(snapshot) {
    if (!snapshot) return;
    const id = CSS.escape(snapshot.id);
    const sel = (action) =>
        `[data-action="${action}"][data-key="${id}"]:not(:disabled), [data-action="${action}"][data-id="${id}"]:not(:disabled)`;
    for (const action of [snapshot.action, 'increase-qty', 'add-to-cart', 'decrease-qty', 'detail-qty-dec']) {
        const target = snapshot.scope.querySelector(sel(action));
        if (target) {
            target.focus({ preventScroll: true });
            return;
        }
    }
}

// ───────────────────────── Cart ─────────────────────────

const Cart = {
    load() {
        const stored = storage.get(CONFIG.KEYS.CART, []);
        state.cart = (Array.isArray(stored) ? stored : [])
            .filter((i) => i && i.id !== undefined && Number(i.quantity) > 0)
            .map((i) => {
                const id = String(i.id);
                const variantId = i.variantId ? String(i.variantId) : null;
                return {
                    key: api.lineKey(id, variantId), // older saved carts have no key/variant
                    id,
                    variantId,
                    variant: i.variant || '',
                    title: String(i.title || ''),
                    price: Number(i.price) || 0,
                    image: i.image || '',
                    quantity: Math.floor(Number(i.quantity))
                };
            });
    },
    save() {
        storage.set(CONFIG.KEYS.CART, state.cart);
        updateCartUI();
    },
    /** Adds one unit (or `qty`). Products with options need `variantId`. */
    add(id, { variantId = null, qty = 1 } = {}) {
        const p = getProduct(id);
        if (!p) return Toast.error('পণ্যটি পাওয়া যায়নি'), false;
        const v = api.variantOf(p, variantId);
        if (api.hasVariants(p) && !v) return Toast.error('একটি অপশন বেছে নিন'), false;
        if (api.isSoldOut(p, v)) return Toast.error('দুঃখিত, পণ্যটি স্টকে নেই'), false;

        const key = api.lineKey(p.id, v?.id);
        const existing = cartItem(key);
        const nextQty = (existing?.quantity || 0) + qty;
        const max = api.stockOf(p, v);
        if (nextQty > max) return Toast.error(`সর্বোচ্চ ${formatNumber(max)}টি অর্ডার করা যাবে`), false;
        if (existing) existing.quantity = nextQty;
        else
            state.cart.push({
                key,
                id: p.id,
                variantId: v?.id || null,
                variant: v?.label || '',
                title: p.title,
                price: api.priceOf(p, v),
                image: v?.image || p.image,
                quantity: qty
            });
        this.save();
        if (!existing) Toast.success('কার্টে যোগ হয়েছে');
        return true;
    },
    changeQty(key, delta) {
        const item = cartItem(key);
        if (!item) return;
        const next = item.quantity + delta;
        if (next <= 0) return this.remove(key);
        const p = getProduct(item.id);
        const max = p ? api.stockOf(p, api.variantOf(p, item.variantId)) : Infinity;
        if (delta > 0 && next > max) return Toast.error(`সর্বোচ্চ ${formatNumber(max)}টি অর্ডার করা যাবে`);
        item.quantity = next;
        this.save();
    },
    remove(key) {
        state.cart = state.cart.filter((i) => i.key !== key);
        this.save();
    },
    clear() {
        state.cart = [];
        state.coupon = null;
        this.save();
    },
    /**
     * Re-syncs a saved line with the live product: title, price, image, option label, quantity cap.
     * Returns null when the product (or its chosen option) no longer exists.
     */
    refreshLine(item, p) {
        if (!p) return null;
        const v = api.variantOf(p, item.variantId);
        if ((item.variantId && !v) || (!item.variantId && api.hasVariants(p))) return null;
        const max = api.stockOf(p, v);
        return {
            ...item,
            title: p.title,
            variant: v?.label || '',
            price: api.priceOf(p, v),
            image: v?.image || p.image,
            quantity: api.isSoldOut(p, v) ? item.quantity : Math.min(item.quantity, max)
        };
    },
    /** Align stored cart lines with the live catalog (price, availability, quantity caps). */
    reconcile() {
        if (!state.products.length || !state.cart.length) return;
        const dropped = [];
        let repriced = false;
        state.cart = state.cart.flatMap((item) => {
            const next = this.refreshLine(item, getProduct(item.id));
            if (!next) {
                dropped.push(item.title);
                return [];
            }
            if (next.price !== item.price) repriced = true;
            return [next];
        });
        storage.set(CONFIG.KEYS.CART, state.cart);
        if (dropped.length) Toast.info('কিছু পণ্য বা অপশন আর পাওয়া যাচ্ছে না — কার্ট আপডেট করা হয়েছে');
        else if (repriced) Toast.info('কিছু পণ্যের দাম বদলেছে — কার্টে নতুন দাম দেখানো হচ্ছে');
    },
    totals() {
        const subtotal = state.cart.reduce((s, i) => s + i.price * i.quantity, 0);
        const savings = state.cart.reduce((s, i) => {
            const p = getProduct(i.id);
            const old = p ? api.oldPriceOf(p, api.variantOf(p, i.variantId)) : 0;
            return s + (old > i.price ? (old - i.price) * i.quantity : 0);
        }, 0);
        const c = state.coupon;
        const discount = c ? Math.min(subtotal, c.type === 'percent' ? Math.round((subtotal * c.value) / 100) : c.value) : 0;
        const delivery = state.cart.length ? zone().charge : 0;
        return { subtotal, savings, discount, delivery, total: subtotal - discount + delivery };
    }
};

// ───────────────────────── Wishlist / Recent ─────────────────────────

const Wishlist = {
    load() {
        const stored = storage.get(CONFIG.KEYS.WISHLIST, []);
        // Older versions stored full objects; keep just the ids.
        state.wishlist = [...new Set((Array.isArray(stored) ? stored : []).map((i) => String(i?.id ?? i)))];
    },
    save() {
        storage.set(CONFIG.KEYS.WISHLIST, state.wishlist);
        updateWishlistUI();
    },
    toggle(id) {
        if (!getProduct(id)) return;
        if (isWished(id)) {
            state.wishlist = state.wishlist.filter((x) => x !== id);
            Toast.info('পছন্দের তালিকা থেকে সরানো হয়েছে');
        } else {
            state.wishlist = [id, ...state.wishlist];
            Toast.success('পছন্দের তালিকায় যোগ হয়েছে');
        }
        this.save();
    }
};

const Recent = {
    load() {
        const stored = storage.get(CONFIG.KEYS.RECENT, []);
        state.recent = (Array.isArray(stored) ? stored : []).map(String).slice(0, CONFIG.RECENT_LIMIT);
    },
    add(id) {
        state.recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, CONFIG.RECENT_LIMIT);
        storage.set(CONFIG.KEYS.RECENT, state.recent);
    },
    render() {
        const items = state.recent.map(getProduct).filter(Boolean).slice(0, 4);
        el.recentSection.hidden = !items.length;
        el.recentGrid.innerHTML = items.map(productCardFor).join('');
    }
};

// ───────────────────────── My orders (saved in this browser) ─────────────────────────

const MyOrders = {
    load() {
        this.migrateLegacy();
        const stored = storage.get(CONFIG.KEYS.ORDERS, []);
        state.orders = (Array.isArray(stored) ? stored : [])
            .filter((o) => o?.order_id)
            .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    },
    save() {
        state.orders = state.orders.slice(0, CONFIG.MAX_SAVED_ORDERS);
        storage.set(CONFIG.KEYS.ORDERS, state.orders);
    },
    add(order) {
        state.orders = [order, ...state.orders.filter((o) => o.order_id !== order.order_id)];
        this.save();
    },
    /** Folds fresher server rows into the saved copies. Returns true when anything changed. */
    merge(rows) {
        let changed = false;
        for (const row of rows) {
            const i = state.orders.findIndex((o) => o.order_id === row.order_id);
            if (i === -1) continue;
            const next = { ...state.orders[i], ...row };
            if (JSON.stringify(next) !== JSON.stringify(state.orders[i])) {
                state.orders[i] = next;
                changed = true;
            }
        }
        if (changed) this.save();
        return changed;
    },
    /** The previous version kept history under `userOrderHistory` (two different shapes). Keep those customers' orders. */
    migrateLegacy() {
        const legacy = storage.get(CONFIG.KEYS.LEGACY_ORDERS, null);
        if (!Array.isArray(legacy)) return;
        const current = storage.get(CONFIG.KEYS.ORDERS, []);
        const known = new Set(current.map((o) => o.order_id));
        const converted = legacy
            .map((e) => {
                const id = e?.order_id || e?.orderId;
                if (!id || known.has(id)) return null;
                const rawItems = e.items && typeof e.items !== 'string' ? e.items : e.rawItems || [];
                return {
                    order_id: id,
                    created_at: e.created_at || null,
                    customer_name: e.customer_name || e.customerInfo?.name || '',
                    phone: e.phone || e.customerInfo?.phone || '',
                    address: e.address || e.customerInfo?.address || '',
                    items: Array.isArray(rawItems)
                        ? rawItems.map((i) => ({ id: i.id, title: i.title, quantity: i.quantity, price: i.price }))
                        : [],
                    total_price: Number(e.total_price ?? e.total) || 0,
                    status: e.status || 'Pending'
                };
            })
            .filter(Boolean);
        storage.set(CONFIG.KEYS.ORDERS, [...current, ...converted]);
        storage.remove(CONFIG.KEYS.LEGACY_ORDERS);
    }
};

// ───────────────────────── Catalog ─────────────────────────

const productCardFor = (p) =>
    T.productCard(p, { qty: cartQty(p.id), wished: isWished(p.id), stat: state.stats.get(p.id) });

function searchProducts(query) {
    const full = query.toLowerCase().trim();
    const tokens = full.split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    return state.products
        .map((p) => {
            const title = p.title.toLowerCase();
            const category = p.category.toLowerCase();
            const brand = p.brand.toLowerCase();
            const haystack = `${title} ${category} ${brand} ${p.sku.toLowerCase()} ${p.description.toLowerCase()}`;
            if (!tokens.every((t) => haystack.includes(t))) return null;
            let score = 0;
            if (title.startsWith(full)) score += 4;
            else if (title.includes(full)) score += 3;
            if (tokens.every((t) => title.includes(t))) score += 2;
            if (category.includes(full) || brand.includes(full)) score += 1;
            return { p, score };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.p);
}

const parsePrice = (value) => {
    const digits = toEnglishDigits(value).replace(/\D/g, '');
    return digits ? Number(digits) : null;
};

function getFiltered() {
    const f = state.filters;
    const min = parsePrice(f.min);
    const max = parsePrice(f.max);
    let relevance = null;
    if (f.query) relevance = new Map(searchProducts(f.query).map((p, i) => [p.id, i]));

    let list = state.products.filter((p) => {
        if (relevance && !relevance.has(p.id)) return false;
        if (f.category !== 'all' && p.category.toLowerCase() !== f.category) return false;
        if (f.brand !== 'all' && p.brand.toLowerCase() !== f.brand) return false;
        if (min !== null && p.price < min) return false;
        if (max !== null && p.price > max) return false;
        if (f.discount && !T.discountPercent(p)) return false;
        if (f.stock && api.isSoldOut(p)) return false;
        return true;
    });

    switch (f.sort) {
        case 'price-asc':
            list.sort((a, b) => a.price - b.price);
            break;
        case 'price-desc':
            list.sort((a, b) => b.price - a.price);
            break;
        case 'discount':
            list.sort((a, b) => T.discountPercent(b) - T.discountPercent(a));
            break;
        case 'name-asc':
            list.sort((a, b) => a.title.localeCompare(b.title, 'bn'));
            break;
        case 'newest':
            list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0) || Number(b.id) - Number(a.id));
            break;
        default:
            // Keep the admin-defined order, but never lead with sold-out items.
            if (relevance) list.sort((a, b) => relevance.get(a.id) - relevance.get(b.id));
            list = [...list.filter((p) => !api.isSoldOut(p)), ...list.filter((p) => api.isSoldOut(p))];
    }
    return list;
}

function categoryMap() {
    const map = new Map();
    for (const p of state.products) {
        if (!p.category) continue;
        const key = p.category.toLowerCase();
        const entry = map.get(key) || { label: p.category, count: 0 };
        entry.count += 1;
        map.set(key, entry);
    }
    return map;
}

/** Real brand names found in the catalog (empty when no product has a brand → no brand filter is shown). */
function brandList() {
    const map = new Map();
    for (const p of state.products) {
        if (!p.brand) continue;
        const key = p.brand.toLowerCase();
        const entry = map.get(key) || { key, label: p.brand, count: 0 };
        entry.count += 1;
        map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** A real photo for a category tile: the first in-stock product of that category that has one. */
function categoryImage(key) {
    const inCat = state.products.filter((p) => p.category.toLowerCase() === key && p.image);
    return (inCat.find((p) => !api.isSoldOut(p)) || inCat[0])?.image || '';
}

const CATEGORY_PREVIEW = 6;

function renderCategories() {
    const map = categoryMap();
    if (state.filters.category !== 'all' && !map.has(state.filters.category)) state.filters.category = 'all';
    const sorted = [...map.entries()].sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label));

    // Sticky chip row inside the catalog
    el.categoryChips.innerHTML =
        T.categoryChip('all', 'সব পণ্য', state.products.length, state.filters.category === 'all') +
        sorted.map(([key, v]) => T.categoryChip(key, v.label, v.count, state.filters.category === key)).join('');
    el.categoryChips.closest('.chips-wrap').hidden = map.size < 2;

    // Showcase tiles: top categories first, the rest behind a toggle
    el.categorySection.hidden = map.size < 2;
    const shown = state.categoriesExpanded ? sorted : sorted.slice(0, CATEGORY_PREVIEW);
    el.categoryGrid.innerHTML = shown
        .map(([key, v]) => T.categoryCard(key, v.label, v.count, categoryImage(key), state.filters.category === key))
        .join('');
    const extra = sorted.length - CATEGORY_PREVIEW;
    el.categoryToggle.hidden = extra <= 0;
    el.categoryToggle.setAttribute('aria-expanded', state.categoriesExpanded);
    el.categoryToggle.textContent = state.categoriesExpanded ? 'কম দেখুন' : `সব ক্যাটাগরি দেখুন (${formatNumber(sorted.length)})`;

    // Footer list
    el.footerCategoriesWrap.hidden = !sorted.length;
    el.footerCategories.innerHTML = sorted.slice(0, 6).map(([key, v]) => T.footerCategoryLink(key, v.label)).join('');
}

/** Hero numbers and floating product chips — all read from the live catalog. */
function renderHero() {
    const inStock = state.products.filter((p) => p.image && !api.isSoldOut(p));
    el.heroStats.hidden = !state.products.length;
    el.statProducts.textContent = formatNumber(state.products.length);
    el.statCategories.textContent = formatNumber(categoryMap().size);
    el.heroFloat.innerHTML = inStock.slice(0, 3).map(T.heroFloatCard).join('');
}

function priceBounds() {
    if (!state.products.length) return null;
    const prices = state.products.map((p) => p.price);
    return { min: Math.min(...prices), max: Math.max(...prices) };
}

function renderFilterPanels() {
    const f = state.filters;
    const brands = brandList();
    const html = (showHead) => T.filterPanel({ ...f, brands, priceBounds: priceBounds(), showHead });
    el.filterSidebar.innerHTML = html(true);
    el.filterSheetBody.innerHTML = html(false);
}

function syncFilterInputs() {
    $$('[data-filter]').forEach((input) => {
        if (input === document.activeElement) return;
        const key = input.dataset.filter;
        if (input.type === 'checkbox') input.checked = !!state.filters[key];
        else input.value = state.filters[key];
    });
}

function activeFilterPills() {
    const f = state.filters;
    const pills = [];
    if (f.query) pills.push(['query', `“${f.query}”`]);
    if (f.category !== 'all') pills.push(['category', categoryMap().get(f.category)?.label || f.category]);
    if (f.brand !== 'all') pills.push(['brand', brandList().find((b) => b.key === f.brand)?.label || f.brand]);
    if (f.min || f.max) pills.push(['price', `${f.min ? formatNumber(parsePrice(f.min)) : '০'} – ${f.max ? formatNumber(parsePrice(f.max)) : 'যেকোনো'} ৳`]);
    if (f.discount) pills.push(['discount', 'ছাড়ের পণ্য']);
    if (f.stock) pills.push(['stock', 'স্টকে আছে']);
    return pills;
}

function renderActiveFilters() {
    const pills = activeFilterPills();
    el.activeFilters.hidden = !pills.length;
    el.activeFilters.innerHTML = pills.length
        ? pills
              .map(([key, label]) => `<button type="button" class="pill" data-action="clear-filter" data-key="${key}">${T.pillLabel(label)}</button>`)
              .join('') + `<button type="button" class="link-btn" data-action="reset-filters">সব মুছুন</button>`
        : '';
    const panelCount = pills.filter(([k]) => ['price', 'brand', 'discount', 'stock'].includes(k)).length;
    setBadge(el.filterCount, panelCount);
}

function renderProducts({ keepVisible = false } = {}) {
    if (!keepVisible) state.visible = CONFIG.PAGE_SIZE;
    const list = getFiltered();
    const shown = list.slice(0, state.visible);

    el.resultCount.textContent = list.length ? `${formatNumber(list.length)}টি পণ্য` : '';
    el.productGrid.setAttribute('aria-busy', 'false');
    el.productGrid.innerHTML = shown.length
        ? shown.map(productCardFor).join('')
        : T.emptyState({
              iconName: 'search',
              title: 'কোনো পণ্য পাওয়া যায়নি',
              text: 'ভিন্ন কিছু খুঁজুন অথবা ফিল্টার পরিবর্তন করুন।',
              actionLabel: activeFilterPills().length ? 'ফিল্টার রিসেট করুন' : '',
              action: 'reset-filters'
          });

    const remaining = list.length - shown.length;
    el.loadMoreWrap.hidden = remaining <= 0;
    el.loadMoreBtn.textContent = `আরও পণ্য দেখুন (${formatNumber(remaining)}টি বাকি)`;
    el.applyFilters.textContent = list.length ? `${formatNumber(list.length)}টি পণ্য দেখুন` : 'ফলাফল দেখুন';

    renderActiveFilters();
}

function showSkeleton() {
    el.productGrid.setAttribute('aria-busy', 'true');
    el.productGrid.innerHTML = Array.from({ length: 8 }, T.skeletonCard).join('');
}

function showLoadError() {
    el.productGrid.setAttribute('aria-busy', 'false');
    el.productGrid.innerHTML = T.emptyState({
        iconName: 'wifi-off',
        title: 'পণ্য লোড করা যায়নি',
        text: 'ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।',
        actionLabel: 'আবার চেষ্টা করুন',
        action: 'retry-load'
    });
}

function applyProducts(list) {
    state.products = list;
    state.byId = new Map(list.map((p) => [p.id, p]));
    Cart.reconcile();
    renderCategories();
    renderFilterPanels();
    renderHero();
    renderProducts({ keepVisible: true });
    Recent.render();
    updateCartUI();
    updateWishlistUI();
    refreshDetailActions();
}

function updateRatings() {
    $$('.product-card[data-product-id]').forEach((card) => {
        const slot = $('[data-slot="rating"]', card);
        if (slot) slot.innerHTML = T.ratingBadge(state.stats.get(card.dataset.productId));
    });
}

async function loadCatalog() {
    showSkeleton();
    try {
        const { products } = await api.loadProducts({ onUpdate: applyProducts });
        applyProducts(products);
    } catch (err) {
        console.error('Product load failed:', err);
        showLoadError();
    }
    api.fetchReviewStats().then((stats) => {
        state.stats = stats;
        updateRatings();
    });
}

// ───────────────────────── UI sync (cart / wishlist) ─────────────────────────

function refreshCardActions() {
    $$('.product-card[data-product-id]').forEach((card) => {
        const p = getProduct(card.dataset.productId);
        const slot = $('[data-slot="cta"]', card);
        if (p && slot) slot.innerHTML = T.cardAction(p, cartQty(p.id));
    });
}

function refreshDetailActions() {
    const box = $('#detailActions');
    if (!box || !state.detailId) return;
    const p = getProduct(state.detailId);
    if (!p) return;
    const v = api.variantOf(p, state.detailVariantId);
    box.innerHTML = T.detailActions(p, v, cartQty(api.lineKey(p.id, v?.id)), isWished(p.id), state.detailQty);
}

function updateCartUI() {
    const focus = captureFocus();
    const count = cartCount();
    setBadge(el.cartCount, count);
    setBadge(el.navCartCount, count);
    el.cartBtn.setAttribute('aria-label', count ? `কার্ট দেখুন, ${formatNumber(count)}টি পণ্য` : 'কার্ট দেখুন');
    refreshCardActions();
    refreshDetailActions();
    if (dlg.cart.open) renderCart();
    restoreFocus(focus);
}

function updateWishlistUI() {
    const count = state.wishlist.filter(getProduct).length || (state.products.length ? 0 : state.wishlist.length);
    setBadge(el.wishlistCount, count);
    setBadge(el.navWishCount, count);
    $$('.wish-btn').forEach((btn) => {
        const active = isWished(btn.dataset.id);
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active);
        btn.setAttribute('aria-label', active ? 'পছন্দ থেকে সরান' : 'পছন্দে যোগ করুন');
        const useEl = btn.querySelector('svg');
        useEl?.classList.toggle('icon-fill', active);
    });
    if (dlg.wishlist.open) renderWishlist();
}

// ───────────────────────── Cart drawer ─────────────────────────

function renderCart() {
    const focus = captureFocus();
    const hasItems = state.cart.length > 0;
    el.cartList.innerHTML = hasItems
        ? `<ul class="cart-items">${state.cart.map((i) => T.cartItem(i, getProduct(i.id))).join('')}</ul>`
        : T.emptyState({
              iconName: 'shopping-bag',
              title: 'আপনার কার্ট খালি',
              text: 'পছন্দের পণ্য যোগ করে কেনাকাটা শুরু করুন।',
              actionLabel: 'কেনাকাটা শুরু করুন',
              action: 'close-cart'
          });
    el.cartFoot.hidden = !hasItems;

    const t = Cart.totals();
    el.cartSavings.hidden = t.savings <= 0;
    el.cartSavings.innerHTML = t.savings > 0 ? `${T.iconHtml('tag')}আপনি ${formatPrice(t.savings)} সাশ্রয় করছেন` : '';

    const c = state.coupon;
    el.couponForm.hidden = !!c;
    el.couponApplied.hidden = !c;
    el.couponApplied.innerHTML = c
        ? `${T.iconHtml('circle-check')}<span><b>${c.code}</b> কুপন প্রয়োগ হয়েছে</span><button type="button" class="link-btn" data-action="remove-coupon">সরান</button>`
        : '';

    el.cartSummary.innerHTML = T.summaryRows({
        subtotal: t.subtotal,
        discount: t.discount,
        couponCode: c?.code,
        delivery: t.delivery,
        deliveryLabel: zone().label,
        total: t.total
    });
    // Checkout footer stays compact (total + button); the full breakdown lives in the scrollable body.
    el.checkoutSummary.innerHTML = T.summaryRows({ subtotal: 0, total: t.total, totalOnly: true });
    el.checkoutReview.innerHTML = T.checkoutReview(
        state.cart,
        T.summaryRows({ subtotal: t.subtotal, discount: t.discount, couponCode: c?.code, delivery: t.delivery })
    );
    el.toCheckout.disabled = !hasItems;
    restoreFocus(focus);
}

function setStep(step) {
    state.step = step;
    el.cartPanel.dataset.step = step;
    $$('[data-pane]', dlg.cart).forEach((pane) => (pane.hidden = pane.dataset.pane !== step));
    $$('[data-step-ind]', dlg.cart).forEach((li) => {
        const active = li.dataset.stepInd === step;
        li.classList.toggle('is-active', active);
        li.classList.toggle('is-done', step === 'checkout' && li.dataset.stepInd === 'cart');
        li.toggleAttribute('aria-current', active);
    });
    showOrderAlert('');
    el.cartBack.hidden = step !== 'checkout';
    el.cartTitle.textContent = step === 'checkout' ? 'অর্ডারের তথ্য' : 'আপনার কার্ট';
    $$('.panel-body', dlg.cart).forEach((b) => (b.scrollTop = 0));
}

/** Persistent, screen-reader-announced error line above the confirm button (toasts vanish; this stays until the next try). */
function showOrderAlert(message) {
    el.orderAlert.textContent = message || '';
    el.orderAlert.hidden = !message;
}

function goToCheckout() {
    if (!state.cart.length) return Toast.error('কার্ট খালি');
    const soldOut = state.cart.filter((i) => {
        const p = getProduct(i.id);
        return p && api.isSoldOut(p, api.variantOf(p, i.variantId));
    });
    if (soldOut.length) return Toast.error(`“${soldOut[0].title}” এখন স্টকে নেই — কার্ট থেকে সরিয়ে নিন`);
    prefillCheckout();
    renderCart();
    setStep('checkout');
    if (!$('#custName').value && matchMedia('(pointer: fine)').matches) $('#custName').focus();
}

function openCart({ step = 'cart' } = {}) {
    renderCart();
    setStep('cart');
    openDialog(dlg.cart);
    if (step === 'checkout') goToCheckout();
}

function applyCoupon(raw) {
    const code = raw.trim().toUpperCase();
    if (!code) return Toast.error('একটি কুপন কোড লিখুন');
    const def = CONFIG.COUPONS[code];
    if (!def) return Toast.error('কুপন কোডটি সঠিক নয়');
    state.coupon = { code, ...def };
    el.couponInput.value = '';
    Toast.success(`“${code}” কুপন প্রয়োগ হয়েছে`);
    renderCart();
}

// ───────────────────────── Checkout ─────────────────────────

function renderDeliveryOptions() {
    el.deliveryOptions.innerHTML = T.deliveryOptions(state.deliveryId);
}

function prefillCheckout() {
    const saved = storage.get(CONFIG.KEYS.SAVED_INFO, null);
    if (!saved) return;
    const fill = (id, value) => {
        if (!$(`#${id}`).value) $(`#${id}`).value = value || '';
    };
    fill('custName', saved.name);
    fill('custPhone', saved.phone);
    fill('custAltPhone', saved.altPhone);
    fill('custDistrict', saved.district);
    fill('custThana', saved.thana);
    fill('custAddress', saved.address);
    $('#rememberInfo').checked = true;
}

function setFieldError(id, message) {
    const input = $(`#${id}`);
    const error = $(`#${id}Error`);
    const field = input.closest('.field');
    field.classList.toggle('has-error', !!message);
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (error) error.textContent = message || '';
}

function validateCheckout() {
    const name = $('#custName').value.trim();
    const phone = normalizePhone($('#custPhone').value);
    const altRaw = $('#custAltPhone').value.trim();
    const altPhone = altRaw ? normalizePhone(altRaw) : '';
    const district = $('#custDistrict').value;
    const thana = $('#custThana').value.trim();
    const address = $('#custAddress').value.trim();
    const errors = [];
    const check = (id, ok, message) => {
        setFieldError(id, ok ? '' : message);
        if (!ok) errors.push(id);
    };
    check('custName', name.length >= 2, 'আপনার নাম লিখুন');
    check('custPhone', isValidPhone(phone), 'সঠিক ১১ ডিজিটের মোবাইল নম্বর দিন (যেমন: 01712345678)');
    check('custAltPhone', !altPhone || isValidPhone(altPhone), 'সঠিক ১১ ডিজিটের নম্বর দিন, অথবা ঘরটি ফাঁকা রাখুন');
    check('custDistrict', !!district, 'আপনার জেলা বেছে নিন');
    check('custThana', thana.length >= 2, 'থানা বা উপজেলার নাম লিখুন');
    check('custAddress', address.length >= 5, 'বাসা/রোড/গ্রামসহ ঠিকানা লিখুন');
    if (errors.length) $(`#${errors[0]}`).focus();
    return errors.length
        ? null
        : { name, phone, altPhone, district, thana, address, note: $('#custNote').value.trim(), remember: $('#rememberInfo').checked };
}

function newOrderId() {
    const d = new Date();
    const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const rand = crypto.getRandomValues(new Uint32Array(1))[0] % 90000;
    return `SB-${stamp}-${String(10000 + rand)}`;
}

/** Re-checks price & stock against the live catalog right before ordering. */
async function verifyCart() {
    let fresh;
    try {
        fresh = await api.fetchProductsByIds([...new Set(state.cart.map((i) => i.id))]);
    } catch {
        return { ok: true }; // can't verify offline — the insert below will surface real network errors
    }
    const liveById = new Map(fresh.map((p) => [p.id, p]));
    fresh.forEach((p) => state.byId.set(p.id, p));
    const blocking = [];
    const repriced = [];

    state.cart = state.cart.flatMap((item) => {
        const p = liveById.get(item.id);
        const next = Cart.refreshLine(item, p);
        const label = item.variant ? `${item.title} (${item.variant})` : item.title;
        if (!next) {
            blocking.push(`“${label}” আর পাওয়া যাচ্ছে না`);
            return [];
        }
        const v = api.variantOf(p, next.variantId);
        if (api.isSoldOut(p, v)) {
            blocking.push(`“${label}” এখন স্টকে নেই`);
            return [];
        }
        if (next.quantity < item.quantity) blocking.push(`“${label}” মাত্র ${formatNumber(next.quantity)}টি আছে`);
        if (next.price !== item.price) repriced.push(label);
        return [next];
    });

    if (blocking.length || repriced.length) {
        Cart.save();
        return { ok: false, blocking, repriced };
    }
    return { ok: true };
}

async function placeOrder(event) {
    event.preventDefault();
    if (state.placing) return;
    if (!state.cart.length) return Toast.error('কার্ট খালি');
    const data = validateCheckout();
    if (!data) return;

    showOrderAlert('');
    state.placing = true;
    el.placeOrderBtn.classList.add('is-loading');
    el.placeOrderBtn.disabled = true;

    try {
        const verdict = await verifyCart();
        if (!verdict.ok) {
            if (verdict.blocking.length) {
                Toast.error(verdict.blocking[0]);
                showOrderAlert(`${verdict.blocking[0]} — কার্ট আপডেট করা হয়েছে, আবার দেখে নিশ্চিত করুন।`);
                if (!state.cart.length) setStep('cart');
            } else {
                Toast.info('কিছু পণ্যের দাম বদলেছে — নতুন মোট মূল্য দেখে আবার নিশ্চিত করুন');
                showOrderAlert('কিছু পণ্যের দাম বদলেছে। নতুন মোট মূল্য দেখে আবার নিশ্চিত করুন।');
            }
            return;
        }

        const t = Cart.totals();
        const lines = [data.address, `থানা/উপজেলা: ${data.thana}, জেলা: ${data.district}`];
        if (data.altPhone) lines.push(`বিকল্প মোবাইল: ${data.altPhone}`);
        lines.push(`ডেলিভারি: ${zone().label}`);
        if (state.coupon) lines.push(`কুপন: ${state.coupon.code}`);
        if (data.note) lines.push(`নোট: ${data.note}`);

        const order = {
            order_id: '',
            customer_name: data.name,
            phone: data.phone,
            address: lines.join('\n'),
            // The option label is part of `title` so every screen (and any older admin view) shows it.
            items: state.cart.map((i) => ({
                id: i.id,
                ...(i.variantId ? { variantId: i.variantId, variant: i.variant } : {}),
                title: i.variant ? `${i.title} (${i.variant})` : i.title,
                quantity: i.quantity,
                price: i.price
            })),
            total_price: t.total,
            status: 'Pending'
        };
        for (let attempt = 0; ; attempt++) {
            order.order_id = newOrderId();
            try {
                await api.insertOrder(order);
                break;
            } catch (err) {
                // 23505 = unique_violation (order id collision) → retry with a fresh id
                if (err?.code === '23505' && attempt < 2) continue;
                throw err;
            }
        }
        const orderId = order.order_id;
        MyOrders.add({ ...order, created_at: new Date().toISOString() });

        if (data.remember)
            storage.set(CONFIG.KEYS.SAVED_INFO, {
                name: data.name, phone: data.phone, altPhone: data.altPhone,
                district: data.district, thana: data.thana, address: data.address
            });
        else storage.remove(CONFIG.KEYS.SAVED_INFO);
        storage.set(CONFIG.KEYS.DELIVERY, state.deliveryId);

        Cart.clear();
        $('#checkoutForm').reset();
        $$('.field.has-error').forEach((f) => f.classList.remove('has-error'));
        renderDeliveryOptions();

        $('#successOrderId').textContent = orderId;
        el.successWhatsapp.href = whatsappLink(`আসসালামু আলাইকুম, আমি অর্ডার করেছি। অর্ডার নম্বর: ${orderId}`);
        await closeDialog(dlg.cart);
        openDialog(dlg.success);
    } catch (err) {
        console.error('Order failed:', err);
        Toast.error('অর্ডার সম্পন্ন করা যায়নি। ইন্টারনেট পরীক্ষা করে আবার চেষ্টা করুন।');
        showOrderAlert('অর্ডারটি জমা হয়নি — কোনো অর্ডার তৈরি হয়নি। ইন্টারনেট পরীক্ষা করে আবার চেষ্টা করুন, অথবা হোয়াটসঅ্যাপে জানান।');
    } finally {
        state.placing = false;
        el.placeOrderBtn.classList.remove('is-loading');
        el.placeOrderBtn.disabled = false;
    }
}

// ───────────────────────── Product detail & reviews ─────────────────────────

const detailContext = (p) => {
    const v = api.variantOf(p, state.detailVariantId);
    return {
        variantId: v?.id || null,
        qty: cartQty(api.lineKey(p.id, v?.id)),
        wished: isWished(p.id),
        stat: state.stats.get(p.id),
        deliveryNote: `ডেলিভারি চার্জ: ${deliverySentence()}`,
        pending: state.detailQty,
        imageIndex: state.detailImage
    };
};

function openDetail(id, variantId = null) {
    const p = getProduct(id);
    if (!p) return Toast.error('পণ্যটি পাওয়া যায়নি');
    state.detailId = p.id;
    // One option → preselect it; several → the customer must choose.
    state.detailVariantId = variantId || (p.variants.length === 1 ? p.variants[0].id : null);
    state.detailQty = 1;
    state.detailImage = 0;
    el.detailContent.innerHTML = T.productDetail(p, detailContext(p));
    dlg.detail.setAttribute('aria-label', p.title);
    document.title = `${p.title} — SHAGORBENZ`; // the open product is named in the tab / history entry
    openDialog(dlg.detail, {
        onClose: () => {
            state.detailId = null;
            state.detailVariantId = null;
            document.title = baseTitle;
        }
    });
    el.detailContent.scrollTop = 0;
    Recent.add(p.id);
    Recent.render();
    loadReviews(p.id);
}

function selectVariant(variantId) {
    const p = getProduct(state.detailId);
    if (!p || !api.variantOf(p, variantId)) return;
    state.detailVariantId = variantId;
    state.detailQty = 1;
    $('#detailMain').innerHTML = T.detailMain(p, detailContext(p));
    $(`#optionPicker [data-variant="${CSS.escape(variantId)}"]`)?.focus({ preventScroll: true });
}

function setDetailQty(next) {
    const p = getProduct(state.detailId);
    if (!p) return;
    const max = Math.max(1, Math.min(api.stockOf(p, api.variantOf(p, state.detailVariantId)), 99));
    state.detailQty = Math.min(Math.max(1, next), max);
    const focus = captureFocus();
    refreshDetailActions();
    restoreFocus(focus);
}

function selectImage(index) {
    const p = getProduct(state.detailId);
    const src = p?.gallery[index];
    if (!src) return;
    state.detailImage = index;
    const main = $('#detailImg');
    if (main) main.src = src;
    $$('#detailMain .thumb').forEach((thumb, i) => {
        thumb.classList.toggle('is-active', i === index);
        thumb.setAttribute('aria-pressed', i === index);
    });
}

async function loadReviews(id) {
    const list = $('#reviewList');
    try {
        const reviews = await api.fetchReviews(id);
        if (state.detailId !== id) return;
        const count = reviews.length;
        const avg = count ? reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / count : 0;
        if (count) state.stats.set(id, { avg, count });
        else state.stats.delete(id);
        updateRatings();

        $('#reviewSummary').textContent = count ? `${avg.toFixed(1)} গড় · ${formatNumber(count)}টি রিভিউ` : '';
        $('#detailRating').innerHTML = count
            ? `${T.starRow(avg)}<span>${avg.toFixed(1)} · ${formatNumber(count)}টি রিভিউ</span>`
            : '<span class="muted">এখনো কোনো রিভিউ নেই</span>';
        list.innerHTML = count
            ? reviews.map(T.reviewCard).join('')
            : '<p class="muted center">প্রথম রিভিউটি আপনিই লিখুন।</p>';
    } catch (err) {
        console.error(err);
        if (state.detailId === id) list.innerHTML = '<p class="muted center">রিভিউ লোড করা যায়নি।</p>';
    }
}

async function submitReview(event) {
    event.preventDefault();
    const form = event.target;
    const id = state.detailId;
    if (!id) return;
    const rating = form.querySelector('input[name="rating"]:checked')?.value;
    const comment = form.comment.value.trim();
    if (!rating) return Toast.error('একটি রেটিং বেছে নিন');
    if (!comment) {
        Toast.error('আপনার মন্তব্য লিখুন');
        form.comment.focus();
        return;
    }
    const btn = $('#submitReview');
    btn.disabled = true;
    try {
        await api.insertReview(id, { name: form.name.value, rating, comment });
        form.reset();
        Toast.success('রিভিউর জন্য ধন্যবাদ!');
        await loadReviews(id);
    } catch (err) {
        console.error(err);
        Toast.error('রিভিউ জমা দেওয়া যায়নি, আবার চেষ্টা করুন');
    } finally {
        btn.disabled = false;
    }
}

// ───────────────────────── Wishlist dialog ─────────────────────────

function renderWishlist() {
    const items = state.wishlist.map(getProduct).filter(Boolean);
    el.wishlistList.innerHTML = items.length
        ? `<ul class="wish-list">${items.map(T.wishlistItem).join('')}</ul>`
        : T.emptyState({
              iconName: 'heart',
              title: 'পছন্দের তালিকা খালি',
              text: 'পণ্যের কার্ডে ♡ চেপে পছন্দের পণ্য সংরক্ষণ করুন।',
              actionLabel: 'পণ্য দেখুন',
              action: 'close-wishlist'
          });
}

// ───────────────────────── Order tracking ─────────────────────────

function renderHistory() {
    el.historyResults.innerHTML = state.orders.length
        ? `<div class="order-list">${state.orders.map(T.orderCard).join('')}</div>
           <p class="history-note">আপনার অর্ডারগুলো এই ব্রাউজারে সংরক্ষিত আছে। ব্রাউজারের ডেটা মুছে ফেললে এই তালিকাও মুছে যাবে।</p>`
        : T.emptyState({
              iconName: 'package',
              title: 'এখনো কোনো অর্ডার নেই',
              text: 'অর্ডার করলে সেটি এই ব্রাউজারে সংরক্ষিত থাকবে এবং এখানে অবস্থা দেখতে পারবেন।',
              actionLabel: 'কেনাকাটা শুরু করুন',
              action: 'close-history'
          });
}

/** Pulls the latest status for the saved orders, then keeps listening for admin updates. */
async function refreshHistory() {
    const ids = state.orders.map((o) => o.order_id);
    if (!ids.length) return;
    try {
        if (MyOrders.merge(await api.fetchOrdersByIds(ids))) renderHistory();
    } catch (err) {
        console.warn('Could not refresh order status:', err); // the saved copies stay visible
    }
    if (!dlg.history.open) return;
    api.subscribeOrders(ids, (row) => {
        if (!MyOrders.merge([row])) return;
        const saved = state.orders.find((o) => o.order_id === row.order_id);
        const card = $(`.order-card[data-order-id="${CSS.escape(row.order_id)}"]`, el.historyResults);
        if (card && saved) card.outerHTML = T.orderCard(saved);
        else renderHistory();
    });
}

function openHistory() {
    renderHistory();
    openDialog(dlg.history, { onClose: api.unsubscribeOrders });
    refreshHistory();
}

// ───────────────────────── Search ─────────────────────────

const Search = {
    results: [],
    active: -1,
    run(value) {
        const q = value.trim();
        el.searchClear.hidden = !value;
        if (!q) return this.close();
        this.results = searchProducts(q).slice(0, 7);
        this.active = -1;
        this.render(q);
    },
    render(q) {
        el.searchResults.hidden = false;
        el.searchInput.setAttribute('aria-expanded', 'true');
        el.searchResults.innerHTML = this.results.length
            ? this.results.map((p, i) => T.searchResultItem(p, i === this.active)).join('') +
              `<button type="button" class="search-all" data-action="search-all">“${T.esc(q)}” এর সব ফলাফল দেখুন</button>`
            : `<p class="search-empty">“${T.esc(q)}” এর জন্য কোনো ফলাফল নেই</p>`;
    },
    close() {
        el.searchResults.hidden = true;
        el.searchInput.setAttribute('aria-expanded', 'false');
        el.searchInput.removeAttribute('aria-activedescendant');
        this.active = -1;
    },
    move(delta) {
        if (!this.results.length) return;
        this.active = (this.active + delta + this.results.length) % this.results.length;
        $$('.search-item', el.searchResults).forEach((node, i) => {
            node.classList.toggle('is-active', i === this.active);
            node.setAttribute('aria-selected', i === this.active);
            if (i === this.active) {
                node.scrollIntoView({ block: 'nearest' });
                el.searchInput.setAttribute('aria-activedescendant', node.id);
            }
        });
    },
    submit() {
        const picked = this.results[this.active];
        if (picked) {
            this.close();
            return openDetail(picked.id);
        }
        this.applyAsFilter();
    },
    applyAsFilter() {
        state.filters.query = el.searchInput.value.trim();
        this.close();
        renderProducts();
        scrollToCatalog();
    },
    reset() {
        el.searchInput.value = '';
        el.searchClear.hidden = true;
        this.close();
    }
};

// ───────────────────────── Filters ─────────────────────────

function resetFilters() {
    Object.assign(state.filters, { category: 'all', brand: 'all', min: '', max: '', discount: false, stock: false, query: '' });
    Search.reset();
    renderCategories();
    syncFilterInputs();
    renderProducts();
}

function clearFilter(key) {
    const f = state.filters;
    if (key === 'query') {
        f.query = '';
        Search.reset();
    }
    if (key === 'category') f.category = 'all';
    if (key === 'brand') f.brand = 'all';
    if (key === 'price') Object.assign(f, { min: '', max: '' });
    if (key === 'discount') f.discount = false;
    if (key === 'stock') f.stock = false;
    renderCategories();
    syncFilterInputs();
    renderProducts();
}

const scrollToCatalog = () => $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });

// ───────────────────────── Events ─────────────────────────

const ACTIONS = {
    'open-product': (id) => openDetail(id),
    'add-to-cart': (id, target) => {
        const fromDetail = !!target.closest('#detailActions');
        const added = Cart.add(id, { variantId: target.dataset.variant || null, qty: fromDetail ? state.detailQty : 1 });
        if (added && fromDetail) state.detailQty = 1;
    },
    'detail-qty-inc': () => setDetailQty(state.detailQty + 1),
    'detail-qty-dec': () => setDetailQty(state.detailQty - 1),
    'select-image': (_id, target) => selectImage(Number(target.dataset.index)),
    'filter-category': (key, target) => {
        const same = target.classList.contains('cat-card') && state.filters.category === key;
        state.filters.category = same ? 'all' : key;
        renderCategories();
        renderProducts();
        scrollToCatalog();
    },
    'increase-qty': (_id, target) => Cart.changeQty(target.dataset.key, 1),
    'decrease-qty': (_id, target) => Cart.changeQty(target.dataset.key, -1),
    'cart-remove': (_id, target) => Cart.remove(target.dataset.key),
    'toggle-wishlist': (id) => Wishlist.toggle(id),
    'wishlist-to-cart': async (id) => {
        const p = getProduct(id);
        if (!p) return;
        if (api.hasVariants(p)) {
            // Needs an option choice → show the product instead of guessing.
            if (dlg.wishlist.open) await closeDialog(dlg.wishlist);
            return openDetail(id);
        }
        if (Cart.add(id)) Wishlist.toggle(id);
    },
    'select-variant': (_id, target) => selectVariant(target.dataset.variant),
    'need-option': () => {
        Toast.error('আগে একটি অপশন বেছে নিন');
        const picker = $('#optionPicker');
        picker?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        picker?.classList.remove('nudge');
        void picker?.offsetWidth; // restart the animation
        picker?.classList.add('nudge');
    },
    'buy-now': async (id, target) => {
        const variantId = target.dataset.variant || null;
        if (!cartQty(api.lineKey(id, variantId)) && !Cart.add(id, { variantId, qty: state.detailQty })) return;
        state.detailQty = 1;
        await closeDialog(dlg.detail);
        openCart({ step: 'checkout' });
    },
    'open-cart': async () => {
        if (dlg.detail.open) await closeDialog(dlg.detail);
        openCart();
    },
    'close-cart': () => closeDialog(dlg.cart),
    'cart-back': () => setStep('cart'),
    'remove-coupon': () => {
        state.coupon = null;
        renderCart();
    },
    'open-history': async () => {
        if (dlg.success.open) await closeDialog(dlg.success);
        openHistory();
    },
    'close-history': () => closeDialog(dlg.history),
    'open-wishlist': () => {
        renderWishlist();
        openDialog(dlg.wishlist);
    },
    'close-wishlist': () => closeDialog(dlg.wishlist),
    'reset-filters': () => resetFilters(),
    'clear-filter': (_id, target) => clearFilter(target.dataset.key),
    'search-all': () => Search.applyAsFilter(),
    'retry-load': () => loadCatalog(),
    'nav-home': () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    'nav-categories': () => (el.categorySection.hidden ? $('#catalog') : el.categorySection).scrollIntoView({ behavior: 'smooth', block: 'start' })
};

function bindEvents() {
    // One delegated click handler for every data-action in the document (incl. dialogs).
    document.addEventListener('click', (event) => {
        const target = event.target.closest('[data-action]');
        if (target) {
            const handler = ACTIONS[target.dataset.action];
            if (handler) {
                event.preventDefault();
                handler(target.dataset.id, target);
            }
            return;
        }
        // Tapping empty areas of a product card opens it too.
        const card = event.target.closest('.product-card[data-product-id]');
        if (card && !event.target.closest('button, a, input, select, textarea, label, [data-slot="cta"]')) {
            openDetail(card.dataset.productId);
        }
    });

    // Category chips
    el.categoryChips.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-category]');
        if (!chip) return;
        state.filters.category = chip.dataset.category;
        renderCategories();
        renderProducts();
    });

    // Filters (inputs exist in both the sidebar and the mobile sheet)
    const applyFiltersSoon = debounce(() => renderProducts(), 250);
    document.addEventListener('input', (event) => {
        const input = event.target.closest('[data-filter]');
        if (!input || input.type === 'checkbox' || input.tagName === 'SELECT') return;
        const cleaned = toEnglishDigits(input.value).replace(/\D/g, '');
        if (cleaned !== input.value) input.value = cleaned;
        state.filters[input.dataset.filter] = cleaned;
        syncFilterInputs();
        applyFiltersSoon();
    });
    document.addEventListener('change', (event) => {
        const input = event.target.closest('[data-filter]');
        if (!input || (input.type !== 'checkbox' && input.tagName !== 'SELECT')) return;
        state.filters[input.dataset.filter] = input.type === 'checkbox' ? input.checked : input.value;
        syncFilterInputs();
        renderProducts();
    });
    el.sortSelect.addEventListener('change', () => {
        state.filters.sort = el.sortSelect.value;
        renderProducts();
    });
    el.openFilters.addEventListener('click', () => openDialog(dlg.filter));
    el.loadMoreBtn.addEventListener('click', () => {
        const before = state.visible;
        state.visible += CONFIG.PAGE_SIZE;
        const list = getFiltered();
        el.productGrid.insertAdjacentHTML('beforeend', list.slice(before, state.visible).map(productCardFor).join(''));
        const remaining = list.length - Math.min(state.visible, list.length);
        el.loadMoreWrap.hidden = remaining <= 0;
        el.loadMoreBtn.textContent = `আরও পণ্য দেখুন (${formatNumber(remaining)}টি বাকি)`;
    });

    el.categoryToggle.addEventListener('click', () => {
        state.categoriesExpanded = !state.categoriesExpanded;
        renderCategories();
    });

    // Compact header: the search field slides open from the magnifier button
    el.searchToggle.addEventListener('click', () => {
        const open = el.siteHeader.classList.toggle('is-searching');
        el.searchToggle.setAttribute('aria-expanded', open);
        if (open) el.searchInput.focus();
        else Search.close();
    });

    // Search
    el.searchInput.addEventListener('input', (e) => Search.run(e.target.value));
    el.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') (e.preventDefault(), Search.move(1));
        else if (e.key === 'ArrowUp') (e.preventDefault(), Search.move(-1));
        else if (e.key === 'Escape') Search.close();
    });
    el.searchInput.addEventListener('focus', () => el.searchInput.value.trim() && Search.run(el.searchInput.value));
    $('#searchForm').addEventListener('submit', (e) => {
        e.preventDefault();
        Search.submit();
    });
    el.searchClear.addEventListener('click', () => {
        const hadQuery = !!state.filters.query;
        Search.reset();
        el.searchInput.focus();
        if (hadQuery) {
            state.filters.query = '';
            renderProducts();
        }
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#searchForm')) Search.close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === '/' && !e.target.closest('input, textarea, select') && !document.querySelector('dialog[open]')) {
            e.preventDefault();
            el.searchInput.focus();
        }
    });

    // Cart & checkout
    el.cartBtn.addEventListener('click', () => openCart());
    el.wishlistBtn.addEventListener('click', ACTIONS['open-wishlist']);
    el.historyBtn.addEventListener('click', openHistory);
    el.toCheckout.addEventListener('click', goToCheckout);
    el.couponForm.addEventListener('submit', (e) => {
        e.preventDefault();
        applyCoupon(el.couponInput.value);
    });
    $('#checkoutForm').addEventListener('submit', placeOrder);
    el.deliveryOptions.addEventListener('change', (e) => {
        if (e.target.name !== 'delivery') return;
        state.deliveryId = e.target.value;
        storage.set(CONFIG.KEYS.DELIVERY, state.deliveryId);
        renderCart();
    });
    ['custName', 'custPhone', 'custAltPhone', 'custDistrict', 'custThana', 'custAddress'].forEach((id) => {
        $(`#${id}`).addEventListener('input', () => setFieldError(id, ''));
        $(`#${id}`).addEventListener('change', () => setFieldError(id, ''));
    });
    ['custPhone', 'custAltPhone'].forEach((id) =>
        $(`#${id}`).addEventListener('blur', (e) => {
            const normalized = normalizePhone(e.target.value);
            if (normalized) e.target.value = normalized;
        })
    );
    // Any district other than Dhaka is outside Dhaka — switch the delivery charge so it can't be picked wrongly.
    $('#custDistrict').addEventListener('change', (e) => {
        const outside = CONFIG.DELIVERY.find((z) => z.id === 'outside');
        if (e.target.value && e.target.value !== 'ঢাকা' && outside && state.deliveryId !== outside.id) {
            state.deliveryId = outside.id;
            storage.set(CONFIG.KEYS.DELIVERY, state.deliveryId);
            renderDeliveryOptions();
            renderCart();
            Toast.info(`ডেলিভারি এলাকা “${outside.label}” করা হয়েছে`);
        }
    });

    // Reviews
    document.addEventListener('submit', (e) => {
        if (e.target.id === 'reviewForm') submitReview(e);
    });

    // Success dialog
    el.copyOrderId.addEventListener('click', async () => {
        const ok = await copyText($('#successOrderId').textContent);
        ok ? Toast.success('অর্ডার নম্বর কপি হয়েছে') : Toast.error('কপি করা যায়নি');
    });

    // Page chrome
    let scrollFrame = 0;
    const onScroll = () => {
        if (scrollFrame) return;
        scrollFrame = requestAnimationFrame(() => {
            scrollFrame = 0;
            el.backToTop.classList.toggle('is-visible', window.scrollY > CONFIG.SCROLL_TOP_THRESHOLD);
            el.siteHeader.classList.toggle('is-scrolled', window.scrollY > 4);
            updateActiveNav();
        });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    el.backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    // The header floats 10px below the top edge, so sticky elements below it must clear height + 10px.
    new ResizeObserver(() =>
        document.documentElement.style.setProperty('--header-h', `${el.siteHeader.offsetHeight + 10}px`)
    ).observe(el.siteHeader);

    // Keep tabs in sync
    window.addEventListener('storage', (e) => {
        if (e.key === CONFIG.KEYS.CART) (Cart.load(), updateCartUI());
        if (e.key === CONFIG.KEYS.WISHLIST) (Wishlist.load(), updateWishlistUI());
    });
    window.addEventListener('offline', () => Toast.info('ইন্টারনেট সংযোগ নেই'));
    window.addEventListener('online', () => Toast.success('ইন্টারনেট সংযোগ ফিরে এসেছে'));
}

// ───────────────────────── Page polish (nav highlight, reveal, light, image fallback) ─────────────────────────

const NAV_SECTIONS = ['home', 'categories', 'catalog', 'contact'];

/** Highlights the header link of the section currently under the header. */
function updateActiveNav() {
    const probe = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) + 80 || 160;
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    let current = 'home';
    for (const id of NAV_SECTIONS) {
        const section = document.getElementById(id);
        if (section && !section.hidden && section.getBoundingClientRect().top <= probe) current = id;
    }
    if (atBottom) current = 'contact';
    $$('.nav-link').forEach((link) => {
        const active = link.dataset.section === current;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
    });
}

/** Fade/slide sections in as they scroll into view. Content stays visible if JS or IntersectionObserver is missing. */
function bindReveal() {
    const items = $$('.reveal');
    if (!('IntersectionObserver' in window)) return;
    document.documentElement.classList.add('js-reveal');
    const io = new IntersectionObserver(
        (entries) =>
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-in');
                io.unobserve(entry.target);
            }),
        { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    items.forEach((item) => io.observe(item));
}

/** A soft cyan light follows the pointer over cards (mouse devices only, one rAF per frame). */
function bindSpotlight() {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let frame = 0;
    document.addEventListener(
        'pointermove',
        (event) => {
            const card = event.target.closest?.('.product-card, .cat-card, .trust-item');
            if (!card || frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                const box = card.getBoundingClientRect();
                card.style.setProperty('--mx', `${event.clientX - box.left}px`);
                card.style.setProperty('--my', `${event.clientY - box.top}px`);
            });
        },
        { passive: true }
    );
}

/** `error` doesn't bubble, so listen in the capture phase: any broken product photo swaps to the dark placeholder once. */
function bindImageFallback() {
    document.addEventListener(
        'error',
        (event) => {
            const node = event.target;
            if (!(node instanceof HTMLImageElement) || node.dataset.fallback) return;
            node.dataset.fallback = '1';
            node.src = CONFIG.FALLBACK_IMAGE;
        },
        true
    );
}

// ───────────────────────── Init ─────────────────────────

function init() {
    [
        'siteHeader', 'announceText', 'searchInput', 'searchClear', 'searchResults', 'wishlistBtn', 'historyBtn',
        'wishlistCount', 'cartBtn', 'cartCount', 'navCartCount', 'navWishCount', 'categoryChips', 'filterSidebar',
        'filterSheetBody', 'resultCount', 'openFilters', 'filterCount', 'sortSelect', 'activeFilters', 'productGrid',
        'loadMoreWrap', 'loadMoreBtn', 'recentSection', 'recentGrid', 'backToTop', 'cartPanel', 'cartBack',
        'cartTitle', 'cartList', 'cartFoot', 'cartSavings', 'couponForm', 'couponInput', 'couponApplied',
        'cartSummary', 'toCheckout', 'deliveryOptions', 'checkoutReview', 'checkoutSummary', 'placeOrderBtn',
        'applyFilters', 'wishlistList', 'historyResults', 'successWhatsapp', 'copyOrderId', 'footerDelivery', 'year',
        'categoryGrid', 'categoryToggle', 'footerCategoriesWrap', 'footerCategories', 'heroStats',
        'statProducts', 'statCategories', 'heroFloat', 'orderAlert', 'searchToggle'
    ].forEach((id) => (el[id] = document.getElementById(id)));

    Object.assign(dlg, {
        detail: $('#detailDialog'),
        cart: $('#cartDialog'),
        filter: $('#filterDialog'),
        wishlist: $('#wishlistDialog'),
        history: $('#historyDialog'),
        success: $('#successDialog')
    });
    el.detailContent = $('#detailContent');
    el.categorySection = $('#categories');
    Object.values(dlg).forEach(bindDialog);

    // Static copy driven by config
    const sentence = deliverySentence();
    el.announceText.innerHTML = `${T.iconHtml('truck')}<span>ডেলিভারি চার্জ: ${sentence}</span>`;
    el.footerDelivery.textContent = `ডেলিভারি: ${sentence}`;
    el.year.textContent = new Date().getFullYear();
    $('#announceWhatsapp').href = whatsappLink();
    $('#whatsappFloat').href = whatsappLink();

    // Restore persisted state
    Cart.load();
    Wishlist.load();
    Recent.load();
    MyOrders.load();
    const savedZone = storage.get(CONFIG.KEYS.DELIVERY, null);
    if (CONFIG.DELIVERY.some((z) => z.id === savedZone)) state.deliveryId = savedZone;
    renderDeliveryOptions();
    $('#custDistrict').innerHTML = T.districtOptions();
    renderFilterPanels();
    setStep('cart');
    updateCartUI();
    updateWishlistUI();

    bindEvents();
    bindImageFallback();
    bindSpotlight();
    bindReveal();
    loadCatalog();
}

init();
