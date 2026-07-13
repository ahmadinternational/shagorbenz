// ============================================================
// main.js — SHAGORBENZ Premium E-Commerce
// Full product page panel, delivery moved, centered icons, history info
// ============================================================

import { fetchProducts } from './products.js';

// ===== CONFIGURATION =====
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
        PLAYER_ID: 'oneSignalPlayerId'
    },
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwbzm5xrmSdDVkgT8hNoEgYCR61Dztmam8bDjZ8o-6EL_tBW7r_AOKp62mGpCfinzEm/exec',
    SLIDER_INTERVAL: 3500,
    SCROLL_THRESHOLD: 300,
    DEFAULT_DELIVERY_CHARGE: 60,
    PHONE_REGEX: /^01[3-9]\d{8}$/,
    FALLBACK_IMAGE: 'https://via.placeholder.com/250',
    FALLBACK_LOGO: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2242%22 height=%2242%22 viewBox=%220 0 42 42%22%3E%3Crect width=%2242%22 height=%2242%22 fill=%22%23000%22 rx=%228%22/%3E%3Ctext x=%2250%25%22 y=%2255%25%22 font-size=%2220%22 font-weight=%22900%22 text-anchor=%22middle%22 fill=%22%23fff%22 font-family=%22sans-serif%22%3ESB%3C/text%3E%3C/svg%3E'
};

// ===== STATE =====
const state = {
    cart: [],
    wishlist: [],
    products: [],
    activeCategory: 'all',
    currentSlide: 0,
    slideInterval: null,
    appliedCoupon: null,
    editingOrderId: null,
    isProcessing: false
};

// ===== UTILITIES =====
const Utils = {
    load(key) {
        try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
    },
    save(key, data) {
        try { localStorage.setItem(key, JSON.stringify(data)); } catch (error) {
            console.error(`Failed to persist "${key}" to storage:`, error);
        }
    },
    isValidPhone(phone) {
        return CONFIG.PHONE_REGEX.test(phone.trim());
    },
    generateOrderId() {
        const date = new Date().toISOString().slice(2, 10).replace(/-/g, '');
        const random = Math.floor(1000 + Math.random() * 9000);
        return `SB-${date}-${random}`;
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
        const select = document.getElementById('deliveryArea');
        return select?.selectedOptions[0]?.dataset?.charge
            ? parseInt(select.selectedOptions[0].dataset.charge, 10)
            : CONFIG.DEFAULT_DELIVERY_CHARGE;
    },
    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },
    escapeAttr(str) {
        return this.escapeHtml(str);
    },
    resetCartSlider() {
        const wrapper = document.getElementById('cartSliderWrapper');
        if (wrapper) wrapper.style.transform = 'translateX(0)';
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
    }
};

