// ============================================================
// main.js — SHAGORBENZ Premium E-Commerce
// ============================================================
import { fetchProducts } from './products.js';

const CONFIG = {
    COUPONS: {
        SB10: { type: 'percent', value: 10 },
        SB50: { type: 'flat', value: 50 },
        WELCOME: { type: 'percent', value: 15 }
    },
    STORAGE_KEYS: {
        CART: 'shagorbenzCart',
        WISHLIST: 'shagorbenzWishlist',
        ORDERS: 'userOrderHistory',
        PLAYER_ID: 'oneSignalPlayerId',
        RECENT: 'shagorbenzRecentlyViewed',
        SAVED_INFO: 'shagorbenzSavedCheckoutInfo'
    },
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyfDr73L6SJa1bDoV3BCYbZ1H2Fe5WilhowDxrjqXBACY-mhSdf4E0IX9CCAKsfDCK_/exec',
    SLIDER_INTERVAL: 3500,
    SCROLL_THRESHOLD: 300,
    DEFAULT_DELIVERY_CHARGE: 60,
    LOW_STOCK_THRESHOLD: 5,
    RECENT_LIMIT: 8,
    PHONE_REGEX: /^01[3-9]\d{8}$/,
    FALLBACK_IMAGE: 'https://via.placeholder.com/250',
    FALLBACK_LOGO: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2242%22 height=%2242%22 viewBox=%220 0 42 42%22%3E%3Crect width=%2242%22 height=%2242%22 fill=%22%23000%22 rx=%228%22/%3E%3Ctext x=%2250%25%22 y=%2255%25%22 font-size=%2220%22 font-weight=%22900%22 text-anchor=%22middle%22 fill=%22%23fff%22 font-family=%22sans-serif%22%3ESB%3C/text%3E%3C/svg%3E'
};

const state = {
    cart: [],
    wishlist: [],
    products: [],
    recentlyViewed: [],
    activeCategory: 'all',
    activeSort: 'default',
    currentSlide: 0,
    slideInterval: null,
    appliedCoupon: null,
    editingOrderId: null,
    isProcessing: false,
    lastFocusedEl: null
};

// ===== UTILITIES =====
const Utils = {
    load(key, fallback = []) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return fallback;
            const parsed = JSON.parse(raw);
            return parsed === null || parsed === undefined ? fallback : parsed;
        } catch { return fallback; }
    },
    save(key, data) {
        try { localStorage.setItem(key, JSON.stringify(data)); return true; }
        catch (e) { console.error(e); return false; }
    },
    isValidPhone(phone) {
        return CONFIG.PHONE_REGEX.test(phone.trim());
    },
    generateOrderId() {
        const d = new Date().toISOString().slice(2, 10).replace(/-/g, '');
        const random = Math.floor(1000 + Math.random() * 9000);
        return `SB-${d}-${random}`;
    },
    formatPrice(price) {
        return `${Number(price).toLocaleString('bn-BD')} ৳`;
    },
    calculateDiscount(subtotal, coupon) {
        if (!coupon) return 0;
        const disc = coupon.type === 'percent'
            ? Math.round(subtotal * coupon.value / 100)
            : coupon.value;
        return Math.min(disc, subtotal);
    },
    getDeliveryCharge() {
        const sel = document.getElementById('deliveryArea');
        return sel?.selectedOptions[0]?.dataset?.charge
            ? parseInt(sel.selectedOptions[0].dataset.charge)
            : CONFIG.DEFAULT_DELIVERY_CHARGE;
    },
    escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },
    escapeAttr(str) { return Utils.escapeHtml(str); },
    prefersReducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    },
    resetCartSlider() {
        const w = document.getElementById('cartSliderWrapper');
        if (w) w.style.transform = 'translateX(0)';
    },
    closeCart() {
        document.getElementById('cartSidebar')?.classList.remove('open');
        document.getElementById('cartOverlay')?.classList.remove('open');
        Utils.resetCartSlider();
    },
    openCart() {
        document.getElementById('cartSidebar')?.classList.add('open');
        document.getElementById('cartOverlay')?.classList.add('open');
        CartManager.renderSidebar();
        Utils.resetCartSlider();
    },
    setBadge(el, count) {
        if (!el) return;
        el.textContent = count;
        el.style.display = count > 0 ? 'flex' : 'none';
    },
    debounce(fn, wait) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
    }
};

const Toast = {
    show(msg, icon = 'check_circle', dur = 2200) {
        const cont = document.getElementById('toastContainer');
        if (!cont) return;
        const t = document.createElement('div');
        t.className = 'toast';
        t.innerHTML = `<span class="material-symbols-outlined">${Utils.escapeHtml(icon)}</span><span>${Utils.escapeHtml(msg)}</span>`;
        cont.appendChild(t);
        setTimeout(() => {
            t.style.opacity = '0';
            t.style.transform = 'translateY(8px)';
            setTimeout(() => t.remove(), 300);
        }, dur);
    },
    success(msg) { this.show(msg, 'check_circle'); },
    error(msg) { this.show(msg, 'error'); },
    info(msg) { this.show(msg, 'info'); }
};

const Modal = {
    show(id) {
        const el = document.getElementById(id);
        if (!el) return;
        state.lastFocusedEl = document.activeElement;
        el.classList.add('active');
        el.setAttribute('aria-hidden', 'false');
        const focusable = el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        focusable?.focus();
    },
    hide(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('active');
        el.setAttribute('aria-hidden', 'true');
        if (state.lastFocusedEl instanceof HTMLElement) state.lastFocusedEl.focus();
    },
    hideAll() {
        document.querySelectorAll('.modal.active').forEach(m => { m.classList.remove('active'); m.setAttribute('aria-hidden', 'true'); });
    }
};

