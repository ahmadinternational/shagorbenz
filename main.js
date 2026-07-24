import { fetchProducts, supabase } from './products.js';

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
    activePriceRange: 'all',
    discountOnly: false,
    inStockOnly: false,
    activeSort: 'default',
    appliedCoupon: null,
    editingOrderId: null,
    isProcessing: false,
    lastFocusedEl: null,
    currentDetailId: null
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
    isValidPhone(phone) { return CONFIG.PHONE_REGEX.test(phone.trim()); },
    generateOrderId() {
        const d = new Date().toISOString().slice(2, 10).replace(/-/g, '');
        const random = Math.floor(1000 + Math.random() * 9000);
        return `SB-${d}-${random}`;
    },
    formatPrice(price) { return `${Number(price).toLocaleString('bn-BD')} ৳`; },
    calculateDiscount(subtotal, coupon) {
        if (!coupon) return 0;
        const disc = coupon.type === 'percent' ? Math.round(subtotal * coupon.value / 100) : coupon.value;
        return Math.min(disc, subtotal);
    },
    getDeliveryCharge() {
        const sel = document.getElementById('deliveryArea');
        return sel?.selectedOptions[0]?.dataset?.charge ? parseInt(sel.selectedOptions[0].dataset.charge) : CONFIG.DEFAULT_DELIVERY_CHARGE;
    },
    escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    },
    escapeAttr(str) { return Utils.escapeHtml(str); },
    prefersReducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; },
    resetCartSlider() { const w = document.getElementById('cartSliderWrapper'); if (w) w.style.transform = 'translateX(0)'; },
    closeCart() { document.getElementById('cartSidebar')?.classList.remove('open'); document.getElementById('cartOverlay')?.classList.remove('open'); Utils.resetCartSlider(); },
    openCart() { document.getElementById('cartSidebar')?.classList.add('open'); document.getElementById('cartOverlay')?.classList.add('open'); CartManager.renderSidebar(); Utils.resetCartSlider(); },
    setBadge(el, count) { if (!el) return; el.textContent = count; el.style.display = count > 0 ? 'flex' : 'none'; },
    debounce(fn, wait) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; },
    hashString(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; },
    pseudoRating(id) { return 4.0 + (Utils.hashString(id) % 10) / 10; },
    pseudoReviewCount(id) { return 15 + (Utils.hashString(`${id}-reviews`) % 280); }
};

const Toast = {
    show(msg, icon = 'check_circle', dur = 2200) {
        const cont = document.getElementById('toastContainer');
        if (!cont) return;
        const t = document.createElement('div');
        t.className = 'toast';
        t.innerHTML = `<span class="material-symbols-outlined">${Utils.escapeHtml(icon)}</span><span>${Utils.escapeHtml(msg)}</span>`;
        cont.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; setTimeout(() => t.remove(), 300); }, dur);
    },
    success(msg) { this.show(msg, 'check_circle'); },
    error(msg) { this.show(msg, 'error'); },
    info(msg) { this.show(msg, 'info'); }
};