// ===== TOAST =====
const Toast = {
    show(msg, icon = 'check_circle', duration = 2200) {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `
            <span class="material-symbols-outlined">${Utils.escapeHtml(icon)}</span>
            <span>${Utils.escapeHtml(msg)}</span>
        `;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(8px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },
    success(msg) { this.show(msg, 'check_circle'); },
    error(msg) { this.show(msg, 'error'); },
    info(msg) { this.show(msg, 'info'); }
};

// ===== MODAL =====
const Modal = {
    show(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    },
    hide(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    },
    hideAll() {
        document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
    }
};

// ===== CART MANAGER =====
const CartManager = {
    load() {
        state.cart = Utils.load(CONFIG.STORAGE_KEYS.CART);
    },
    save() {
        Utils.save(CONFIG.STORAGE_KEYS.CART, state.cart);
        this.updateUI();
    },
    getItem(productId) {
        return state.cart.find(item => item.id === productId);
    },
    getTotalItems() {
        return state.cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
    },
    getSubtotal() {
        return state.cart.reduce((sum, item) =>
            sum + Number(item.price) * (item.quantity || 1), 0
        );
    },
    getStock(productId) {
        const product = state.products.find(p => p.id === productId);
        return product?.stock !== undefined ? Number(product.stock) : 9999;
    },
    add(productId) {
        const product = state.products.find(p => p.id === productId);
        if (!product) {
            Toast.error('প্রোডাক্ট পাওয়া যায়নি');
            return false;
        }
        const stock = this.getStock(productId);
        if (stock <= 0) {
            Toast.error('স্টক নেই');
            return false;
        }
        const existing = this.getItem(productId);
        if (existing) {
            if (existing.quantity >= stock) {
                Toast.error('সর্বোচ্চ স্টক সীমা পার হয়ে গেছে');
                return false;
            }
            existing.quantity += 1;
        } else {
            state.cart.push({
                id: product.id,
                title: product.title,
                price: product.price,
                image: product.image,
                quantity: 1
            });
            Toast.success('কার্টে যোগ হয়েছে');
        }
        this.save();
        return true;
    },
    remove(productId) {
        state.cart = state.cart.filter(item => item.id !== productId);
        this.save();
        Toast.info('কার্ট থেকে সরানো হয়েছে', 'delete');
    },
    changeQuantity(productId, delta) {
        const existing = this.getItem(productId);
        if (!existing) {
            if (delta > 0) this.add(productId);
            return;
        }
        const newQty = existing.quantity + delta;
        if (newQty <= 0) {
            this.remove(productId);
            return;
        }
        const stock = this.getStock(productId);
        if (delta > 0 && newQty > stock) {
            Toast.error('সর্বোচ্চ স্টক সীমা পার হয়ে গেছে');
            return;
        }
        existing.quantity = newQty;
        this.save();
    },
    clear() {
        state.cart = [];
        state.appliedCoupon = null;
        this.save();
    },
    updateUI() {
        const count = this.getTotalItems();
        Utils.setBadge(document.getElementById('cartCount'), count);
        Utils.setBadge(document.getElementById('mobileCartCount'), count);
        this.renderSidebar();
        ProductManager.refreshCardButtons();
    },
    renderSidebar() {
        const container = document.getElementById('cartItems');
        if (!container) return;
        if (!state.cart.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-outlined">shopping_bag</span>
                    <h3>কার্ট খালি</h3>
                </div>
            `;
            this.updateTotals(0);
            return;
        }
        const subtotal = this.getSubtotal();
        container.innerHTML = state.cart.map(item => {
            const total = Number(item.price) * (item.quantity || 1);
            const safeTitle = Utils.escapeHtml(item.title);
            const safeImage = Utils.escapeAttr(item.image || CONFIG.FALLBACK_IMAGE);
            const safeId = Utils.escapeAttr(item.id);
            return `
                <div class="cart-item">
                    <img src="${safeImage}" alt="${safeTitle}">
                    <div class="cart-item-details">
                        <div class="cart-item-title">${safeTitle}</div>
                        <div class="cart-item-price">${Utils.formatPrice(item.price)}</div>
                        <div class="cart-item-controls">
                            <button class="cart-qty-btn" data-action="decrease-qty" data-id="${safeId}" aria-label="কমান">
                                <span class="material-symbols-outlined">remove</span>
                            </button>
                            <span class="cart-qty-display">${item.quantity}</span>
                            <button class="cart-qty-btn" data-action="increase-qty" data-id="${safeId}" aria-label="বাড়ান">
                                <span class="material-symbols-outlined">add</span>
                            </button>
                        </div>
                    </div>
                    <div class="cart-item-right">
                        <strong class="cart-item-total">${Utils.formatPrice(total)}</strong>
                        <button class="cart-remove-btn" data-action="cart-remove" data-id="${safeId}" aria-label="মুছে ফেলুন">
                            <span class="material-symbols-outlined">delete</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        this.updateTotals(subtotal);
    },
    updateTotals(subtotal) {
        const delivery = Utils.getDeliveryCharge();
        const discount = Utils.calculateDiscount(subtotal, state.appliedCoupon);
        const total = subtotal + delivery - discount;
        document.getElementById('subTotalAmount').textContent = subtotal;
        document.getElementById('deliveryChargeAmount').textContent = delivery;
        document.getElementById('cartTotalAmount').textContent = total;
        const discountRow = document.getElementById('discountRow');
        if (discountRow) {
            discountRow.style.display = discount > 0 ? 'flex' : 'none';
            document.getElementById('discountAmount').textContent = discount;
        }
        const couponLabel = document.getElementById('couponCodeLabel');
        if (couponLabel && state.appliedCoupon) {
            couponLabel.textContent = state.appliedCoupon.code;
        }
    }
};

// ===== WISHLIST MANAGER =====
const WishlistManager = {
    load() {
        state.wishlist = Utils.load(CONFIG.STORAGE_KEYS.WISHLIST);
    },
    save() {
        Utils.save(CONFIG.STORAGE_KEYS.WISHLIST, state.wishlist);
        this.updateUI();
    },
    toggle(productId) {
        const product = state.products.find(p => p.id === productId);
        if (!product) return;
        const index = state.wishlist.findIndex(item => item.id === productId);
        if (index > -1) {
            state.wishlist.splice(index, 1);
            Toast.info('পছন্দ থেকে সরানো হয়েছে', 'heart_broken');
        } else {
            state.wishlist.push({ id: product.id, title: product.title, price: product.price, image: product.image });
            Toast.success('পছন্দে যোগ হয়েছে', 'favorite');
        }
        this.save();
    },
    isFavorite(productId) {
        return state.wishlist.some(item => item.id === productId);
    },
    addToCart(productId) {
        CartManager.add(productId);
        this.remove(productId);
    },
    remove(productId) {
        state.wishlist = state.wishlist.filter(item => item.id !== productId);
        this.save();
    },
    updateUI() {
        Utils.setBadge(document.getElementById('wishlistCount'), state.wishlist.length);
        document.querySelectorAll('.wishlist-btn').forEach(btn => {
            btn.classList.toggle('active', this.isFavorite(btn.dataset.id));
        });
        this.renderModal();
    },
    renderModal() {
        const container = document.getElementById('wishlistItems');
        if (!container) return;
        if (!state.wishlist.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-outlined">favorite_border</span>
                    <h3>পছন্দ তালিকা খালি</h3>
                </div>
            `;
            return;
        }
        container.innerHTML = state.wishlist.map(item => {
            const safeTitle = Utils.escapeHtml(item.title);
            const safeImage = Utils.escapeAttr(item.image || CONFIG.FALLBACK_IMAGE);
            const safeId = Utils.escapeAttr(item.id);
            return `
                <div class="wishlist-item">
                    <img src="${safeImage}" alt="${safeTitle}">
                    <div class="wishlist-item-details">
                        <div class="wishlist-item-title">${safeTitle}</div>
                        <div class="wishlist-item-price">${Utils.formatPrice(item.price)}</div>
                    </div>
                    <button class="wishlist-cart-btn" data-action="wishlist-to-cart" data-id="${safeId}" aria-label="কার্টে যোগ করুন">
                        <span class="material-symbols-outlined">add_shopping_cart</span>
                    </button>
                    <button class="wishlist-remove-btn" data-action="wishlist-remove" data-id="${safeId}" aria-label="সরিয়ে ফেলুন">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
            `;
        }).join('');
    }
};

// ===== PRODUCT MANAGER =====
const ProductManager = {
    filterByCategory(products, category) {
        if (!category || category === 'all') return products;
        return products.filter(p =>
            (p.category || '').toLowerCase() === category.toLowerCase()
        );
    },
    isValidProduct(product) {
        return Boolean(product && product.id && product.title);
    },
    buildQtyControlHTML(productId, qty) {
        const safeId = Utils.escapeAttr(productId);
        return `
            <div class="main-qty-control">
                <button data-action="decrease-qty" data-id="${safeId}" aria-label="কমান">
                    <span class="material-symbols-outlined">remove</span>
                </button>
                <span>${qty}</span>
                <button data-action="increase-qty" data-id="${safeId}" aria-label="বাড়ান">
                    <span class="material-symbols-outlined">add</span>
                </button>
            </div>
        `;
    },
    buildAddButtonHTML(productId, outOfStock) {
        const safeId = Utils.escapeAttr(productId);
        if (outOfStock) return '<button class="add-btn" disabled>স্টক নেই</button>';
        return `<button class="add-btn" data-action="add-to-cart" data-id="${safeId}">কার্টে যোগ করুন</button>`;
    },
    render(products) {
        const container = document.getElementById('productContainer');
        if (!container) return;

        const validProducts = products.filter(this.isValidProduct);

        if (!validProducts.length) {
            container.innerHTML = `
                <div class="empty-state" style="grid-column:1/-1;">
                    <span class="material-symbols-outlined">inventory_2</span>
                    <h3>কোনো প্রোডাক্ট পাওয়া যায়নি</h3>
                </div>
            `;
            return;
        }

        container.innerHTML = validProducts.map(product => {
            const cartItem = CartManager.getItem(product.id);
            const qty = cartItem?.quantity || 0;
            const isWish = WishlistManager.isFavorite(product.id);
            const stock = product.stock !== undefined ? Number(product.stock) : 9999;
            const price = Number.isFinite(Number(product.price)) ? Number(product.price) : 0;
            const oldPrice = Number.isFinite(Number(product.oldPrice)) ? Number(product.oldPrice) : 0;
            const outOfStock = stock <= 0;
            const safeId = Utils.escapeAttr(product.id);
            const safeTitle = Utils.escapeHtml(product.title);
            const safeImage = Utils.escapeAttr(product.image || CONFIG.FALLBACK_IMAGE);
            const safeCategory = Utils.escapeAttr(product.category || '');

            let badge = '';
            if (outOfStock) {
                badge = '<span class="stock-badge">স্টক নেই</span>';
            } else if (oldPrice > price && oldPrice > 0) {
                const disc = Math.round(100 - (price / oldPrice) * 100);
                badge = `<span class="discount-badge">-${disc}%</span>`;
            }

            let priceHTML = Utils.formatPrice(price);
            if (oldPrice > price && oldPrice > 0) {
                priceHTML = `<span class="old">${Utils.formatPrice(oldPrice)}</span>${priceHTML}`;
            }

            const buttonHTML = outOfStock
                ? this.buildAddButtonHTML(product.id, true)
                : (qty > 0 ? this.buildQtyControlHTML(product.id, qty) : this.buildAddButtonHTML(product.id, false));

            return `
                <div class="product-card" data-product-id="${safeId}" data-category="${safeCategory}" data-action="open-product-detail">
                    ${badge}
                    <button class="wishlist-btn ${isWish ? 'active' : ''}" data-id="${safeId}" data-action="toggle-wishlist" aria-label="পছন্দ তালিকায় যোগ করুন">
                        <span class="material-symbols-outlined">favorite</span>
                    </button>
                    <img class="product-image" src="${safeImage}" alt="${safeTitle}" loading="lazy">
                    <div class="product-name">${safeTitle}</div>
                    <div class="product-price">${priceHTML}</div>
                    ${buttonHTML}
                </div>
            `;
        }).join('');
    },

    renderCategories() {
        const container = document.getElementById('categoryContainer');
        if (!container) return;

        const iconMap = {
            'phone': 'smartphone', 'smartwatch': 'watch', 'power bank': 'battery_charging_full',
            'earbuds': 'earbuds', 'laptop': 'laptop', 'tablet': 'tablet', 'router': 'router',
            'headphone': 'headphones', 'keyboard': 'keyboard', 'charger': 'cable',
            'pendrive': 'usb', 'mouse': 'mouse', 'all': 'apps'
        };

        const categories = new Set();
        state.products.forEach(p => {
            if (p.category) categories.add(p.category.toLowerCase());
        });

        let html = `
            <button class="pill active" data-category="all">
                <span class="material-symbols-outlined">${iconMap.all}</span>
                সব
            </button>
        `;

        Array.from(categories).sort().forEach(cat => {
            const label = cat.charAt(0).toUpperCase() + cat.slice(1);
            const icon = iconMap[cat] || 'category';
            html += `
                <button class="pill" data-category="${Utils.escapeAttr(cat)}">
                    <span class="material-symbols-outlined">${icon}</span>
                    ${Utils.escapeHtml(label)}
                </button>
            `;
        });

        container.innerHTML = html;
    },

    refreshCardButtons() {
        document.querySelectorAll('.product-card').forEach(card => {
            const productId = card.dataset.productId;
            if (!productId) return;
            const product = state.products.find(p => p.id === productId);
            const cartItem = CartManager.getItem(productId);
            const qty = cartItem?.quantity || 0;
            const stock = product?.stock !== undefined ? Number(product.stock) : 9999;
            const outOfStock = stock <= 0;

            const btnContainer = card.querySelector('.main-qty-control, .add-btn');
            if (!btnContainer) return;

            const newHTML = outOfStock
                ? this.buildAddButtonHTML(productId, true)
                : (qty > 0 ? this.buildQtyControlHTML(productId, qty) : this.buildAddButtonHTML(productId, false));

            btnContainer.outerHTML = newHTML;
        });
    },

    openDetail(productId) {
        const product = state.products.find(p => p.id === productId);
        if (!this.isValidProduct(product)) {
            Toast.error('প্রোডাক্টের তথ্য পাওয়া যায়নি');
            return;
        }

        const stock = product.stock !== undefined ? Number(product.stock) : 9999;
        const outOfStock = stock <= 0;
        const price = Number.isFinite(Number(product.price)) ? Number(product.price) : 0;
        const oldPrice = Number.isFinite(Number(product.oldPrice)) ? Number(product.oldPrice) : 0;

        document.getElementById('detailImage').src = product.image || CONFIG.FALLBACK_IMAGE;
        document.getElementById('detailTitle').textContent = product.title;

        const priceEl = document.getElementById('detailPrice');
        if (oldPrice > price && oldPrice > 0) {
            priceEl.innerHTML = `<span class="old">${Utils.formatPrice(oldPrice)}</span> ${Utils.formatPrice(price)}`;
        } else {
            priceEl.textContent = Utils.formatPrice(price);
        }

        const discountEl = document.getElementById('detailDiscount');
        if (oldPrice > price && oldPrice > 0) {
            const disc = Math.round(100 - (price / oldPrice) * 100);
            discountEl.textContent = `-${disc}%`;
            discountEl.classList.add('show');
        } else {
            discountEl.classList.remove('show');
        }

        const stockEl = document.getElementById('detailStock');
        stockEl.textContent = outOfStock ? 'স্টক নেই' : 'স্টকে আছে';
        stockEl.classList.toggle('out-of-stock', outOfStock);
        stockEl.classList.toggle('in-stock', !outOfStock);

        document.getElementById('detailDesc').textContent = product.description || 'বিবরণ নেই';

        const addBtn = document.getElementById('detailAddBtn');
        addBtn.dataset.id = productId;
        addBtn.disabled = outOfStock;
        addBtn.innerHTML = outOfStock
            ? '<span class="material-symbols-outlined">block</span>স্টক নেই'
            : '<span class="material-symbols-outlined">add_shopping_cart</span>কার্টে যোগ করুন';

        const wishBtn = document.getElementById('detailWishlistBtn');
        wishBtn.dataset.id = productId;
        const isFav = WishlistManager.isFavorite(productId);
        wishBtn.classList.toggle('active', isFav);
        const icon = wishBtn.querySelector('.material-symbols-outlined');
        if (icon) {
            icon.style.fontVariationSettings = isFav ? "'FILL' 1" : "'FILL' 0";
        }

        // Open the detail panel
        document.getElementById('productDetailPanel').classList.add('open');
        document.getElementById('productDetailOverlay').classList.add('open');
    },

    closeDetail() {
        document.getElementById('productDetailPanel').classList.remove('open');
        document.getElementById('productDetailOverlay').classList.remove('open');
    },

    showSkeleton() {
        const container = document.getElementById('productContainer');
        if (!container) return;
        container.innerHTML = Array(12).fill(`
            <div class="product-card" style="padding:18px 16px;">
                <div style="aspect-ratio:1;border-radius:12px;background:rgba(0,0,0,0.03);margin-bottom:12px;"></div>
                <div style="height:18px;width:70%;border-radius:6px;background:rgba(0,0,0,0.04);margin:0 auto 8px;"></div>
                <div style="height:16px;width:40%;border-radius:6px;background:rgba(0,0,0,0.04);margin:0 auto 16px;"></div>
                <div style="height:42px;border-radius:10px;background:rgba(0,0,0,0.03);"></div>
            </div>
        `).join('');
    }
};

// ===== ORDER MANAGER =====
const OrderManager = {
    load() {
        return Utils.load(CONFIG.STORAGE_KEYS.ORDERS);
    },
    save(orders) {
        Utils.save(CONFIG.STORAGE_KEYS.ORDERS, orders);
    },
    async placeOrder(formData) {
        if (state.isProcessing) return;
        state.isProcessing = true;
        const btn = document.getElementById('checkoutBtn');
        if (btn) { btn.textContent = 'প্রসেসিং...'; btn.disabled = true; }
        try {
            const subtotal = CartManager.getSubtotal();
            const delivery = Utils.getDeliveryCharge();
            const discount = Utils.calculateDiscount(subtotal, state.appliedCoupon);
            const total = subtotal + delivery - discount;
            const orderId = state.editingOrderId || Utils.generateOrderId();

            await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                body: JSON.stringify({
                    orderId,
                    name: formData.name,
                    mobile: formData.phone,
                    address: formData.address,
                    productName: state.cart.map(i => `${i.title} (${i.quantity}টি)`).join(', '),
                    subTotal: subtotal,
                    discount,
                    couponCode: state.appliedCoupon?.code || '',
                    deliveryCharge: delivery,
                    total,
                    paymentMethod: 'COD',
                    stat: 'Pending',
                    courierName: '',
                    trackingId: '',
                    note: formData.note || 'নেই',
                    'date&time': new Date().toLocaleString('bn-BD', { hour12: true })
                })
            });

            const history = this.load().filter(o => o.orderId !== orderId);
            history.unshift({
                orderId,
                date: new Date().toLocaleString('bn-BD', { hour12: true }),
                items: state.cart.map(i => `${i.title} (${i.quantity}টি)`).join(', '),
                rawItems: JSON.parse(JSON.stringify(state.cart)),
                subTotal: subtotal,
                deliveryCharge: delivery,
                total,
                status: 'Pending',
                courierName: '',
                trackingId: '',
                customerInfo: { name: formData.name, address: formData.address, phone: formData.phone }
            });
            this.save(history);

            state.editingOrderId = null;
            CartManager.clear();
            this.clearCheckoutForm();
            Modal.hideAll();
            Modal.show('orderSuccessModal');
            Utils.closeCart();
            return true;
        } catch (error) {
            console.error('অর্ডার প্লেস করতে সমস্যা:', error);
            Toast.error('অর্ডার প্লেস করতে সমস্যা হয়েছে');
            return false;
        } finally {
            state.isProcessing = false;
            if (btn) { btn.textContent = 'অর্ডার নিশ্চিত করুন'; btn.disabled = false; }
        }
    },
    clearCheckoutForm() {
        ['custName', 'custAddress', 'custPhone', 'custNote', 'couponInput'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.value = '';
                el.classList.remove('field-invalid');
            }
        });
        document.getElementById('phoneError').style.display = 'none';
        Utils.resetCartSlider();
    },
    renderHistory() {
        const history = this.load();
        const container = document.getElementById('orderHistoryContainer');
        if (!container) return;
        if (!history.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-outlined">history</span>
                    <h3>কোনো অর্ডার ইতিহাস নেই</h3>
                </div>
            `;
            Modal.show('orderHistoryModal');
            return;
        }
        const statusConfig = {
            'Pending': { cls: 'pending', icon: 'schedule', label: 'পেন্ডিং' },
            'Processing': { cls: 'processing', icon: 'autorenew', label: 'প্রসেসিং' },
            'Delivered': { cls: 'delivered', icon: 'task_alt', label: 'ডেলিভার্ড' },
            'Cancelled': { cls: 'cancelled', icon: 'cancel', label: 'বাতিল' }
        };
        container.innerHTML = history.map(order => {
            const status = order.status || 'Pending';
            const config = statusConfig[status] || statusConfig.Pending;
            const canEdit = status === 'Pending';
            const canDelete = ['Delivered', 'Cancelled'].includes(status);
            const safeOrderId = Utils.escapeHtml(order.orderId);
            const safeDate = Utils.escapeHtml(order.date);
            const safeItems = Utils.escapeHtml(order.items);
            const safeCourier = Utils.escapeHtml(order.courierName || '');
            const safeTracking = Utils.escapeHtml(order.trackingId || '');
            const safeIdAttr = Utils.escapeAttr(order.orderId);
            const customerInfo = order.customerInfo;
            let customerHtml = '';
            if (customerInfo) {
                customerHtml = `
                    <div class="order-card-customer">
                        <strong>${Utils.escapeHtml(customerInfo.name || '')}</strong> · ${Utils.escapeHtml(customerInfo.phone || '')}<br>
                        ${Utils.escapeHtml(customerInfo.address || '')}
                    </div>
                `;
            }

            return `
                <div class="order-history-card">
                    <div class="order-card-header">
                        <span class="order-card-id">
                            <span class="material-symbols-outlined">local_shipping</span>
                            ${safeOrderId}
                        </span>
                        <span class="status-badge ${config.cls}">
                            <span class="material-symbols-outlined">${config.icon}</span>
                            ${config.label}
                        </span>
                    </div>
                    <div class="order-card-date">${safeDate}</div>
                    <div class="order-card-products">${safeItems}</div>
                    ${customerHtml}
                    ${order.courierName || order.trackingId ? `
                        <div class="order-card-tracking">
                            ${order.courierName ? `<span class="material-symbols-outlined">local_shipping</span>${safeCourier}` : ''}
                            ${order.trackingId ? `<span class="material-symbols-outlined">tag</span>${safeTracking}` : ''}
                        </div>
                    ` : ''}
                    <div class="order-card-footer">
                        <div class="order-card-total">${Utils.formatPrice(order.total)}</div>
                        <div class="order-card-actions">
                            ${canEdit ? `
                                <button class="action-btn edit-btn" data-action="order-edit" data-id="${safeIdAttr}" title="পরিবর্তন" aria-label="পরিবর্তন">
                                    <span class="material-symbols-outlined">edit</span>
                                </button>
                                <button class="action-btn cancel-btn" data-action="order-cancel" data-id="${safeIdAttr}" title="ক্যানসেল" aria-label="ক্যানসেল">
                                    <span class="material-symbols-outlined">cancel</span>
                                </button>
                            ` : ''}
                            ${canDelete ? `
                                <button class="action-btn delete-btn" data-action="order-delete" data-id="${safeIdAttr}" title="ডিলিট" aria-label="ডিলিট">
                                    <span class="material-symbols-outlined">delete</span>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        Modal.show('orderHistoryModal');
        this.syncStatusFromServer(history);
    },
    async syncStatusFromServer(history) {
        if (!history.length) return;
        try {
            const orderIds = history.map(o => o.orderId).join(',');
            const res = await fetch(
                `${CONFIG.GOOGLE_SCRIPT_URL}?orderIds=${encodeURIComponent(orderIds)}&nocache=${Date.now()}`,
                { mode: 'cors', headers: { 'Accept': 'application/json' } }
            );
            if (!res.ok) return;
            const data = await res.json();
            if (data?.status === 'success' && data.data) {
                let changed = false;
                const updated = this.load();
                updated.forEach(order => {
                    const server = data.data[order.orderId];
                    if (!server) return;
                    if (order.status !== server.stat || order.courierName !== server.courierName || order.trackingId !== server.trackingId) {
                        order.status = server.stat || order.status;
                        order.courierName = server.courierName || '';
                        order.trackingId = server.trackingId || '';
                        changed = true;
                    }
                });
                if (changed) { this.save(updated); this.renderHistory(); }
            }
        } catch (e) { console.warn('Status sync failed:', e); }
    },
    editOrder(orderId) {
        const history = this.load();
        const order = history.find(o => o.orderId === orderId);
        if (!order || order.status !== 'Pending') {
            Toast.error('এই অর্ডারটি পরিবর্তন করা যাবে না');
            return;
        }
        state.cart = order.rawItems?.map(i => ({ ...i })) || [];
        CartManager.save();
        if (order.customerInfo) {
            document.getElementById('custName').value = order.customerInfo.name || '';
            document.getElementById('custAddress').value = order.customerInfo.address || '';
            document.getElementById('custPhone').value = order.customerInfo.phone || '';
        }
        state.editingOrderId = orderId;
        Modal.hideAll();
        Utils.openCart();
        Toast.info('অর্ডার সম্পাদনার জন্য কার্ট লোড হয়েছে', 'edit');
    },
    async cancelOrder(orderId) {
        const history = this.load();
        const order = history.find(o => o.orderId === orderId);
        if (!order || order.status !== 'Pending') {
            Toast.error('এই অর্ডারটি বাতিল করা যাবে না');
            return;
        }
        order.status = 'Cancelled';
        order.date = new Date().toLocaleString('bn-BD', { hour12: true }) + ' (বাতিল)';
        this.save(history);
        Toast.info('অর্ডার বাতিল হয়েছে', 'cancel');
        this.renderHistory();
        try {
            await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                body: JSON.stringify({ orderId, stat: 'Cancelled', 'date&time': order.date })
            });
        } catch (e) { console.warn('Cancel sync failed:', e); }
    },
    async deleteOrder(orderId) {
        let history = this.load();
        const order = history.find(o => o.orderId === orderId);
        if (!order || !['Delivered', 'Cancelled'].includes(order.status)) {
            Toast.error('এই অর্ডারটি ডিলিট করা যাবে না');
            return;
        }
        history = history.filter(o => o.orderId !== orderId);
        this.save(history);
        Toast.success('অর্ডার ডিলিট হয়েছে', 'delete');
        this.renderHistory();
        try {
            await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                body: JSON.stringify({ orderId, stat: 'Deleted By Customer' })
            });
        } catch (e) { console.warn('Delete sync failed:', e); }
    }
};