// ===== CART MANAGER =====
const CartManager = {
    load() { state.cart = Utils.load(CONFIG.STORAGE_KEYS.CART); },
    save() { Utils.save(CONFIG.STORAGE_KEYS.CART, state.cart); this.updateUI(); },
    getItem(id) { return state.cart.find(i => i.id === id); },
    getTotalItems() { return state.cart.reduce((s, i) => s + (i.quantity || 1), 0); },
    getSubtotal() { return state.cart.reduce((s, i) => s + Number(i.price) * (i.quantity || 1), 0); },
    getStock(id) {
        const p = state.products.find(p => p.id === id);
        return p?.stock !== undefined ? Number(p.stock) : 9999;
    },
    add(id) {
        const p = state.products.find(p => p.id === id);
        if (!p) { Toast.error('প্রোডাক্ট পাওয়া যায়নি'); return false; }
        if (this.getStock(id) <= 0) { Toast.error('স্টক নেই'); return false; }
        const exist = this.getItem(id);
        if (exist) {
            if (exist.quantity >= this.getStock(id)) { Toast.error('সর্বোচ্চ স্টক সীমা পার'); return false; }
            exist.quantity++;
        } else {
            state.cart.push({ id: p.id, title: p.title, price: p.price, image: p.image, quantity: 1 });
            Toast.success('কার্টে যোগ হয়েছে');
        }
        this.save(); return true;
    },
    remove(id) { state.cart = state.cart.filter(i => i.id !== id); this.save(); },
    changeQuantity(id, delta) {
        const exist = this.getItem(id);
        if (!exist) { if (delta > 0) this.add(id); return; }
        const newQty = exist.quantity + delta;
        if (newQty <= 0) { this.remove(id); return; }
        if (delta > 0 && newQty > this.getStock(id)) { Toast.error('সর্বোচ্চ স্টক সীমা পার'); return; }
        exist.quantity = newQty; this.save();
    },
    clear() { state.cart = []; state.appliedCoupon = null; this.save(); },
    updateUI() {
        const cnt = this.getTotalItems();
        Utils.setBadge(document.getElementById('cartCount'), cnt);
        Utils.setBadge(document.getElementById('mobileCartCount'), cnt);
        this.renderSidebar();
        ProductManager.refreshCardButtons();
    },
    renderSidebar() {
        const cont = document.getElementById('cartItems');
        if (!cont) return;
        if (!state.cart.length) {
            cont.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">shopping_bag</span><h3>কার্ট খালি</h3><p>প্রোডাক্ট যোগ করে কেনাকাটা শুরু করুন</p></div>`;
            this.updateTotals(0);
            return;
        }
        const sub = this.getSubtotal();
        cont.innerHTML = state.cart.map(item => {
            const total = Number(item.price) * (item.quantity || 1);
            const safeTitle = Utils.escapeHtml(item.title),
                  safeImg = Utils.escapeAttr(item.image || CONFIG.FALLBACK_IMAGE),
                  safeId = Utils.escapeAttr(item.id);
            const prod = state.products.find(p => p.id === item.id);
            const oldPrice = prod && isFinite(Number(prod.oldPrice)) && Number(prod.oldPrice) > 0 ? Number(prod.oldPrice) : null;
            let priceHTML = `<div class="cart-item-price">${Utils.formatPrice(item.price)}</div>`;
            if (oldPrice && oldPrice > Number(item.price)) {
                priceHTML = `<div class="cart-item-price"><span class="cart-item-old-price">${Utils.formatPrice(oldPrice)}</span> ${Utils.formatPrice(item.price)}</div>`;
            }
            const stock = this.getStock(item.id);
            const atMax = item.quantity >= stock;
            return `<div class="cart-item"><img src="${safeImg}" alt="${safeTitle}"><div class="cart-item-details"><div class="cart-item-title">${safeTitle}</div>${priceHTML}<div class="cart-item-controls"><button class="cart-qty-btn" data-action="decrease-qty" data-id="${safeId}" aria-label="কমান"><span class="material-symbols-outlined">remove</span></button><span class="cart-qty-display">${item.quantity}</span><button class="cart-qty-btn" data-action="increase-qty" data-id="${safeId}" aria-label="বাড়ান" ${atMax ? 'disabled' : ''}><span class="material-symbols-outlined">add</span></button></div></div><div class="cart-item-right"><strong class="cart-item-total">${Utils.formatPrice(total)}</strong><button class="cart-remove-btn" data-action="cart-remove" data-id="${safeId}" aria-label="সরান"><span class="material-symbols-outlined">delete</span></button></div></div>`;
        }).join('');
        this.updateTotals(sub);
    },
    updateTotals(sub) {
        const del = Utils.getDeliveryCharge(),
              disc = Utils.calculateDiscount(sub, state.appliedCoupon),
              tot = sub + del - disc;
        let orig = 0;
        state.cart.forEach(item => {
            const prod = state.products.find(p => p.id === item.id);
            const oldPrice = prod && isFinite(Number(prod.oldPrice)) && Number(prod.oldPrice) > 0 ? Number(prod.oldPrice) : Number(item.price);
            orig += oldPrice * (item.quantity || 1);
        });
        document.getElementById('originalTotalAmount').textContent = orig;
        document.getElementById('subTotalAmount').textContent = sub;
        const dRow = document.getElementById('discountRow');
        if (dRow) {
            dRow.style.display = disc > 0 ? 'flex' : 'none';
            document.getElementById('discountAmount').textContent = disc;
        }
        const cLbl = document.getElementById('couponCodeLabel');
        if (cLbl && state.appliedCoupon) cLbl.textContent = state.appliedCoupon.code;

        const sub2 = document.getElementById('subTotalAmount2'); if (sub2) sub2.textContent = sub;
        const del2 = document.getElementById('deliveryChargeAmount2'); if (del2) del2.textContent = del;
        const tot2 = document.getElementById('cartTotalAmount2'); if (tot2) tot2.textContent = tot;
        const dRow2 = document.getElementById('discountRow2');
        if (dRow2) {
            dRow2.style.display = disc > 0 ? 'flex' : 'none';
            document.getElementById('discountAmount2').textContent = disc;
        }
        const cLbl2 = document.getElementById('couponCodeLabel2');
        if (cLbl2 && state.appliedCoupon) cLbl2.textContent = state.appliedCoupon.code;
    }
};