const Modal = {
    show(id) { const el = document.getElementById(id); if (!el) return; state.lastFocusedEl = document.activeElement; el.classList.add('active'); const focusable = el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'); focusable?.focus(); },
    hide(id) { const el = document.getElementById(id); if (!el) return; el.classList.remove('active'); if (state.lastFocusedEl instanceof HTMLElement) state.lastFocusedEl.focus(); },
    hideAll() { document.querySelectorAll('.modal.active').forEach(m => { m.classList.remove('active'); }); }
};

// ===== CART MANAGER =====
const CartManager = {
    load() { state.cart = Utils.load(CONFIG.STORAGE_KEYS.CART); },
    save() { Utils.save(CONFIG.STORAGE_KEYS.CART, state.cart); this.updateUI(); },
    getItem(id) { return state.cart.find(i => i.id === id); },
    getTotalItems() { return state.cart.reduce((s, i) => s + (i.quantity || 1), 0); },
    getSubtotal() { return state.cart.reduce((s, i) => s + Number(i.price) * (i.quantity || 1), 0); },
    getStock(id) { const p = state.products.find(p => p.id === id); return p?.stock !== undefined ? Number(p.stock) : 9999; },
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
            const safeTitle = Utils.escapeHtml(item.title), safeImg = Utils.escapeAttr(item.image || CONFIG.FALLBACK_IMAGE), safeId = Utils.escapeAttr(item.id);
            const prod = state.products.find(p => p.id === item.id);
            const oldPrice = prod?.oldPrice && isFinite(Number(prod.oldPrice)) && Number(prod.oldPrice) > 0 ? Number(prod.oldPrice) : null;
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
        const del = Utils.getDeliveryCharge(), disc = Utils.calculateDiscount(sub, state.appliedCoupon), tot = sub + del - disc;
        let orig = 0;
        state.cart.forEach(item => {
            const prod = state.products.find(p => p.id === item.id);
            const oldPrice = prod?.oldPrice && isFinite(Number(prod.oldPrice)) && Number(prod.oldPrice) > 0 ? Number(prod.oldPrice) : Number(item.price);
            orig += oldPrice * (item.quantity || 1);
        });
        document.getElementById('originalTotalAmount').textContent = orig;
        document.getElementById('subTotalAmount').textContent = sub;
        const dRow = document.getElementById('discountRow');
        if (dRow) { dRow.style.display = disc > 0 ? 'flex' : 'none'; document.getElementById('discountAmount').textContent = disc; }
        const cLbl = document.getElementById('couponCodeLabel');
        if (cLbl && state.appliedCoupon) cLbl.textContent = state.appliedCoupon.code;
        const sub2 = document.getElementById('subTotalAmount2'); if (sub2) sub2.textContent = sub;
        const del2 = document.getElementById('deliveryChargeAmount2'); if (del2) del2.textContent = del;
        const tot2 = document.getElementById('cartTotalAmount2'); if (tot2) tot2.textContent = tot;
        const dRow2 = document.getElementById('discountRow2');
        if (dRow2) { dRow2.style.display = disc > 0 ? 'flex' : 'none'; document.getElementById('discountAmount2').textContent = disc; }
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
        if (!state.wishlist.length) { cont.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">favorite_border</span><h3>পছন্দ তালিকা খালি</h3></div>`; return; }
        cont.innerHTML = state.wishlist.map(i => {
            const safeTitle = Utils.escapeHtml(i.title), safeImg = Utils.escapeAttr(i.image || CONFIG.FALLBACK_IMAGE), safeId = Utils.escapeAttr(i.id);
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
        const section = document.getElementById('recentlyViewedSection'), cont = document.getElementById('recentlyViewedContainer');
        if (!section || !cont) return;
        const items = state.recentlyViewed.map(id => state.products.find(p => p.id === id)).filter(Boolean).filter(p => p.id !== state.currentDetailId);
        if (!items.length) { section.hidden = true; return; }
        section.hidden = false;
        cont.innerHTML = items.map(p => ProductManager.buildCardHTML(p)).join('');
    }
};

// ===== REVIEW MANAGER (Updated to match schema) =====
const ReviewManager = {
    async getForProduct(pid) {
        const { data, error } = await supabase.from('reviews').select('*').eq('product_id', pid).order('created_at', { ascending: false });
        if (error) { console.error(error); return []; }
        return data || [];
    },
    async add(pid, { name, rating, comment }) {
        const { error } = await supabase.from('reviews').insert({
            product_id: pid,
            customer_name: (name || '').trim() || 'ক্রেতা',
            rating: Math.min(5, Math.max(1, Number(rating) || 5)),
            comment: (comment || '').trim()
        });
        if (error) { Toast.error('রিভিউ জমা দিতে সমস্যা হয়েছে'); console.error(error); }
    },
    async delete(pid, reviewId) {
        const { error } = await supabase.from('reviews').delete().eq('id', reviewId);
        if (error) { Toast.error('ডিলিট করতে সমস্যা'); console.error(error); }
    },
    async getAggregate(pid) {
        const list = await this.getForProduct(pid);
        if (!list.length) return null;
        const avg = list.reduce((s, r) => s + Number(r.rating || 0), 0) / list.length;
        return { avg, count: list.length };
    }
};

// ===== REVIEW UI =====
const ReviewUI = {
    selectedRating: 0,
    async renderList(pid) {
        const cont = document.getElementById('detailReviews'), summaryEl = document.getElementById('reviewSummary');
        if (!cont) return;
        const list = await ReviewManager.getForProduct(pid);
        if (summaryEl) {
            summaryEl.textContent = list.length ? `${(list.reduce((s, r) => s + Number(r.rating || 0), 0) / list.length).toFixed(1)} · ${list.length}টি রিভিউ` : 'এখনো কোনো রিভিউ নেই';
        }
        if (!list.length) { cont.innerHTML = `<p class="review-empty">প্রথম রিভিউটি আপনিই লিখুন</p>`; return; }
        cont.innerHTML = list.map(r => {
            const stars = Array.from({ length: 5 }, (_, i) => `<span class="material-symbols-outlined${i < r.rating ? '' : ' empty'}">star</span>`).join('');
            const dateStr = r.created_at ? new Date(r.created_at).toLocaleDateString('bn-BD') : '';
            return `<div class="review-card">
                <div class="review-card-header">
                    <span class="review-card-name">${Utils.escapeHtml(r.customer_name)}</span>
                    <span class="review-card-stars">${stars}</span>
                </div>
                <p class="review-card-comment">${Utils.escapeHtml(r.comment)}</p>
                <span class="review-card-date">${Utils.escapeHtml(dateStr)}</span>
            </div>`;
        }).join('');
    },
    resetForm() {
        this.selectedRating = 0;
        document.querySelectorAll('#reviewStarPicker .star-pick').forEach(b => b.classList.remove('filled'));
        const nameEl = document.getElementById('reviewNameInput'); if (nameEl) nameEl.value = '';
        const commentEl = document.getElementById('reviewCommentInput'); if (commentEl) commentEl.value = '';
    }
};

// ===== PRODUCT MANAGER =====
const ProductManager = {
    applyFilters(prods) {
        const cat = state.activeCategory, range = state.activePriceRange;
        return prods.filter(p => {
            if (cat && cat !== 'all' && (p.category || '').toLowerCase() !== cat.toLowerCase()) return false;
            const price = isFinite(Number(p.price)) ? Number(p.price) : 0;
            if (range && range !== 'all') {
                if (range === '6000-plus') { if (price < 6000) return false; }
                else { const [min, max] = range.split('-').map(Number); if (!(price >= min && price <= max)) return false; }
            }
            if (state.discountOnly) {
                const oldPrice = isFinite(Number(p.oldPrice)) ? Number(p.oldPrice) : 0;
                if (!(oldPrice > price && oldPrice > 0)) return false;
            }
            if (state.inStockOnly) {
                const stock = p.stock !== undefined ? Number(p.stock) : 9999;
                if (stock <= 0) return false;
            }
            return true;
        });
    },
    sortProducts(prods, sortKey) {
        const list = [...prods];
        switch (sortKey) {
            case 'price-asc': return list.sort((a, b) => Number(a.price) - Number(b.price));
            case 'price-desc': return list.sort((a, b) => Number(b.price) - Number(a.price));
            case 'name-asc': return list.sort((a, b) => a.title.localeCompare(b.title, 'bn'));
            case 'discount': return list.sort((a, b) => { const da = a.oldPrice > a.price ? (1 - a.price / a.oldPrice) : 0; const db = b.oldPrice > b.price ? (1 - b.price / b.oldPrice) : 0; return db - da; });
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
    async buildRatingHTML(id) {
        const agg = await ReviewManager.getAggregate(id);
        const rating = agg ? agg.avg : Utils.pseudoRating(id);
        const count = agg ? agg.count : Utils.pseudoReviewCount(id);
        return `<div class="product-rating"><span class="stars"><span class="material-symbols-outlined">star</span></span>${rating.toFixed(1)} (${count})</div>`;
    },
    async buildCardHTML(p) {
        const cartItem = CartManager.getItem(p.id), qty = cartItem?.quantity || 0, isWish = WishlistManager.isFavorite(p.id);
        const stock = p.stock !== undefined ? Number(p.stock) : 9999, out = stock <= 0, low = !out && stock <= CONFIG.LOW_STOCK_THRESHOLD;
        const price = isFinite(Number(p.price)) ? Number(p.price) : 0, oldPrice = isFinite(Number(p.oldPrice)) ? Number(p.oldPrice) : 0;
        let badge = '', priceHTML = Utils.formatPrice(price);
        if (out) badge = '<span class="stock-badge">স্টক নেই</span>';
        else if (oldPrice > price && oldPrice > 0) { const d = Math.round(100 - (price / oldPrice) * 100); badge = `<span class="discount-badge">-${d}%</span>`; priceHTML = `<span class="old">${Utils.formatPrice(oldPrice)}</span>${priceHTML}`; }
        const lowStockHTML = low ? `<div class="low-stock-note"><span class="material-symbols-outlined">local_fire_department</span>মাত্র ${stock}টি বাকি</div>` : '';
        const btnHTML = out ? this.buildAddButtonHTML(p.id, true) : (qty > 0 ? this.buildQtyControlHTML(p.id, qty) : this.buildAddButtonHTML(p.id, false));
        const ratingHTML = await this.buildRatingHTML(p.id);
        return `<div class="product-card" tabindex="0" role="button" aria-label="${Utils.escapeAttr(p.title)}, বিস্তারিত দেখুন" data-product-id="${Utils.escapeAttr(p.id)}" data-category="${Utils.escapeAttr(p.category || '')}" data-action="open-product-detail">${badge}<button class="wishlist-btn ${isWish ? 'active' : ''}" data-id="${Utils.escapeAttr(p.id)}" data-action="toggle-wishlist" aria-label="পছন্দে যোগ করুন" tabindex="0"><span class="material-symbols-outlined">favorite</span></button><img class="product-image" src="${Utils.escapeAttr(p.image || CONFIG.FALLBACK_IMAGE)}" alt="${Utils.escapeHtml(p.title)}" loading="lazy"><div class="product-name">${Utils.escapeHtml(p.title)}</div>${ratingHTML}<div class="product-price">${priceHTML}</div>${lowStockHTML}${btnHTML}</div>`;
    },
    async render(prods) {
        const cont = document.getElementById('productContainer');
        if (!cont) return;
        const valid = prods.filter(this.isValidProduct);
        const countEl = document.getElementById('resultCount');
        if (countEl) countEl.textContent = valid.length ? `${valid.length}টি প্রোডাক্ট` : '';
        if (!valid.length) { cont.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><span class="material-symbols-outlined">inventory_2</span><h3>কোনো প্রোডাক্ট পাওয়া যায়নি</h3><p>ভিন্ন কিছু খুঁজে দেখুন অথবা ফিল্টার পরিবর্তন করুন</p></div>`; return; }
        const html = await Promise.all(valid.map(p => this.buildCardHTML(p)));
        cont.innerHTML = html.join('');
    },
    renderCategories() {
        const cont = document.getElementById('categoryContainer');
        if (!cont) return;
        const iconMap = { phone: 'smartphone', smartwatch: 'watch', 'power bank': 'battery_charging_full', earbuds: 'earbuds', laptop: 'laptop', tablet: 'tablet', router: 'router', headphone: 'headphones', keyboard: 'keyboard', charger: 'cable', pendrive: 'usb', mouse: 'mouse', all: 'apps' };
        const cats = new Set();
        state.products.forEach(p => { if (p.category) cats.add(p.category.toLowerCase()); });
        let html = `<li><button class="filter-item active" data-category="all"><span class="material-symbols-outlined">${iconMap.all}</span>সকল প্রোডাক্ট</button></li>`;
        Array.from(cats).sort().forEach(c => { const lbl = c.charAt(0).toUpperCase() + c.slice(1); html += `<li><button class="filter-item" data-category="${Utils.escapeAttr(c)}"><span class="material-symbols-outlined">${iconMap[c] || 'category'}</span>${Utils.escapeHtml(lbl)}</button></li>`; });
        cont.innerHTML = html;
    },
    refreshCardButtons() {
        document.querySelectorAll('.product-card').forEach(card => {
            const pid = card.dataset.productId; if (!pid) return;
            const prod = state.products.find(p => p.id === pid), cartItem = CartManager.getItem(pid), qty = cartItem?.quantity || 0;
            const stock = prod?.stock !== undefined ? Number(prod.stock) : 9999, out = stock <= 0;
            const btn = card.querySelector('.main-qty-control, .add-btn');
            if (!btn) return;
            btn.outerHTML = out ? this.buildAddButtonHTML(pid, true) : (qty > 0 ? this.buildQtyControlHTML(pid, qty) : this.buildAddButtonHTML(pid, false));
        });
    },
    async openDetail(pid) {
        const p = state.products.find(p => p.id === pid);
        if (!this.isValidProduct(p)) { Toast.error('প্রোডাক্ট পাওয়া যায়নি'); return; }
        state.currentDetailId = pid;
        const stock = p.stock !== undefined ? Number(p.stock) : 9999, out = stock <= 0, low = !out && stock <= CONFIG.LOW_STOCK_THRESHOLD;
        const price = isFinite(Number(p.price)) ? Number(p.price) : 0, oldPrice = isFinite(Number(p.oldPrice)) ? Number(p.oldPrice) : 0;
        document.getElementById('detailImage').src = p.image || CONFIG.FALLBACK_IMAGE; document.getElementById('detailImage').alt = p.title;
        document.getElementById('detailTitle').textContent = p.title;
        const agg = await ReviewManager.getAggregate(pid);
        const rating = agg ? agg.avg : Utils.pseudoRating(pid); const reviewCount = agg ? agg.count : Utils.pseudoReviewCount(pid);
        const ratingEl = document.getElementById('detailRating');
        if (ratingEl) ratingEl.innerHTML = `<span class="stars"><span class="material-symbols-outlined">star</span></span>${rating.toFixed(1)} · ${reviewCount} রিভিউ`;
        document.getElementById('detailPrice').innerHTML = (oldPrice > price && oldPrice > 0) ? `<span class="old">${Utils.formatPrice(oldPrice)}</span> ${Utils.formatPrice(price)}` : Utils.formatPrice(price);
        const discEl = document.getElementById('detailDiscount');
        if (oldPrice > price && oldPrice > 0) { discEl.textContent = `-${Math.round(100 - (price / oldPrice) * 100)}%`; discEl.classList.add('show'); } else discEl.classList.remove('show');
        const stockEl = document.getElementById('detailStock');
        stockEl.textContent = out ? 'স্টক নেই' : (low ? `মাত্র ${stock}টি বাকি — দ্রুত অর্ডার করুন` : 'স্টকে আছে');
        stockEl.className = 'modal-stock'; stockEl.classList.toggle('out-of-stock', out); stockEl.classList.toggle('in-stock', !out); stockEl.classList.toggle('low-stock', low);
        document.getElementById('detailDesc').textContent = p.description || 'বিবরণ নেই';
        const addBtn = document.getElementById('detailAddBtn'); addBtn.dataset.id = pid; addBtn.disabled = out; addBtn.innerHTML = out ? '<span class="material-symbols-outlined">block</span>স্টক নেই' : '<span class="material-symbols-outlined">add_shopping_cart</span>কার্টে যোগ করুন';
        const wishBtn = document.getElementById('detailWishlistBtn'); wishBtn.dataset.id = pid; const isFav = WishlistManager.isFavorite(pid); wishBtn.classList.toggle('active', isFav);
        state.lastFocusedEl = document.activeElement;
        document.getElementById('productDetailPanel').classList.add('open'); document.getElementById('productDetailOverlay').classList.add('open');
        const body = document.querySelector('.product-detail-body'); if (body) body.scrollTop = 0;
        document.getElementById('closeProductDetail')?.focus();
        RecentManager.add(pid);
        ReviewUI.renderList(pid); ReviewUI.resetForm();
    },
    closeDetail() {
        document.getElementById('productDetailPanel').classList.remove('open'); document.getElementById('productDetailOverlay').classList.remove('open');
        if (state.lastFocusedEl instanceof HTMLElement) state.lastFocusedEl.focus();
    },
    showSkeleton() {
        document.getElementById('productContainer').innerHTML = Array(12).fill(`<div class="product-card skeleton-card"><div class="skeleton shimmer" style="aspect-ratio:1;border-radius:12px;margin-bottom:12px;"></div><div class="skeleton shimmer" style="height:16px;width:80%;border-radius:6px;margin-bottom:8px;"></div><div class="skeleton shimmer" style="height:14px;width:40%;border-radius:6px;margin-bottom:12px;"></div><div class="skeleton shimmer" style="height:38px;border-radius:8px;"></div></div>`).join('');
    }
};

// ===== ORDER MANAGER (Updated to match schema: order_id, total_price) =====
const OrderManager = {
    _realtimeChannel: null,

    load() { return Utils.load(CONFIG.STORAGE_KEYS.ORDERS); },
    save(o) { Utils.save(CONFIG.STORAGE_KEYS.ORDERS, o); },
    
    async fetchOrdersByPhone(phone) {
        if (!phone || phone.length < 11) return [];
        try {
            const { data, error } = await supabase
                .from('orders')
                .select('*')
                .eq('phone', phone)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('Fetch error:', err);
            Toast.error('অর্ডার আনার সময় সমস্যা হয়েছে');
            return [];
        }
    },

    subscribeToOrders(phone, callback) {
        if (this._realtimeChannel) {
            supabase.removeChannel(this._realtimeChannel);
            this._realtimeChannel = null;
        }
        if (!phone || phone.length < 11) return;

        this._realtimeChannel = supabase
            .channel('orders-realtime-update')
            .on('postgres_changes', 
                { 
                    event: 'UPDATE', 
                    schema: 'public', 
                    table: 'orders', 
                    filter: `phone=eq.${phone}` 
                }, 
                (payload) => {
                    const updatedOrder = payload.new;
                    callback(updatedOrder);
                }
            )
            .subscribe();
    },

    async placeOrder(fd) {
        if (state.isProcessing) return;
        state.isProcessing = true;
        const btn = document.getElementById('checkoutBtn');
        if (btn) { btn.classList.add('loading'); btn.disabled = true; }
        try {
            const sub = CartManager.getSubtotal(), del = Utils.getDeliveryCharge(), disc = Utils.calculateDiscount(sub, state.appliedCoupon), tot = sub + del - disc;
            const oid = state.editingOrderId || Utils.generateOrderId();
            const orderData = {
                order_id: oid,
                customer_name: fd.name,
                phone: fd.phone,
                address: fd.address,
                items: state.cart.map(i => ({ id: i.id, title: i.title, quantity: i.quantity, price: i.price })),
                total_price: tot,
                status: 'Pending'
            };
            const { error } = await supabase.from('orders').insert(orderData);
            if (error) throw error;

            if (fd.remember) { Utils.save(CONFIG.STORAGE_KEYS.SAVED_INFO, { name: fd.name, address: fd.address, phone: fd.phone }); } 
            else { Utils.save(CONFIG.STORAGE_KEYS.SAVED_INFO, null); }

            const hist = this.load().filter(o => o.orderId !== oid);
            hist.unshift({ orderId: oid, date: new Date().toLocaleString('bn-BD', { hour12: true }), items: state.cart.map(i => `${i.title} (${i.quantity}টি)`).join(', '), rawItems: JSON.parse(JSON.stringify(state.cart)), subTotal: sub, deliveryCharge: del, total: tot, status: 'Pending', customerInfo: { name: fd.name, address: fd.address, phone: fd.phone } });
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
        if (!keepSaved) { ['custName', 'custAddress', 'custPhone', 'custNote'].forEach(id => { const el = document.getElementById(id); if (el) { el.value = ''; el.classList.remove('field-invalid'); } }); }
        const coupon = document.getElementById('couponInput'); if (coupon) coupon.value = '';
        document.getElementById('phoneError').style.display = 'none';
        Utils.resetCartSlider();
    },

    prefillSavedInfo() {
        const saved = Utils.load(CONFIG.STORAGE_KEYS.SAVED_INFO, null);
        if (!saved) return;
        const nameEl = document.getElementById('custName'), addrEl = document.getElementById('custAddress'), phoneEl = document.getElementById('custPhone'), rememberEl = document.getElementById('rememberInfo');
        if (nameEl && !nameEl.value) nameEl.value = saved.name || '';
        if (addrEl && !addrEl.value) addrEl.value = saved.address || '';
        if (phoneEl && !phoneEl.value) phoneEl.value = saved.phone || '';
        if (rememberEl) rememberEl.checked = true;
    },

    async renderHistory(phone = null) {
        const cont = document.getElementById('orderHistoryContainer');
        if (!cont) return;

        if (!phone) {
            const saved = Utils.load(CONFIG.STORAGE_KEYS.SAVED_INFO, null);
            phone = saved?.phone || '';
            document.getElementById('historyPhoneInput').value = phone;
        }

        if (!phone || phone.length < 11) {
            cont.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-outlined">phone_android</span>
                    <h3>অর্ডার দেখতে মোবাইল নম্বর দিন</h3>
                    <p style="font-size:13px; color:var(--text-faint);">উপরের বক্সে আপনার মোবাইল নম্বর লিখে "হালনাগাদ করুন" বাটনে চাপুন।</p>
                </div>`;
            return;
        }

        const data = await this.fetchOrdersByPhone(phone);
        Utils.save(CONFIG.STORAGE_KEYS.ORDERS, data);

        if (!data.length) {
            cont.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">history</span><h3>এই নম্বরে কোনো অর্ডার পাওয়া যায়নি</h3></div>`;
            return;
        }

        const statusConfig = { Pending: { cls: 'pending', icon: 'schedule', label: 'পেন্ডিং' }, Processing: { cls: 'processing', icon: 'autorenew', label: 'প্রসেসিং' }, Delivered: { cls: 'delivered', icon: 'task_alt', label: 'ডেলিভার্ড' }, Cancelled: { cls: 'cancelled', icon: 'cancel', label: 'বাতিল' } };
        
        cont.innerHTML = data.map(o => {
            const st = o.status || 'Pending', cfg = statusConfig[st] || statusConfig.Pending;
            let itemsText = '';
            try {
                const items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
                itemsText = items.map(i => `${i.title} (${i.quantity}টি)`).join(', ');
            } catch { itemsText = 'প্রোডাক্ট দেখা যাচ্ছে না'; }

            return `<div class="order-history-card">
                <div class="order-card-header">
                    <span class="order-card-id"><span class="material-symbols-outlined">local_shipping</span>${Utils.escapeHtml(o.order_id)}</span>
                    <span class="status-badge ${cfg.cls}"><span class="material-symbols-outlined">${cfg.icon}</span>${cfg.label}</span>
                </div>
                <div class="order-card-date">${Utils.escapeHtml(o.created_at ? new Date(o.created_at).toLocaleString('bn-BD', { hour12: true }) : '')}</div>
                <div class="order-card-products">${Utils.escapeHtml(itemsText)}</div>
                <div class="order-card-customer"><strong>${Utils.escapeHtml(o.customer_name || '')}</strong> · ${Utils.escapeHtml(o.phone || '')}</div>
                ${o.address ? `<div class="order-card-customer">${Utils.escapeHtml(o.address)}</div>` : ''}
                <div class="order-card-footer">
                    <div class="order-card-total">${Utils.formatPrice(o.total_price)}</div>
                </div>
            </div>`;
        }).join('');

        this.subscribeToOrders(phone, (updatedOrder) => {
            const existingCards = cont.querySelectorAll('.order-history-card');
            let found = false;
            existingCards.forEach(card => {
                const idSpan = card.querySelector('.order-card-id');
                if (idSpan && idSpan.textContent.trim() === updatedOrder.order_id) {
                    const badge = card.querySelector('.status-badge');
                    const cfg = statusConfig[updatedOrder.status] || statusConfig.Pending;
                    if (badge) {
                        badge.className = `status-badge ${cfg.cls}`;
                        badge.innerHTML = `<span class="material-symbols-outlined">${cfg.icon}</span>${cfg.label}`;
                    }
                    found = true;
                }
            });
            if (!found) {
                this.subscribeToOrders(null, () => {});
                this.renderHistory(phone);
            }
        });
    },

    editOrder(oid) {
        const hist = this.load(), o = hist.find(o => o.orderId === oid);
        if (!o || o.status !== 'Pending') { Toast.error('পরিবর্তন করা যাবে না'); return; }
        state.cart = o.rawItems?.map(i => ({ ...i })) || [];
        CartManager.save();
        if (o.customerInfo) { document.getElementById('custName').value = o.customerInfo.name || ''; document.getElementById('custAddress').value = o.customerInfo.address || ''; document.getElementById('custPhone').value = o.customerInfo.phone || ''; }
        state.editingOrderId = oid; Modal.hideAll(); Utils.openCart(); document.getElementById('cartSliderWrapper').style.transform = 'translateX(-50%)'; Toast.info('কার্ট লোড হয়েছে, তথ্য যাচাই করে আবার নিশ্চিত করুন');
    },
    async cancelOrder(oid) {
        const hist = this.load(), o = hist.find(o => o.orderId === oid);
        if (!o || o.status !== 'Pending') { Toast.error('বাতিল করা যাবে না'); return; }
        o.status = 'Cancelled'; 
        this.save(hist); Toast.info('অর্ডার বাতিল'); this.renderHistory();
        await supabase.from('orders').update({ status: 'Cancelled' }).eq('order_id', oid);
    },
    async deleteOrder(oid) {
        let hist = this.load(); const o = hist.find(o => o.orderId === oid);
        if (!o || !['Delivered', 'Cancelled'].includes(o.status)) { Toast.error('ডিলিট করা যাবে না'); return; }
        hist = hist.filter(o => o.orderId !== oid); this.save(hist); Toast.success('অর্ডার ডিলিট'); this.renderHistory();
    }
};

// ===== SEARCH =====
const Search = {
    activeIndex: -1, results: [],
    init() {
        const input = document.getElementById('productSearch'), dropdown = document.getElementById('searchResults'), clearBtn = document.getElementById('clearSearchBtn');
        if (!input || !dropdown) return;
        const runSearch = Utils.debounce((val) => { if (!val) { this.close(); return; } this.results = state.products.filter(p => p.title.toLowerCase().includes(val)); this.activeIndex = -1; this.renderResults(this.results); }, 150);
        input.addEventListener('input', (e) => { const val = e.target.value.toLowerCase().trim(); if (clearBtn) clearBtn.hidden = !e.target.value; if (!val) { this.close(); return; } runSearch(val); });
        input.addEventListener('keydown', (e) => {
            if (!dropdown.classList.contains('active')) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
            else if (e.key === 'Enter') { e.preventDefault(); this.selectActive(input, dropdown); }
            else if (e.key === 'Escape') { this.close(); }
        });
        clearBtn?.addEventListener('click', () => { input.value = ''; clearBtn.hidden = true; this.close(); input.focus(); });
        dropdown.addEventListener('click', (e) => { const item = e.target.closest('[data-action="open-product-detail"]'); if (item?.dataset.id) { ProductManager.openDetail(item.dataset.id); this.close(); input.value = ''; if (clearBtn) clearBtn.hidden = true; } });
        document.addEventListener('click', (e) => { if (!e.target.closest('.header-search')) this.close(); });
    },
    move(delta) { if (!this.results.length) return; this.activeIndex = (this.activeIndex + delta + this.results.length) % this.results.length; this.highlight(); },
    highlight() { const items = document.querySelectorAll('#searchResults .search-result-item'); items.forEach((el, i) => el.classList.toggle('active', i === this.activeIndex)); items[this.activeIndex]?.scrollIntoView({ block: 'nearest' }); },
    selectActive(input, dropdown) { const target = this.results[this.activeIndex] || this.results[0]; if (target) { ProductManager.openDetail(target.id); this.close(); input.value = ''; document.getElementById('clearSearchBtn').hidden = true; } },
    close() { const dropdown = document.getElementById('searchResults'), input = document.getElementById('productSearch'); dropdown?.classList.remove('active'); input?.setAttribute('aria-expanded', 'false'); this.activeIndex = -1; },
    renderResults(prods) {
        const dropdown = document.getElementById('searchResults'), input = document.getElementById('productSearch');
        if (!prods.length) { dropdown.innerHTML = `<div class="search-result-item" style="justify-content:center;color:var(--text-faint);cursor:default;">কোনো ফলাফল নেই</div>`; dropdown.classList.add('active'); input?.setAttribute('aria-expanded', 'true'); return; }
        dropdown.innerHTML = prods.slice(0, 8).map(p => `<div class="search-result-item" data-action="open-product-detail" data-id="${Utils.escapeAttr(p.id)}" role="option"><img class="search-result-img" src="${Utils.escapeAttr(p.image || CONFIG.FALLBACK_IMAGE)}" alt=""><div class="search-result-info"><div class="search-result-title">${Utils.escapeHtml(p.title)}</div><div class="search-result-price">${Utils.formatPrice(p.price)}</div></div></div>`).join('');
        dropdown.classList.add('active'); input?.setAttribute('aria-expanded', 'true');
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
            if (action === 'open-product-detail') { const card = actionEl.closest('.product-card'); if (card?.dataset.productId) ProductManager.openDetail(card.dataset.productId); return; }
            const handler = this.handlers[action];
            if (handler && id) { e.stopPropagation(); handler(id); }
        });
        container.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.closest('.product-card[data-action="open-product-detail"]');
            if (!card || e.target !== card) return; e.preventDefault(); if (card.dataset.productId) ProductManager.openDetail(card.dataset.productId);
        });
    }
};

function attachImageFallback(root) {
    root.addEventListener('error', (e) => { const img = e.target; if (img.tagName !== 'IMG' || img.dataset.fallbackApplied) return; img.dataset.fallbackApplied = 'true'; img.src = img.classList.contains('logo-img') ? CONFIG.FALLBACK_LOGO : CONFIG.FALLBACK_IMAGE; }, true);
}

async function refreshProductView() {
    const filtered = ProductManager.applyFilters(state.products);
    const sorted = ProductManager.sortProducts(filtered, state.activeSort);
    await ProductManager.render(sorted);
}

// ===== EVENTS =====
function initEvents() {
    attachImageFallback(document.body);
    ['productContainer', 'recentlyViewedContainer', 'cartItems', 'wishlistItems', 'orderHistoryContainer'].forEach(id => { const el = document.getElementById(id); if (el) ActionRouter.attach(el); });
    document.getElementById('cartBtn')?.addEventListener('click', Utils.openCart); document.getElementById('mobileCartBtn')?.addEventListener('click', Utils.openCart);
    document.getElementById('closeCart')?.addEventListener('click', Utils.closeCart); document.getElementById('cartOverlay')?.addEventListener('click', Utils.closeCart);
    document.getElementById('closeProductDetail')?.addEventListener('click', ProductManager.closeDetail); document.getElementById('productDetailOverlay')?.addEventListener('click', ProductManager.closeDetail);
    document.getElementById('detailAddBtn')?.addEventListener('click', function() { if (this.disabled) return; CartManager.add(this.dataset.id); ProductManager.closeDetail(); });
    document.getElementById('detailWishlistBtn')?.addEventListener('click', function() { if (this.dataset.id) { WishlistManager.toggle(this.dataset.id); } });
    document.getElementById('goToCheckoutBtn')?.addEventListener('click', () => { if (!state.cart.length) Modal.show('emptyCartModal'); else { CartManager.renderSidebar(); document.getElementById('cartSliderWrapper').style.transform = 'translateX(-50%)'; OrderManager.prefillSavedInfo(); } });
    document.getElementById('backToCartBtn')?.addEventListener('click', Utils.resetCartSlider); document.getElementById('deliveryArea')?.addEventListener('change', () => CartManager.renderSidebar());
    document.getElementById('applyCouponBtn')?.addEventListener('click', () => {
        const code = document.getElementById('couponInput').value.trim().toUpperCase();
        if (!code) { Toast.error('একটি কুপন কোড লিখুন'); return; }
        if (CONFIG.COUPONS[code]) { state.appliedCoupon = { code, ...CONFIG.COUPONS[code] }; Toast.success(`"${code}" কুপন প্রয়োগ!`); }
        else { state.appliedCoupon = null; Toast.error('কুপন কোড সঠিক নয়'); }
        CartManager.renderSidebar();
    });
    document.getElementById('couponInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('applyCouponBtn')?.click(); } });
    document.getElementById('wishlistBtn')?.addEventListener('click', () => { WishlistManager.renderModal(); Modal.show('wishlistModal'); });
    document.getElementById('mobileWishlistBtn')?.addEventListener('click', () => { WishlistManager.renderModal(); Modal.show('wishlistModal'); });
    document.getElementById('closeWishlistModal')?.addEventListener('click', () => Modal.hide('wishlistModal'));
    
    // ✅ ঠিক করা হিস্ট্রি ইভেন্ট (মডাল ওপেন করার লাইন যুক্ত করা হয়েছে)
    document.getElementById('historyBtn')?.addEventListener('click', () => {
        const saved = Utils.load(CONFIG.STORAGE_KEYS.SAVED_INFO, null);
        if (saved?.phone) document.getElementById('historyPhoneInput').value = saved.phone;
        Modal.show('orderHistoryModal');   // ✅ মডাল ওপেন করা
        OrderManager.renderHistory();
    });
    document.getElementById('mobileHistoryBtn')?.addEventListener('click', () => {
        const saved = Utils.load(CONFIG.STORAGE_KEYS.SAVED_INFO, null);
        if (saved?.phone) document.getElementById('historyPhoneInput').value = saved.phone;
        Modal.show('orderHistoryModal');   // ✅ মডাল ওপেন করা
        OrderManager.renderHistory();
    });
    document.getElementById('fetchOrderBtn')?.addEventListener('click', () => {
        const phone = document.getElementById('historyPhoneInput').value.trim();
        if (!Utils.isValidPhone(phone)) {
            Toast.error('সঠিক ১১ ডিজিটের মোবাইল নম্বর দিন');
            return;
        }
        OrderManager.renderHistory(phone);
    });
    document.getElementById('closeOrderHistoryModal')?.addEventListener('click', () => {
        if (OrderManager._realtimeChannel) {
            supabase.removeChannel(OrderManager._realtimeChannel);
            OrderManager._realtimeChannel = null;
        }
        Modal.hide('orderHistoryModal');
    });

    document.getElementById('checkoutBtn')?.addEventListener('click', async (e) => {
        e.preventDefault(); if (state.isProcessing) return; if (!state.cart.length) { Modal.show('emptyCartModal'); return; }
        const nameEl = document.getElementById('custName'), addressEl = document.getElementById('custAddress'), phoneEl = document.getElementById('custPhone'), noteEl = document.getElementById('custNote'), rememberEl = document.getElementById('rememberInfo');
        const name = nameEl.value.trim(), address = addressEl.value.trim(), phone = phoneEl.value.trim(), note = noteEl.value.trim(), remember = !!rememberEl?.checked;
        const requiredFields = [{ el: nameEl, value: name }, { el: addressEl, value: address }, { el: phoneEl, value: phone }];
        const missing = requiredFields.filter(f => !f.value); requiredFields.forEach(f => f.el.classList.toggle('field-invalid', !f.value));
        if (missing.length) { Toast.error('নাম, ঠিকানা ও মোবাইল নম্বর পূরণ করুন'); missing[0].el.focus(); return; }
        if (!Utils.isValidPhone(phone)) { phoneEl.classList.add('field-invalid'); document.getElementById('phoneError').style.display = 'block'; phoneEl.focus(); return; }
        document.getElementById('phoneError').style.display = 'none';
        await OrderManager.placeOrder({ name, address, phone, note, remember });
    });
    ['custName', 'custAddress', 'custPhone'].forEach(id => { document.getElementById(id)?.addEventListener('input', function() { this.classList.remove('field-invalid'); if (id === 'custPhone') document.getElementById('phoneError').style.display = 'none'; }); });
    document.getElementById('closeSuccessBtn')?.addEventListener('click', () => Modal.hide('orderSuccessModal')); document.getElementById('closeEmptyCartBtn')?.addEventListener('click', () => Modal.hide('emptyCartModal'));
    document.getElementById('categoryContainer')?.addEventListener('click', (e) => { const btn = e.target.closest('.filter-item'); if (!btn || !btn.dataset.category) return; document.querySelectorAll('#categoryContainer .filter-item').forEach(b => b.classList.remove('active')); btn.classList.add('active'); state.activeCategory = btn.dataset.category; refreshProductView(); });
    document.getElementById('priceFilterContainer')?.addEventListener('click', (e) => { const btn = e.target.closest('.filter-item'); if (!btn || !btn.dataset.range) return; document.querySelectorAll('#priceFilterContainer .filter-item').forEach(b => b.classList.remove('active')); btn.classList.add('active'); state.activePriceRange = btn.dataset.range; refreshProductView(); });
    document.getElementById('discountOnlyCheck')?.addEventListener('change', (e) => { state.discountOnly = e.target.checked; refreshProductView(); });
    document.getElementById('inStockOnlyCheck')?.addEventListener('change', (e) => { state.inStockOnly = e.target.checked; refreshProductView(); });
    document.getElementById('sortSelect')?.addEventListener('change', (e) => { state.activeSort = e.target.value; refreshProductView(); });
    document.getElementById('resetFiltersBtn')?.addEventListener('click', () => FilterPanel.reset()); document.getElementById('openFiltersBtn')?.addEventListener('click', FilterPanel.open); document.getElementById('navCategoryBtn')?.addEventListener('click', FilterPanel.open);
    
    document.getElementById('reviewStarPicker')?.addEventListener('click', (e) => { const btn = e.target.closest('.star-pick'); if (!btn) return; const val = Number(btn.dataset.value); ReviewUI.selectedRating = val; document.querySelectorAll('#reviewStarPicker .star-pick').forEach(b => { b.classList.toggle('filled', Number(b.dataset.value) <= val); }); });
    document.getElementById('reviewForm')?.addEventListener('submit', async (e) => { e.preventDefault(); const pid = state.currentDetailId; if (!pid) return; const nameEl = document.getElementById('reviewNameInput'), commentEl = document.getElementById('reviewCommentInput'); const comment = commentEl.value.trim(); if (!ReviewUI.selectedRating) { Toast.error('রেটিং দিন'); return; } if (!comment) { Toast.error('মন্তব্য লিখুন'); commentEl.focus(); return; } await ReviewManager.add(pid, { name: nameEl.value, rating: ReviewUI.selectedRating, comment }); ReviewUI.resetForm(); await ReviewUI.renderList(pid); refreshProductView(); RecentManager.render(); Toast.success('রিভিউর জন্য ধন্যবাদ!'); });
    
    document.getElementById('closeFiltersBtn')?.addEventListener('click', FilterPanel.close); document.getElementById('filterOverlay')?.addEventListener('click', FilterPanel.close);
    window.addEventListener('scroll', () => { const btn = document.getElementById('backToTopBtn'); if (!btn) return; btn.classList.toggle('show', window.scrollY > CONFIG.SCROLL_THRESHOLD); }, { passive: true });
    document.getElementById('backToTopBtn')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' })); document.getElementById('navHomeBtn')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { Modal.hideAll(); Utils.closeCart(); ProductManager.closeDetail(); Search.close(); FilterPanel.close(); } });
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', (e) => { if (e.target === m) { m.classList.remove('active'); } }));
}

// ===== FILTER PANEL =====
const FilterPanel = {
    open() { document.getElementById('filterPanel')?.classList.add('open'); document.getElementById('filterOverlay')?.classList.add('open'); },
    close() { document.getElementById('filterPanel')?.classList.remove('open'); document.getElementById('filterOverlay')?.classList.remove('open'); },
    reset() {
        state.activeCategory = 'all'; state.activePriceRange = 'all'; state.discountOnly = false; state.inStockOnly = false; state.activeSort = 'default';
        document.querySelectorAll('#categoryContainer .filter-item').forEach((b, i) => b.classList.toggle('active', i === 0));
        document.querySelectorAll('#priceFilterContainer .filter-item').forEach((b, i) => b.classList.toggle('active', i === 0));
        const discEl = document.getElementById('discountOnlyCheck'); if (discEl) discEl.checked = false;
        const stockEl = document.getElementById('inStockOnlyCheck'); if (stockEl) stockEl.checked = false;
        const sortEl = document.getElementById('sortSelect'); if (sortEl) sortEl.value = 'default';
        refreshProductView();
    }
};

// ===== INIT =====
async function init() {
    CartManager.load(); WishlistManager.load(); RecentManager.load();
    ProductManager.showSkeleton();
    Search.init(); initEvents();
    try {
        state.products = await fetchProducts();
        ProductManager.renderCategories();
        await refreshProductView();
        RecentManager.render();
        WishlistManager.updateUI();
        CartManager.updateUI();
    } catch (e) { console.error(e); document.getElementById('productContainer').innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><span class="material-symbols-outlined">error</span><h3>ডাটা লোডে সমস্যা</h3><p>ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন</p></div>`; }
    const loader = document.getElementById('pageLoader');
    if (loader) { loader.style.opacity = '0'; setTimeout(() => { loader.style.display = 'none'; }, 400); }
}
document.addEventListener('DOMContentLoaded', init);