// ===== SLIDER =====
const Slider = {
    init() {
        const slider = document.getElementById('imageSlider');
        const dots = document.querySelectorAll('#sliderDots .dot');
        if (!slider || !dots.length) return;
        const total = 3;
        const go = (index) => {
            state.currentSlide = index;
            slider.style.transform = `translateX(-${(index * 100) / total}%)`;
            dots.forEach((dot, i) => dot.classList.toggle('active', i === index));
        };
        const restart = () => {
            clearInterval(state.slideInterval);
            state.slideInterval = setInterval(() => go((state.currentSlide + 1) % total), CONFIG.SLIDER_INTERVAL);
        };
        dots.forEach((dot, i) => {
            dot.addEventListener('click', () => { go(i); restart(); });
        });
        go(0);
        restart();
    }
};

// ===== SEARCH =====
const Search = {
    init() {
        const input = document.getElementById('productSearch');
        const dropdown = document.getElementById('searchResults');
        if (!input || !dropdown) return;

        let debounceTimer = null;
        input.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            const value = e.target.value.toLowerCase().trim();
            if (!value) { dropdown.classList.remove('active'); return; }
            debounceTimer = setTimeout(() => {
                const filtered = state.products.filter(p => p.title.toLowerCase().includes(value));
                this.renderResults(filtered);
            }, 150);
        });

        dropdown.addEventListener('click', (e) => {
            const item = e.target.closest('[data-action="open-product-detail"]');
            if (item?.dataset.id) {
                ProductManager.openDetail(item.dataset.id);
                dropdown.classList.remove('active');
                input.value = '';
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-box')) dropdown.classList.remove('active');
        });
    },
    renderResults(products) {
        const dropdown = document.getElementById('searchResults');
        if (!products.length) {
            dropdown.innerHTML = `
                <div class="search-result-item" style="justify-content:center;color:#5a5f78;">কোনো ফলাফল পাওয়া যায়নি</div>
            `;
        } else {
            dropdown.innerHTML = products.slice(0, 8).map(p => {
                const safeId = Utils.escapeAttr(p.id);
                const safeTitle = Utils.escapeHtml(p.title);
                const safeImage = Utils.escapeAttr(p.image || CONFIG.FALLBACK_IMAGE);
                return `
                    <div class="search-result-item" data-action="open-product-detail" data-id="${safeId}">
                        <img class="search-result-img" src="${safeImage}">
                        <div class="search-result-info">
                            <div class="search-result-title">${safeTitle}</div>
                            <div class="search-result-price">${Utils.formatPrice(p.price)}</div>
                        </div>
                    </div>
                `;
            }).join('');
        }
        dropdown.classList.add('active');
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
            if (handler && id) {
                e.stopPropagation();
                handler(id);
            }
        });
    }
};