// ===== WISHLIST MANAGER =====
const WishlistManager = {
    load() { state.wishlist = Utils.load(CONFIG.STORAGE_KEYS.WISHLIST); },
    save() { Utils.save(CONFIG.STORAGE_KEYS.WISHLIST, state.wishlist); this.updateUI(); },
    toggle(id) {
        const p = state.products.find(p => p.id === id);
        if (!p) return;
        const idx = state.wishlist.findIndex(i => i.id === id);
        if (idx > -1) { state.wishlist.splice(idx, 1); Toast.info('পছন্দ থেকে সরানো হয়েছে'); }
        else { state.wishlist.push({ id: p.id, title: p.title, price: p.price, image: p.image }); Toast.success('পছন্দে যোগ হয়েছে'); }
        this.save();
    },
    isFavorite(id) { return state.wishlist.some(i => i.id === id); },
    addToCart(id) { CartManager.add(id); this.remove(id); },
    remove(id) { state.wishlist = state.wishlist.filter(i => i.id !== id); this.save(); },
    updateUI() {
        Utils.setBadge(document.getElementById('wishlistCount'), state.wishlist.length);
        document.querySelectorAll('.wishlist-btn').forEach(b => b.classList.toggle('active', this.isFavorite(b.dataset.id)));
        this.renderModal();
    },
    renderModal() {
        const cont = document.getElementById('wishlistItems');
        if (!cont) return;
        if (!state.wishlist.length) {
            cont.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">favorite_border</span><h3>পছন্দ তালিকা খালি</h3></div>`;
            return;
        }
        cont.innerHTML = state.wishlist.map(i => {
            const safeTitle = Utils.escapeHtml(i.title),
                  safeImg = Utils.escapeAttr(i.image || CONFIG.FALLBACK_IMAGE),
                  safeId = Utils.escapeAttr(i.id);
            return `<div class="wishlist-item"><img src="${safeImg}" alt="${safeTitle}"><div class="wishlist-item-details"><div class="wishlist-item-title">${safeTitle}</div><div class="wishlist-item-price">${Utils.formatPrice(i.price)}</div></div><button class="wishlist-cart-btn" data-action="wishlist-to-cart" data-id="${safeId}" aria-label="কার্টে যোগ করুন"><span class="material-symbols-outlined">add_shopping_cart</span></button><button class="wishlist-remove-btn" data-action="wishlist-remove" data-id="${safeId}" aria-label="সরান"><span class="material-symbols-outlined">close</span></button></div>`;
        }).join('');
    }
};

// ===== RECENTLY VIEWED MANAGER =====
const RecentManager = {
    load() { state.recentlyViewed = Utils.load(CONFIG.STORAGE_KEYS.RECENT); },
    add(id) {
        state.recentlyViewed = state.recentlyViewed.filter(rid => rid !== id);
        state.recentlyViewed.unshift(id);
        state.recentlyViewed = state.recentlyViewed.slice(0, CONFIG.RECENT_LIMIT);
        Utils.save(CONFIG.STORAGE_KEYS.RECENT, state.recentlyViewed);
        this.render();
    },
    render() {
        const section = document.getElementById('recentlyViewedSection'),
              cont = document.getElementById('recentlyViewedContainer');
        if (!section || !cont) return;
        const items = state.recentlyViewed
            .map(id => state.products.find(p => p.id === id))
            .filter(Boolean)
            .filter(p => p.id !== state.currentDetailId);
        if (!items.length) { section.hidden = true; return; }
        section.hidden = false;
        cont.innerHTML = items.map(p => ProductManager.buildCardHTML(p)).join('');
    }
};

// ===== PRODUCT MANAGER =====
const ProductManager = {
    filterByCategory(prods, cat) {
        return !cat || cat === 'all' ? prods : prods.filter(p => (p.category || '').toLowerCase() === cat.toLowerCase());
    },
    sortProducts(prods, sortKey) {
        const list = [...prods];
        switch (sortKey) {
            case 'price-asc': return list.sort((a, b) => Number(a.price) - Number(b.price));
            case 'price-desc': return list.sort((a, b) => Number(b.price) - Number(a.price));
            case 'name-asc': return list.sort((a, b) => a.title.localeCompare(b.title, 'bn'));
            case 'discount': return list.sort((a, b) => {
                const da = a.oldPrice > a.price ? (1 - a.price / a.oldPrice) : 0;
                const db = b.oldPrice > b.price ? (1 - b.price / b.oldPrice) : 0;
                return db - da;
            });
            default: return list;
        }
    },
    isValidProduct(p) { return p && p.id && p.title; },
    buildQtyControlHTML(id, qty) {
        return `<div class="main-qty-control"><button data-action="decrease-qty" data-id="${id}" aria-label="কমান"><span class="material-symbols-outlined">remove</span></button><span>${qty}</span><button data-action="increase-qty" data-id="${id}" aria-label="বাড়ান"><span class="material-symbols-outlined">add</span></button></div>`;
    },
    buildAddButtonHTML(id, out) {
        return out ? '<button class="add-btn" disabled>স্টক নেই</button>' : `<button class="add-btn" data-action="add-to-cart" data-id="${id}">কার্টে যোগ করুন</button>`;
    },
    buildCardHTML(p) {
        const cartItem = CartManager.getItem(p.id),
              qty = cartItem?.quantity || 0,
              isWish = WishlistManager.isFavorite(p.id);
        const stock = p.stock !== undefined ? Number(p.stock) : 9999,
              out = stock <= 0,
              low = !out && stock <= CONFIG.LOW_STOCK_THRESHOLD;
        const price = isFinite(Number(p.price)) ? Number(p.price) : 0,
              oldPrice = isFinite(Number(p.oldPrice)) ? Number(p.oldPrice) : 0;
        let badge = '', priceHTML = Utils.formatPrice(price);
        if (out) badge = '<span class="stock-badge">স্টক নেই</span>';
        else if (oldPrice > price && oldPrice > 0) {
            const d = Math.round(100 - (price / oldPrice) * 100);
            badge = `<span class="discount-badge">-${d}%</span>`;
            priceHTML = `<span class="old">${Utils.formatPrice(oldPrice)}</span>${priceHTML}`;
        }
        const lowStockHTML = low ? `<div class="low-stock-note"><span class="material-symbols-outlined">local_fire_department</span>মাত্র ${stock}টি বাকি</div>` : '';
        const btnHTML = out ? this.buildAddButtonHTML(p.id, true) : (qty > 0 ? this.buildQtyControlHTML(p.id, qty) : this.buildAddButtonHTML(p.id, false));
        return `<div class="product-card" tabindex="0" role="button" aria-label="${Utils.escapeAttr(p.title)}, বিস্তারিত দেখুন" data-product-id="${Utils.escapeAttr(p.id)}" data-category="${Utils.escapeAttr(p.category || '')}" data-action="open-product-detail">
            ${badge}<button class="wishlist-btn ${isWish ? 'active' : ''}" data-id="${Utils.escapeAttr(p.id)}" data-action="toggle-wishlist" aria-label="পছন্দে যোগ করুন" tabindex="0"><span class="material-symbols-outlined">favorite</span></button>
            <img class="product-image" src="${Utils.escapeAttr(p.image || CONFIG.FALLBACK_IMAGE)}" alt="${Utils.escapeHtml(p.title)}" loading="lazy">
            <div class="product-name">${Utils.escapeHtml(p.title)}</div><div class="product-price">${priceHTML}</div>${lowStockHTML}${btnHTML}</div>`;
    },
    render(prods) {
        const cont = document.getElementById('productContainer');
        if (!cont) return;
        const valid = prods.filter(this.isValidProduct);
        const countEl = document.getElementById('resultCount');
        if (countEl) countEl.textContent = valid.length ? `${valid.length}টি প্রোডাক্ট` : '';
        if (!valid.length) {
            cont.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><span class="material-symbols-outlined">inventory_2</span><h3>কোনো প্রোডাক্ট পাওয়া যায়নি</h3><p>ভিন্ন কিছু খুঁজে দেখুন অথবা ফিল্টার পরিবর্তন করুন</p></div>`;
            return;
        }
        cont.innerHTML = valid.map(p => this.buildCardHTML(p)).join('');
    },
    renderCategories() {
        const cont = document.getElementById('categoryContainer');
        if (!cont) return;
        const iconMap = {
            phone: 'smartphone', smartwatch: 'watch', 'power bank': 'battery_charging_full',
            earbuds: 'earbuds', laptop: 'laptop', tablet: 'tablet', router: 'router',
            headphone: 'headphones', keyboard: 'keyboard', charger: 'cable',
            pendrive: 'usb', mouse: 'mouse', all: 'apps'
        };
        const cats = new Set();
        state.products.forEach(p => { if (p.category) cats.add(p.category.toLowerCase()); });
        let html = `<button class="pill active" data-category="all"><span class="material-symbols-outlined">${iconMap.all}</span> সব</button>`;
        Array.from(cats).sort().forEach(c => {
            const lbl = c.charAt(0).toUpperCase() + c.slice(1);
            html += `<button class="pill" data-category="${Utils.escapeAttr(c)}"><span class="material-symbols-outlined">${iconMap[c] || 'category'}</span> ${Utils.escapeHtml(lbl)}</button>`;
        });
        cont.innerHTML = html;
    },
    refreshCardButtons() {
        document.querySelectorAll('.product-card').forEach(card => {
            const pid = card.dataset.productId;
            if (!pid) return;
            const prod = state.products.find(p => p.id === pid),
                  cartItem = CartManager.getItem(pid),
                  qty = cartItem?.quantity || 0;
            const stock = prod?.stock !== undefined ? Number(prod.stock) : 9999,
                  out = stock <= 0;
            const btn = card.querySelector('.main-qty-control, .add-btn');
            if (!btn) return;
            btn.outerHTML = out ? this.buildAddButtonHTML(pid, true) : (qty > 0 ? this.buildQtyControlHTML(pid, qty) : this.buildAddButtonHTML(pid, false));
        });
    },
    openDetail(pid) {
        const p = state.products.find(p => p.id === pid);
        if (!this.isValidProduct(p)) { Toast.error('প্রোডাক্ট পাওয়া যায়নি'); return; }
        state.currentDetailId = pid;
        const stock = p.stock !== undefined ? Number(p.stock) : 9999,
              out = stock <= 0,
              low = !out && stock <= CONFIG.LOW_STOCK_THRESHOLD;
        const price = isFinite(Number(p.price)) ? Number(p.price) : 0,
              oldPrice = isFinite(Number(p.oldPrice)) ? Number(p.oldPrice) : 0;
        document.getElementById('detailImage').src = p.image || CONFIG.FALLBACK_IMAGE;
        document.getElementById('detailImage').alt = p.title;
        document.getElementById('detailTitle').textContent = p.title;
        document.getElementById('detailPrice').innerHTML = (oldPrice > price && oldPrice > 0) ? `<span class="old">${Utils.formatPrice(oldPrice)}</span> ${Utils.formatPrice(price)}` : Utils.formatPrice(price);
        const discEl = document.getElementById('detailDiscount');
        if (oldPrice > price && oldPrice > 0) { discEl.textContent = `-${Math.round(100 - (price / oldPrice) * 100)}%`; discEl.classList.add('show'); }
        else discEl.classList.remove('show');
        const stockEl = document.getElementById('detailStock');
        stockEl.textContent = out ? 'স্টক নেই' : (low ? `মাত্র ${stock}টি বাকি — দ্রুত অর্ডার করুন` : 'স্টকে আছে');
        stockEl.classList.toggle('out-of-stock', out);
        stockEl.classList.toggle('in-stock', !out);
        stockEl.classList.toggle('low-stock', low);
        document.getElementById('detailDesc').textContent = p.description || 'বিবরণ নেই';
        const addBtn = document.getElementById('detailAddBtn');
        addBtn.dataset.id = pid;
        addBtn.disabled = out;
        addBtn.innerHTML = out ? '<span class="material-symbols-outlined">block</span>স্টক নেই' : '<span class="material-symbols-outlined">add_shopping_cart</span>কার্টে যোগ করুন';
        const wishBtn = document.getElementById('detailWishlistBtn');
        wishBtn.dataset.id = pid;
        const isFav = WishlistManager.isFavorite(pid);
        wishBtn.classList.toggle('active', isFav);
        wishBtn.setAttribute('aria-pressed', String(isFav));
        const icon = wishBtn.querySelector('.material-symbols-outlined');
        if (icon) icon.style.fontVariationSettings = isFav ? "'FILL' 1" : "'FILL' 0";
        state.lastFocusedEl = document.activeElement;
        document.getElementById('productDetailPanel').classList.add('open');
        document.getElementById('productDetailOverlay').classList.add('open');
        const body = document.querySelector('.product-detail-body');
        if (body) body.scrollTop = 0;
        document.getElementById('closeProductDetail')?.focus();
        RecentManager.add(pid);
    },
    closeDetail() {
        document.getElementById('productDetailPanel').classList.remove('open');
        document.getElementById('productDetailOverlay').classList.remove('open');
        if (state.lastFocusedEl instanceof HTMLElement) state.lastFocusedEl.focus();
    },
    showSkeleton() {
        document.getElementById('productContainer').innerHTML = Array(12).fill(`<div class="product-card skeleton-card"><div class="skeleton shimmer" style="aspect-ratio:1;border-radius:12px;margin-bottom:12px;"></div><div class="skeleton shimmer" style="height:18px;width:70%;border-radius:6px;margin:0 auto 8px;"></div><div class="skeleton shimmer" style="height:16px;width:40%;border-radius:6px;margin:0 auto 16px;"></div><div class="skeleton shimmer" style="height:42px;border-radius:10px;"></div></div>`).join('');
    }
};

// ===== ORDER MANAGER =====
const OrderManager = {
    load() { return Utils.load(CONFIG.STORAGE_KEYS.ORDERS); },
    save(o) { Utils.save(CONFIG.STORAGE_KEYS.ORDERS, o); },
    async placeOrder(fd) {
        if (state.isProcessing) return;
        state.isProcessing = true;
        const btn = document.getElementById('checkoutBtn');
        if (btn) { btn.classList.add('loading'); btn.disabled = true; }
        try {
            const sub = CartManager.getSubtotal(),
                  del = Utils.getDeliveryCharge(),
                  disc = Utils.calculateDiscount(sub, state.appliedCoupon),
                  tot = sub + del - disc;
            const oid = state.editingOrderId || Utils.generateOrderId();

            // Fold coupon/discount into the note field since the sheet has no
            // dedicated column for them — everything else maps 1:1, in the
            // exact order of your "order" tab's columns, so a positional
            // appendRow() on the Apps Script side lines up correctly.
            let noteText = fd.note || 'নেই';
            if (disc > 0) {
                const couponTag = state.appliedCoupon?.code ? ` [কুপন: ${state.appliedCoupon.code}]` : '';
                noteText += ` | ছাড়: ${disc}৳${couponTag}`;
            }

            const payload = {
                'date&time': new Date().toLocaleString('bn-BD', { hour12: true }),
                orderId: oid,
                name: fd.name,
                mobile: fd.phone,
                address: fd.address,
                productName: state.cart.map(i => `${i.title} (${i.quantity}টি)`).join(', '),
                subTotal: sub,
                deliveryCharge: del,
                total: tot,
                paymentMethod: 'COD',
                stat: 'Pending',
                courierName: '',
                trackingId: '',
                note: noteText
            };

            // AbortController for timeout
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            try {
                await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
                    method: 'POST',
                    mode: 'no-cors',
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timer);
            }

            if (fd.remember) {
                Utils.save(CONFIG.STORAGE_KEYS.SAVED_INFO, { name: fd.name, address: fd.address, phone: fd.phone });
            } else {
                Utils.save(CONFIG.STORAGE_KEYS.SAVED_INFO, null);
            }

            // Save locally
            const hist = this.load().filter(o => o.orderId !== oid);
            hist.unshift({
                orderId: oid,
                date: new Date().toLocaleString('bn-BD', { hour12: true }),
                items: state.cart.map(i => `${i.title} (${i.quantity}টি)`).join(', '),
                rawItems: JSON.parse(JSON.stringify(state.cart)),
                subTotal: sub,
                deliveryCharge: del,
                total: tot,
                status: 'Pending',
                courierName: '',
                trackingId: '',
                customerInfo: { name: fd.name, address: fd.address, phone: fd.phone }
            });
            this.save(hist);

            state.editingOrderId = null;
            CartManager.clear();
            this.clearCheckoutForm({ keepSaved: fd.remember });
            document.getElementById('successOrderId').textContent = `অর্ডার নম্বর: ${oid}`;
            Modal.hideAll();
            Modal.show('orderSuccessModal');
            Utils.closeCart();
            return true;
        } catch (err) {
            console.error('Order failed:', err);
            Toast.error('অর্ডার সম্পন্ন করতে সমস্যা হয়েছে, আবার চেষ্টা করুন');
            return false;
        } finally {
            state.isProcessing = false;
            if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
        }
    },
    clearCheckoutForm({ keepSaved = false } = {}) {
        if (!keepSaved) {
            ['custName', 'custAddress', 'custPhone', 'custNote'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.value = ''; el.classList.remove('field-invalid'); }
            });
        }
        const coupon = document.getElementById('couponInput');
        if (coupon) coupon.value = '';
        document.getElementById('phoneError').style.display = 'none';
        Utils.resetCartSlider();
    },
    prefillSavedInfo() {
        const saved = Utils.load(CONFIG.STORAGE_KEYS.SAVED_INFO, null);
        if (!saved) return;
        const nameEl = document.getElementById('custName'),
              addrEl = document.getElementById('custAddress'),
              phoneEl = document.getElementById('custPhone'),
              rememberEl = document.getElementById('rememberInfo');
        if (nameEl && !nameEl.value) nameEl.value = saved.name || '';
        if (addrEl && !addrEl.value) addrEl.value = saved.address || '';
        if (phoneEl && !phoneEl.value) phoneEl.value = saved.phone || '';
        if (rememberEl) rememberEl.checked = true;
    },
    renderHistory() {
        const hist = this.load(),
              cont = document.getElementById('orderHistoryContainer');
        if (!cont) return;
        if (!hist.length) {
            cont.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">history</span><h3>কোনো অর্ডার ইতিহাস নেই</h3></div>`;
            Modal.show('orderHistoryModal');
            return;
        }
        const statusConfig = {
            Pending: { cls: 'pending', icon: 'schedule', label: 'পেন্ডিং' },
            Processing: { cls: 'processing', icon: 'autorenew', label: 'প্রসেসিং' },
            Delivered: { cls: 'delivered', icon: 'task_alt', label: 'ডেলিভার্ড' },
            Cancelled: { cls: 'cancelled', icon: 'cancel', label: 'বাতিল' }
        };
        cont.innerHTML = hist.map(o => {
            const st = o.status || 'Pending',
                  cfg = statusConfig[st] || statusConfig.Pending,
                  canEdit = st === 'Pending',
                  canDelete = ['Delivered', 'Cancelled'].includes(st);
            let custHtml = '';
            if (o.customerInfo) {
                custHtml = `<div class="order-card-customer"><strong>${Utils.escapeHtml(o.customerInfo.name || '')}</strong> · ${Utils.escapeHtml(o.customerInfo.phone || '')}<br>${Utils.escapeHtml(o.customerInfo.address || '')}</div>`;
            }
            return `<div class="order-history-card">
                <div class="order-card-header">
                    <span class="order-card-id"><span class="material-symbols-outlined">local_shipping</span>${Utils.escapeHtml(o.orderId)}</span>
                    <span class="status-badge ${cfg.cls}"><span class="material-symbols-outlined">${cfg.icon}</span>${cfg.label}</span>
                </div>
                <div class="order-card-date">${Utils.escapeHtml(o.date)}</div>
                <div class="order-card-products">${Utils.escapeHtml(o.items)}</div>
                ${custHtml}
                ${o.courierName || o.trackingId ? `<div class="order-card-tracking">${o.courierName ? `<span class="material-symbols-outlined">local_shipping</span>${Utils.escapeHtml(o.courierName)}` : ''}${o.trackingId ? `<span class="material-symbols-outlined">tag</span>${Utils.escapeHtml(o.trackingId)}` : ''}</div>` : ''}
                <div class="order-card-footer">
                    <div class="order-card-total">${Utils.formatPrice(o.total)}</div>
                    <div class="order-card-actions">
                        ${canEdit ? `<button class="action-btn edit-btn" data-action="order-edit" data-id="${Utils.escapeAttr(o.orderId)}" aria-label="সম্পাদনা"><span class="material-symbols-outlined">edit</span></button><button class="action-btn cancel-btn" data-action="order-cancel" data-id="${Utils.escapeAttr(o.orderId)}" aria-label="বাতিল করুন"><span class="material-symbols-outlined">cancel</span></button>` : ''}
                        ${canDelete ? `<button class="action-btn delete-btn" data-action="order-delete" data-id="${Utils.escapeAttr(o.orderId)}" aria-label="ডিলিট"><span class="material-symbols-outlined">delete</span></button>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');
        Modal.show('orderHistoryModal');
        this.syncStatusFromServer(hist);
    },
    /**
     * Best-effort status sync. The backend Apps Script only exposes a POST/no-cors
     * write endpoint, so this makes a defensive GET attempt (in case the script
     * also handles GET with CORS) and silently no-ops on any failure. It never
     * throws and never blocks the UI — order history already rendered above.
     */
    async syncStatusFromServer(hist) {
        if (!hist.length) return;
        try {
            const ids = hist.map(o => o.orderId).join(',');
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            let res;
            try {
                res = await fetch(`${CONFIG.GOOGLE_SCRIPT_URL}?action=status&orderIds=${encodeURIComponent(ids)}`, { signal: controller.signal });
            } finally {
                clearTimeout(timer);
            }
            if (!res || !res.ok) return;
            const data = await res.json().catch(() => null);
            if (!Array.isArray(data) || !data.length) return;
            let changed = false;
            data.forEach(update => {
                const order = hist.find(o => o.orderId === update.orderId);
                if (order && update.status && order.status !== update.status) {
                    order.status = update.status;
                    order.courierName = update.courierName || order.courierName;
                    order.trackingId = update.trackingId || order.trackingId;
                    changed = true;
                }
            });
            if (changed) { this.save(hist); this.renderHistory(); }
        } catch { /* backend doesn't support status polling — history stays as last known locally */ }
    },
    editOrder(oid) {
        const hist = this.load(),
              o = hist.find(o => o.orderId === oid);
        if (!o || o.status !== 'Pending') { Toast.error('পরিবর্তন করা যাবে না'); return; }
        state.cart = o.rawItems?.map(i => ({ ...i })) || [];
        CartManager.save();
        if (o.customerInfo) {
            document.getElementById('custName').value = o.customerInfo.name || '';
            document.getElementById('custAddress').value = o.customerInfo.address || '';
            document.getElementById('custPhone').value = o.customerInfo.phone || '';
        }
        state.editingOrderId = oid;
        Modal.hideAll();
        Utils.openCart();
        document.getElementById('cartSliderWrapper').style.transform = 'translateX(-50%)';
        Toast.info('কার্ট লোড হয়েছে, তথ্য যাচাই করে আবার নিশ্চিত করুন');
    },
    async cancelOrder(oid) {
        const hist = this.load(),
              o = hist.find(o => o.orderId === oid);
        if (!o || o.status !== 'Pending') { Toast.error('বাতিল করা যাবে না'); return; }
        o.status = 'Cancelled';
        o.date = new Date().toLocaleString('bn-BD', { hour12: true }) + ' (বাতিল)';
        this.save(hist);
        Toast.info('অর্ডার বাতিল');
        this.renderHistory();
        try { await fetch(CONFIG.GOOGLE_SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ orderId: oid, stat: 'Cancelled', 'date&time': o.date }) }); } catch { /* best-effort notify — local state already updated */ }
    },
    async deleteOrder(oid) {
        let hist = this.load();
        const o = hist.find(o => o.orderId === oid);
        if (!o || !['Delivered', 'Cancelled'].includes(o.status)) { Toast.error('ডিলিট করা যাবে না'); return; }
        hist = hist.filter(o => o.orderId !== oid);
        this.save(hist);
        Toast.success('অর্ডার ডিলিট');
        this.renderHistory();
        try { await fetch(CONFIG.GOOGLE_SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ orderId: oid, stat: 'Deleted By Customer' }) }); } catch { /* best-effort notify — local state already updated */ }
    }
};