// Broken-image fallback via capture-phase delegation
function attachImageFallback(root) {
    root.addEventListener('error', (e) => {
        const img = e.target;
        if (img.tagName !== 'IMG' || img.dataset.fallbackApplied) return;
        img.dataset.fallbackApplied = 'true';
        img.src = img.classList.contains('logo-img') ? CONFIG.FALLBACK_LOGO : CONFIG.FALLBACK_IMAGE;
    }, true);
}

// ===== EVENTS =====
function initEvents() {
    attachImageFallback(document.body);

    ['productContainer', 'cartItems', 'wishlistItems', 'orderHistoryContainer'].forEach(id => {
        const el = document.getElementById(id);
        if (el) ActionRouter.attach(el);
    });

    // Cart open/close
    document.getElementById('cartBtn')?.addEventListener('click', Utils.openCart);
    document.getElementById('mobileCartBtn')?.addEventListener('click', Utils.openCart);
    document.getElementById('closeCart')?.addEventListener('click', Utils.closeCart);
    document.getElementById('cartOverlay')?.addEventListener('click', Utils.closeCart);

    // Product detail panel
    document.getElementById('closeProductDetail')?.addEventListener('click', ProductManager.closeDetail);
    document.getElementById('productDetailOverlay')?.addEventListener('click', ProductManager.closeDetail);

    document.getElementById('detailAddBtn')?.addEventListener('click', function () {
        if (this.disabled) return;
        CartManager.add(this.dataset.id);
        ProductManager.closeDetail();
    });

    document.getElementById('detailWishlistBtn')?.addEventListener('click', function () {
        if (this.dataset.id) {
            WishlistManager.toggle(this.dataset.id);
            const isFav = WishlistManager.isFavorite(this.dataset.id);
            this.classList.toggle('active', isFav);
            const icon = this.querySelector('.material-symbols-outlined');
            if (icon) {
                icon.style.fontVariationSettings = isFav ? "'FILL' 1" : "'FILL' 0";
            }
        }
    });

    document.getElementById('goToCheckoutBtn')?.addEventListener('click', () => {
        if (!state.cart.length) {
            Modal.show('emptyCartModal');
        } else {
            document.getElementById('cartSliderWrapper').style.transform = 'translateX(-50%)';
        }
    });
    document.getElementById('backToCartBtn')?.addEventListener('click', Utils.resetCartSlider);
    document.getElementById('deliveryArea')?.addEventListener('change', () => CartManager.renderSidebar());

    document.getElementById('applyCouponBtn')?.addEventListener('click', () => {
        const code = document.getElementById('couponInput').value.trim().toUpperCase();
        if (CONFIG.COUPONS[code]) {
            state.appliedCoupon = { code, ...CONFIG.COUPONS[code] };
            Toast.success(`"${code}" কুপন প্রয়োগ!`);
        } else {
            state.appliedCoupon = null;
            Toast.error('কুপন কোড সঠিক নয়');
        }
        CartManager.renderSidebar();
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

    document.getElementById('checkoutBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!state.cart.length) {
            Modal.show('emptyCartModal');
            return;
        }

        const nameEl = document.getElementById('custName');
        const addressEl = document.getElementById('custAddress');
        const phoneEl = document.getElementById('custPhone');
        const noteEl = document.getElementById('custNote');

        const name = nameEl.value.trim();
        const address = addressEl.value.trim();
        const phone = phoneEl.value.trim();
        const note = noteEl.value.trim();

        const requiredFields = [
            { el: nameEl, value: name },
            { el: addressEl, value: address },
            { el: phoneEl, value: phone }
        ];
        const missing = requiredFields.filter(f => !f.value);

        requiredFields.forEach(f => f.el.classList.toggle('field-invalid', !f.value));

        if (missing.length) {
            Toast.error('নাম, ঠিকানা ও মোবাইল নম্বর পূরণ করুন');
            missing[0].el.focus();
            return;
        }

        if (!Utils.isValidPhone(phone)) {
            phoneEl.classList.add('field-invalid');
            document.getElementById('phoneError').style.display = 'block';
            phoneEl.focus();
            return;
        }
        document.getElementById('phoneError').style.display = 'none';
        await OrderManager.placeOrder({ name, address, phone, note });
    });

    ['custName', 'custAddress', 'custPhone'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', function () {
            this.classList.remove('field-invalid');
            if (id === 'custPhone') {
                document.getElementById('phoneError').style.display = 'none';
            }
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
        const filtered = ProductManager.filterByCategory(state.products, state.activeCategory);
        ProductManager.render(filtered);
        if (window.innerWidth <= 480) {
            btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    });

    // Horizontal category slider arrows
    const catPills = document.getElementById('categoryContainer');
    const scrollLeftBtn = document.getElementById('catScrollLeft');
    const scrollRightBtn = document.getElementById('catScrollRight');
    if (catPills && scrollLeftBtn && scrollRightBtn) {
        scrollLeftBtn.addEventListener('click', () => {
            catPills.scrollBy({ left: -200, behavior: 'smooth' });
        });
        scrollRightBtn.addEventListener('click', () => {
            catPills.scrollBy({ left: 200, behavior: 'smooth' });
        });
    }

    window.addEventListener('scroll', () => {
        const btn = document.getElementById('backToTopBtn');
        if (!btn) return;
        btn.classList.toggle('show', window.scrollY > CONFIG.SCROLL_THRESHOLD);
    }, { passive: true });
    document.getElementById('backToTopBtn')?.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.getElementById('navHomeBtn')?.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.getElementById('navCategoryBtn')?.addEventListener('click', () => {
        document.querySelector('.category-section')?.scrollIntoView({ behavior: 'smooth' });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            Modal.hideAll();
            Utils.closeCart();
            ProductManager.closeDetail();
        }
    });

    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
    });

    const header = document.querySelector('header');
    if (header) {
        window.addEventListener('scroll', () => {
            header.classList.toggle('scrolled', window.scrollY > 40);
        }, { passive: true });
    }
}

// ===== INIT =====
async function init() {
    CartManager.load();
    WishlistManager.load();

    ProductManager.showSkeleton();

    Slider.init();
    Search.init();
    initEvents();

    try {
        const data = await fetchProducts();
        state.products = data;

        ProductManager.renderCategories();

        const filtered = ProductManager.filterByCategory(state.products, state.activeCategory);
        ProductManager.render(filtered);

        WishlistManager.updateUI();
        CartManager.updateUI();
    } catch (error) {
        console.error('ডাটা লোডে সমস্যা:', error);
        document.getElementById('productContainer').innerHTML = `
            <div class="empty-state" style="grid-column:1/-1;">
                <span class="material-symbols-outlined">error</span>
                <h3>ডাটা লোড করতে সমস্যা হয়েছে</h3>
                <p style="color:#5a5f78;">পৃষ্ঠাটি রিফ্রেশ করে আবার চেষ্টা করুন</p>
            </div>
        `;
    }

    const loader = document.getElementById('pageLoader');
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => { loader.style.display = 'none'; }, 400);
    }
}

document.addEventListener('DOMContentLoaded', init);