// ===== SLIDER =====
const Slider = {
    total: 3,
    go(i) {
        const slider = document.getElementById('imageSlider'),
              dots = document.querySelectorAll('#sliderDots .dot');
        if (!slider) return;
        state.currentSlide = (i + this.total) % this.total;
        slider.style.transform = `translateX(-${(state.currentSlide * 100) / this.total}%)`;
        dots.forEach((d, j) => {
            const active = j === state.currentSlide;
            d.classList.toggle('active', active);
            d.setAttribute('aria-selected', String(active));
        });
    },
    restart() {
        clearInterval(state.slideInterval);
        state.slideInterval = setInterval(() => this.go(state.currentSlide + 1), CONFIG.SLIDER_INTERVAL);
    },
    init() {
        const container = document.getElementById('sliderContainer'),
              dots = document.querySelectorAll('#sliderDots .dot'),
              prevBtn = document.getElementById('sliderPrev'),
              nextBtn = document.getElementById('sliderNext');
        if (!container || !dots.length) return;
        dots.forEach((d, i) => d.addEventListener('click', () => { this.go(i); this.restart(); }));
        prevBtn?.addEventListener('click', () => { this.go(state.currentSlide - 1); this.restart(); });
        nextBtn?.addEventListener('click', () => { this.go(state.currentSlide + 1); this.restart(); });
        container.addEventListener('mouseenter', () => clearInterval(state.slideInterval));
        container.addEventListener('mouseleave', () => this.restart());
        container.addEventListener('focusin', () => clearInterval(state.slideInterval));
        container.addEventListener('focusout', () => this.restart());

        // Touch swipe support
        let startX = 0, isSwiping = false;
        container.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; isSwiping = true; clearInterval(state.slideInterval); }, { passive: true });
        container.addEventListener('touchmove', (e) => { if (!isSwiping) return; }, { passive: true });
        container.addEventListener('touchend', (e) => {
            if (!isSwiping) return;
            isSwiping = false;
            const endX = e.changedTouches[0].clientX,
                  diff = endX - startX;
            if (Math.abs(diff) > 40) { diff > 0 ? this.go(state.currentSlide - 1) : this.go(state.currentSlide + 1); }
            this.restart();
        });

        this.go(0);
        if (!Utils.prefersReducedMotion()) this.restart();
    }
};

// ===== SEARCH =====
const Search = {
    activeIndex: -1,
    results: [],
    init() {
        const input = document.getElementById('productSearch'),
              dropdown = document.getElementById('searchResults'),
              clearBtn = document.getElementById('clearSearchBtn');
        if (!input || !dropdown) return;
        const runSearch = Utils.debounce((val) => {
            if (!val) { this.close(); return; }
            this.results = state.products.filter(p => p.title.toLowerCase().includes(val));
            this.activeIndex = -1;
            this.renderResults(this.results);
        }, 150);
        input.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase().trim();
            if (clearBtn) clearBtn.hidden = !e.target.value;
            if (!val) { this.close(); return; }
            runSearch(val);
        });
        input.addEventListener('keydown', (e) => {
            if (!dropdown.classList.contains('active')) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
            else if (e.key === 'Enter') { e.preventDefault(); this.selectActive(input, dropdown); }
            else if (e.key === 'Escape') { this.close(); }
        });
        clearBtn?.addEventListener('click', () => {
            input.value = '';
            clearBtn.hidden = true;
            this.close();
            input.focus();
        });
        dropdown.addEventListener('click', (e) => {
            const item = e.target.closest('[data-action="open-product-detail"]');
            if (item?.dataset.id) {
                ProductManager.openDetail(item.dataset.id);
                this.close();
                input.value = '';
                if (clearBtn) clearBtn.hidden = true;
            }
        });
        document.addEventListener('click', (e) => { if (!e.target.closest('.search-box')) this.close(); });
    },
    move(delta) {
        if (!this.results.length) return;
        this.activeIndex = (this.activeIndex + delta + this.results.length) % this.results.length;
        this.highlight();
    },
    highlight() {
        const items = document.querySelectorAll('#searchResults .search-result-item');
        items.forEach((el, i) => el.classList.toggle('active', i === this.activeIndex));
        items[this.activeIndex]?.scrollIntoView({ block: 'nearest' });
    },
    selectActive(input, dropdown) {
        const target = this.results[this.activeIndex] || this.results[0];
        if (target) {
            ProductManager.openDetail(target.id);
            this.close();
            input.value = '';
            document.getElementById('clearSearchBtn').hidden = true;
        }
    },
    close() {
        const dropdown = document.getElementById('searchResults'),
              input = document.getElementById('productSearch');
        dropdown?.classList.remove('active');
        input?.setAttribute('aria-expanded', 'false');
        this.activeIndex = -1;
    },
    renderResults(prods) {
        const dropdown = document.getElementById('searchResults'),
              input = document.getElementById('productSearch');
        if (!prods.length) {
            dropdown.innerHTML = `<div class="search-result-item" style="justify-content:center;color:#5a5f78;cursor:default;">কোনো ফলাফল নেই</div>`;
            dropdown.classList.add('active');
            input?.setAttribute('aria-expanded', 'true');
            return;
        }
        dropdown.innerHTML = prods.slice(0, 8).map(p => {
            const safeId = Utils.escapeAttr(p.id),
                  safeTitle = Utils.escapeHtml(p.title),
                  safeImg = Utils.escapeAttr(p.image || CONFIG.FALLBACK_IMAGE);
            return `<div class="search-result-item" data-action="open-product-detail" data-id="${safeId}" role="option"><img class="search-result-img" src="${safeImg}" alt=""><div class="search-result-info"><div class="search-result-title">${safeTitle}</div><div class="search-result-price">${Utils.formatPrice(p.price)}</div></div></div>`;
        }).join('');
        dropdown.classList.add('active');
        input?.setAttribute('aria-expanded', 'true');
    }
};

// ===== DELEGATED CLICK ROUTER =====
const ActionRouter = {
    handlers: {
        'add-to-cart': (id) => CartManager.add(id),
        'increase-qty': (id) => CartManager.changeQuantity(id, 1),
        'decrease-qty': (id) => CartManager.changeQuantity(id, -1),
        'cart-remove': (id) => CartManager.remove(id),
        'toggle-wishlist': (id) => WishlistManager.toggle(id),
        'wishlist-to-cart': (id) => WishlistManager.addToCart(id),
        'wishlist-remove': (id) => WishlistManager.remove(id),
        'order-edit': (id) => OrderManager.editOrder(id),
        'order-cancel': (id) => OrderManager.cancelOrder(id),
        'order-delete': (id) => OrderManager.deleteOrder(id)
    },
    attach(container) {
        container.addEventListener('click', (e) => {
            const actionEl = e.target.closest('[data-action]');
            if (!actionEl || !container.contains(actionEl)) return;
            const { action, id } = actionEl.dataset;
            if (action === 'open-product-detail') {
                const card = actionEl.closest('.product-card');
                if (card?.dataset.productId) ProductManager.openDetail(card.dataset.productId);
                return;
            }
            const handler = this.handlers[action];
            if (handler && id) { e.stopPropagation(); handler(id); }
        });
        // Keyboard accessibility: Enter / Space activates focused product cards
        container.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.closest('.product-card[data-action="open-product-detail"]');
            if (!card || e.target !== card) return;
            e.preventDefault();
            if (card.dataset.productId) ProductManager.openDetail(card.dataset.productId);
        });
    }
};

function attachImageFallback(root) {
    root.addEventListener('error', (e) => {
        const img = e.target;
        if (img.tagName !== 'IMG' || img.dataset.fallbackApplied) return;
        img.dataset.fallbackApplied = 'true';
        img.src = img.classList.contains('logo-img') ? CONFIG.FALLBACK_LOGO : CONFIG.FALLBACK_IMAGE;
    }, true);
}

function refreshProductView() {
    const filtered = ProductManager.filterByCategory(state.products, state.activeCategory);
    const sorted = ProductManager.sortProducts(filtered, state.activeSort);
    ProductManager.render(sorted);
}

// ===== EVENTS =====
function initEvents() {
    attachImageFallback(document.body);
    ['productContainer', 'recentlyViewedContainer', 'cartItems', 'wishlistItems', 'orderHistoryContainer'].forEach(id => {
        const el = document.getElementById(id);
        if (el) ActionRouter.attach(el);
    });
    document.getElementById('cartBtn')?.addEventListener('click', Utils.openCart);
    document.getElementById('mobileCartBtn')?.addEventListener('click', Utils.openCart);
    document.getElementById('closeCart')?.addEventListener('click', Utils.closeCart);
    document.getElementById('cartOverlay')?.addEventListener('click', Utils.closeCart);
    document.getElementById('closeProductDetail')?.addEventListener('click', ProductManager.closeDetail);
    document.getElementById('productDetailOverlay')?.addEventListener('click', ProductManager.closeDetail);
    document.getElementById('detailAddBtn')?.addEventListener('click', function() {
        if (this.disabled) return;
        CartManager.add(this.dataset.id);
        ProductManager.closeDetail();
    });
    document.getElementById('detailWishlistBtn')?.addEventListener('click', function() {
        if (this.dataset.id) {
            WishlistManager.toggle(this.dataset.id);
            const isFav = WishlistManager.isFavorite(this.dataset.id);
            this.classList.toggle('active', isFav);
            this.setAttribute('aria-pressed', String(isFav));
            const icon = this.querySelector('.material-symbols-outlined');
            if (icon) icon.style.fontVariationSettings = isFav ? "'FILL' 1" : "'FILL' 0";
        }
    });
    document.getElementById('goToCheckoutBtn')?.addEventListener('click', () => {
        if (!state.cart.length) Modal.show('emptyCartModal');
        else {
            CartManager.renderSidebar();
            document.getElementById('cartSliderWrapper').style.transform = 'translateX(-50%)';
            OrderManager.prefillSavedInfo();
        }
    });
    document.getElementById('backToCartBtn')?.addEventListener('click', Utils.resetCartSlider);
    document.getElementById('deliveryArea')?.addEventListener('change', () => CartManager.renderSidebar());
    document.getElementById('applyCouponBtn')?.addEventListener('click', () => {
        const code = document.getElementById('couponInput').value.trim().toUpperCase();
        if (!code) { Toast.error('একটি কুপন কোড লিখুন'); return; }
        if (CONFIG.COUPONS[code]) {
            state.appliedCoupon = { code, ...CONFIG.COUPONS[code] };
            Toast.success(`"${code}" কুপন প্রয়োগ!`);
        } else {
            state.appliedCoupon = null;
            Toast.error('কুপন কোড সঠিক নয়');
        }
        CartManager.renderSidebar();
    });
    document.getElementById('couponInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('applyCouponBtn')?.click(); }
    });
    document.getElementById('wishlistBtn')?.addEventListener('click', () => {
        WishlistManager.renderModal();
        Modal.show('wishlistModal');
    });
    document.getElementById('mobileWishlistBtn')?.addEventListener('click', () => {
        WishlistManager.renderModal();
        Modal.show('wishlistModal');
    });
    document.getElementById('closeWishlistModal')?.addEventListener('click', () => Modal.hide('wishlistModal'));
    document.getElementById('historyBtn')?.addEventListener('click', () => OrderManager.renderHistory());
    document.getElementById('mobileHistoryBtn')?.addEventListener('click', () => OrderManager.renderHistory());
    document.getElementById('closeOrderHistoryModal')?.addEventListener('click', () => Modal.hide('orderHistoryModal'));

    // Checkout button — validation only; OrderManager.placeOrder() owns the
    // isProcessing flag + loading UI end-to-end (including its finally block),
    // so the handler must never toggle that state itself or the guard deadlocks.
    document.getElementById('checkoutBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        if (state.isProcessing) return;
        if (!state.cart.length) { Modal.show('emptyCartModal'); return; }

        const nameEl = document.getElementById('custName');
        const addressEl = document.getElementById('custAddress');
        const phoneEl = document.getElementById('custPhone');
        const noteEl = document.getElementById('custNote');
        const rememberEl = document.getElementById('rememberInfo');

        const name = nameEl.value.trim();
        const address = addressEl.value.trim();
        const phone = phoneEl.value.trim();
        const note = noteEl.value.trim();
        const remember = !!rememberEl?.checked;

        const requiredFields = [
            { el: nameEl, value: name },
            { el: addressEl, value: address },
            { el: phoneEl, value: phone }
        ];
        const missing = requiredFields.filter(f => !f.value);
        requiredFields.forEach(f => f.el.classList.toggle('field-invalid', !f.value));
        if (missing.length) { Toast.error('নাম, ঠিকানা ও মোবাইল নম্বর পূরণ করুন'); missing[0].el.focus(); return; }
        if (!Utils.isValidPhone(phone)) {
            phoneEl.classList.add('field-invalid');
            document.getElementById('phoneError').style.display = 'block';
            phoneEl.focus();
            return;
        }
        document.getElementById('phoneError').style.display = 'none';

        await OrderManager.placeOrder({ name, address, phone, note, remember });
    });

    ['custName', 'custAddress', 'custPhone'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', function() {
            this.classList.remove('field-invalid');
            if (id === 'custPhone') document.getElementById('phoneError').style.display = 'none';
        });
    });
    document.getElementById('closeSuccessBtn')?.addEventListener('click', () => Modal.hide('orderSuccessModal'));
    document.getElementById('closeEmptyCartBtn')?.addEventListener('click', () => Modal.hide('emptyCartModal'));
    document.getElementById('categoryContainer')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.pill');
        if (!btn) return;
        document.querySelectorAll('#categoryContainer .pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeCategory = btn.dataset.category;
        refreshProductView();
        if (window.innerWidth <= 480) btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
    document.getElementById('sortSelect')?.addEventListener('change', (e) => {
        state.activeSort = e.target.value;
        refreshProductView();
    });
    const catPills = document.getElementById('categoryContainer'),
          leftBtn = document.getElementById('catScrollLeft'),
          rightBtn = document.getElementById('catScrollRight');
    if (catPills && leftBtn && rightBtn) {
        leftBtn.addEventListener('click', () => catPills.scrollBy({ left: -200, behavior: 'smooth' }));
        rightBtn.addEventListener('click', () => catPills.scrollBy({ left: 200, behavior: 'smooth' }));
    }
    window.addEventListener('scroll', () => {
        const btn = document.getElementById('backToTopBtn');
        if (!btn) return;
        btn.classList.toggle('show', window.scrollY > CONFIG.SCROLL_THRESHOLD);
    }, { passive: true });
    document.getElementById('backToTopBtn')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    document.getElementById('navHomeBtn')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    document.getElementById('navCategoryBtn')?.addEventListener('click', () => document.querySelector('.category-section')?.scrollIntoView({ behavior: 'smooth' }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { Modal.hideAll(); Utils.closeCart(); ProductManager.closeDetail(); Search.close(); } });
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', (e) => { if (e.target === m) { m.classList.remove('active'); m.setAttribute('aria-hidden', 'true'); } }));
    const header = document.querySelector('header');
    if (header) window.addEventListener('scroll', () => header.classList.toggle('scrolled', window.scrollY > 40), { passive: true });
}

// ===== INIT =====
async function init() {
    CartManager.load();
    WishlistManager.load();
    RecentManager.load();
    ProductManager.showSkeleton();
    Slider.init();
    Search.init();
    initEvents();
    try {
        const data = await fetchProducts();
        state.products = data;
        ProductManager.renderCategories();
        refreshProductView();
        RecentManager.render();
        WishlistManager.updateUI();
        CartManager.updateUI();
    } catch (e) {
        console.error(e);
        document.getElementById('productContainer').innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><span class="material-symbols-outlined">error</span><h3>ডাটা লোডে সমস্যা</h3><p>ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন</p></div>`;
    }
    const loader = document.getElementById('pageLoader');
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => { loader.style.display = 'none'; }, 400);
    }
}
document.addEventListener('DOMContentLoaded', init);