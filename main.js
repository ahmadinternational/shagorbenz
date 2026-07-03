import { fetchProducts } from './products.js';

// ===================== GLOBAL CONFIG =====================
const ONESIGNAL_APP_ID = "9781903e-892d-4ff5-98c1-676b758627fc";
const ONESIGNAL_REST_API_KEY = "os_v2_app_s6azapujfvh7lggbm5vxlbrh7syxr7cfws4ufe43wfswdtukwmwjedb7iqjvunk3ufadxief3o4fysmbdwucveibh3blchq6mtqhvqi";
const VALID_COUPONS = {
  SB10: { type: 'percent', value: 10 },
  SB50: { type: 'flat', value: 50 },
  WELCOME: { type: 'percent', value: 15 }
};

// ===================== GLOBAL STATE =====================
let cart = [];
let wishlist = [];
let productsData = [];
let currentSort = 'default';
let appliedCoupon = null;
let currentSlide = 0;
let slideInterval = null;

// ===================== LOCAL STORAGE HELPERS =====================
function loadCart() {
  try { cart = JSON.parse(localStorage.getItem('shagorbenzCart')) || []; } catch (e) { cart = []; }
}
function saveCart() {
  localStorage.setItem('shagorbenzCart', JSON.stringify(cart));
  updateCartCount();
}
function loadWishlist() {
  try { wishlist = JSON.parse(localStorage.getItem('shagorbenzWishlist')) || []; } catch (e) { wishlist = []; }
}
function saveWishlist() {
  localStorage.setItem('shagorbenzWishlist', JSON.stringify(wishlist));
  updateWishlistCount();
}
function loadOrderHistory() {
  try { return JSON.parse(localStorage.getItem('userOrderHistory')) || []; } catch (e) { return []; }
}
function saveOrderHistory(history) {
  localStorage.setItem('userOrderHistory', JSON.stringify(history));
}

// ===================== UI HELPERS =====================
function updateCartCount() {
  const total = cart.reduce((sum, i) => sum + (i.quantity || 1), 0);
  document.getElementById('cartCount').textContent = total;
  document.getElementById('mobileCartCount').textContent = total;
}
function updateWishlistCount() {
  document.getElementById('wishlistCount').textContent = wishlist.length;
}

window.showToast = (msg, icon = 'check_circle') => {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = '0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
};

// ===================== CART =====================
window.changeQuantityGlobal = (id, amount) => {
  const product = productsData.find(p => p.id == id);
  if (!product) return;
  if (product.stock != null && Number(product.stock) <= 0 && amount > 0) {
    window.showToast('স্টক নেই', 'error');
    return;
  }
  const existing = cart.find(i => i.id == id);
  if (existing) {
    existing.quantity = (existing.quantity || 1) + amount;
    if (existing.quantity <= 0) cart = cart.filter(i => i.id != id);
  } else if (amount > 0) {
    cart.push({ id: product.id, title: product.title, price: product.price, image: product.image, quantity: 1 });
    window.showToast('কার্টে যোগ হয়েছে', 'shopping_cart');
  }
  saveCart();
  renderCartSidebar();
  refreshProductButtons();
};

function renderCartSidebar() {
  const container = document.getElementById('cartItems');
  if (!container) return;
  let subtotal = 0;
  if (cart.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#888;padding:30px;">কার্ট খালি</div>';
  } else {
    container.innerHTML = cart.map(item => {
      const itemTotal = Number(item.price) * (item.quantity || 1);
      subtotal += itemTotal;
      return `<div style="display:flex;align-items:center;padding:10px;border-bottom:1px solid rgba(255,255,255,0.1);gap:10px;">
        <img src="${item.image || 'https://via.placeholder.com/50'}" style="width:45px;height:45px;object-fit:cover;border-radius:6px;" onerror="this.src='https://via.placeholder.com/50'">
        <div style="flex:1;text-align:left;">
          <div style="color:#fff;font-size:14px;font-weight:600;">${item.title}</div>
          <div style="color:#aaa;font-size:12px;">${item.price} ৳ × ${item.quantity}</div>
          <div style="display:flex;gap:8px;margin-top:5px;align-items:center;">
            <button onclick="window.changeQuantityGlobal('${item.id}',-1)" style="background:#333;color:#fff;border:1px solid #ff3b30;width:26px;height:26px;border-radius:4px;cursor:pointer;">−</button>
            <span style="color:#00f2fe;font-weight:bold;">${item.quantity}</span>
            <button onclick="window.changeQuantityGlobal('${item.id}',1)" style="background:#333;color:#fff;border:1px solid #00f2fe;width:26px;height:26px;border-radius:4px;cursor:pointer;">+</button>
          </div>
        </div>
        <strong style="color:#00f2fe;">${itemTotal} ৳</strong>
      </div>`;
    }).join('');
  }

  const delivery = parseInt(document.getElementById('deliveryArea')?.selectedOptions[0]?.dataset?.charge || 60);
  let discount = 0;
  if (appliedCoupon && cart.length) {
    discount = appliedCoupon.type === 'percent' ? Math.round(subtotal * appliedCoupon.value / 100) : appliedCoupon.value;
    discount = Math.min(discount, subtotal);
  }

  document.getElementById('subTotalAmount').textContent = subtotal;
  document.getElementById('deliveryChargeAmount').textContent = delivery;
  document.getElementById('cartTotalAmount').textContent = subtotal + delivery - discount;
  document.getElementById('discountRow').style.display = discount > 0 ? 'flex' : 'none';
  document.getElementById('discountAmount').textContent = discount;
  if (discount > 0) document.getElementById('couponCodeLabel').textContent = appliedCoupon.code;
}

function refreshProductButtons() {
  document.querySelectorAll('.product-btn-container').forEach(container => {
    const id = container.id.replace('btn-container-', '');
    const product = productsData.find(p => p.id == id);
    if (!product) return;
    const outOfStock = product.stock != null && Number(product.stock) <= 0;
    if (outOfStock) return;
    const cartItem = cart.find(i => i.id == id);
    if (cartItem && cartItem.quantity > 0) {
      container.innerHTML = `<div class="main-qty-control"><button class="main-qty-btn minus-btn-click" data-id="${id}">−</button><span class="main-qty-display">${cartItem.quantity}</span><button class="main-qty-btn plus-btn-click" data-id="${id}">+</button></div>`;
    } else {
      container.innerHTML = `<button class="add-btn" data-id="${id}">কার্টে যোগ করুন</button>`;
    }
  });
}

// ===================== WISHLIST =====================
window.toggleWishlist = (id) => {
  const product = productsData.find(p => p.id == id);
  if (!product) return;
  const idx = wishlist.findIndex(i => i.id == id);
  if (idx > -1) {
    wishlist.splice(idx, 1);
    window.showToast('পছন্দ থেকে সরানো হয়েছে', 'heart_broken');
  } else {
    wishlist.push({ id: product.id, title: product.title, price: product.price, image: product.image });
    window.showToast('পছন্দে যোগ হয়েছে', 'favorite');
  }
  saveWishlist();
  refreshWishlistIcons();
  renderWishlistModal();
};

window.addToCartFromWishlist = (id) => {
  window.changeQuantityGlobal(id, 1);
  wishlist = wishlist.filter(i => i.id != id);
  saveWishlist();
  refreshWishlistIcons();
  renderWishlistModal();
};

window.removeFromWishlist = (id) => {
  wishlist = wishlist.filter(i => i.id != id);
  saveWishlist();
  refreshWishlistIcons();
  renderWishlistModal();
};

function refreshWishlistIcons() {
  document.querySelectorAll('.wishlist-btn').forEach(btn => {
    btn.classList.toggle('active', wishlist.some(i => i.id == btn.dataset.id));
  });
}

function renderWishlistModal() {
  const container = document.getElementById('wishlistItemsContainer');
  if (!container) return;
  if (!wishlist.length) {
    container.innerHTML = '<div style="text-align:center;color:#888;padding:30px;">খালি</div>';
    return;
  }
  container.innerHTML = wishlist.map(item => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
    <img src="${item.image || 'https://via.placeholder.com/50'}" style="width:45px;height:45px;object-fit:cover;border-radius:6px;" onerror="this.src='https://via.placeholder.com/50'">
    <div style="flex:1;text-align:left;">
      <div style="color:#fff;font-size:13px;">${item.title}</div>
      <div style="color:#00f2fe;font-size:12px;">${item.price} টাকা</div>
    </div>
    <button onclick="window.addToCartFromWishlist('${item.id}')" style="background:#00f2fe;color:#000;border:none;padding:5px 10px;border-radius:5px;cursor:pointer;font-size:11px;">কার্টে</button>
    <button onclick="window.removeFromWishlist('${item.id}')" style="background:none;border:none;color:#ff3b30;cursor:pointer;font-size:16px;">✕</button>
  </div>`).join('');
}

// ===================== MODALS =====================
function showModal(id) {
  document.getElementById(id).style.display = 'flex';
}
function hideModal(id) {
  document.getElementById(id).style.display = 'none';
}
window.hideAllModals = () => document.querySelectorAll('.success-modal').forEach(m => m.style.display = 'none');

// Close modals on overlay click
document.addEventListener('click', e => {
  if (e.target.classList.contains('success-modal')) e.target.style.display = 'none';
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    window.hideAllModals();
    document.getElementById('cartSidebar')?.classList.remove('open');
  }
});

// ===================== SLIDER =====================
function startSlider() {
  const slider = document.getElementById('imageSlider');
  const dots = document.querySelectorAll('#sliderDots .dot');
  if (!slider || !dots.length) return;
  const totalSlides = 3;
  function goToSlide(index) {
    currentSlide = index;
    slider.style.transform = `translateX(-${(currentSlide * 100) / totalSlides}%)`;
    dots.forEach((dot, i) => dot.style.background = i === currentSlide ? '#00f2fe' : 'rgba(255,255,255,0.25)');
  }
  slideInterval = setInterval(() => goToSlide((currentSlide + 1) % totalSlides), 3500);
  dots.forEach(dot => dot.addEventListener('click', () => {
    goToSlide(parseInt(dot.dataset.slide));
    clearInterval(slideInterval);
    slideInterval = setInterval(() => goToSlide((currentSlide + 1) % totalSlides), 3500);
  }));
}

// ===================== ORDER HISTORY =====================
window.editPendingOrder = (orderId) => {
  const history = loadOrderHistory();
  const order = history.find(o => o.orderId === orderId);
  if (!order || order.status !== 'Pending') {
    showModal('emptyCartModal');
    return;
  }
  cart = order.rawItems ? order.rawItems.map(i => ({...i})) : [];
  saveCart();
  renderCartSidebar();
  refreshProductButtons();
  setTimeout(() => {
    document.getElementById('custName').value = order.customerInfo?.name || '';
    document.getElementById('custAddress').value = order.customerInfo?.address || '';
    document.getElementById('custPhone').value = order.customerInfo?.phone || '';
  }, 200);
  window.currentEditingOrderId = orderId;
  document.getElementById('cartSidebar')?.classList.add('open');
  document.getElementById('cartSliderWrapper').style.transform = 'translateX(0)';
};

window.cancelPendingOrder = async (orderId) => {
  const history = loadOrderHistory();
  const order = history.find(o => o.orderId === orderId);
  if (!order || order.status !== 'Pending') return;
  order.status = 'Cancelled';
  order.date = new Date().toLocaleString('bn-BD', { hour12: true }) + ' (বাতিল)';
  saveOrderHistory(history);
  refreshHistoryUI();
};

window.deleteHistoryOrder = async (orderId) => {
  let history = loadOrderHistory();
  history = history.filter(o => o.orderId !== orderId);
  saveOrderHistory(history);
  refreshHistoryUI();
};

function refreshHistoryUI() {
  const history = loadOrderHistory();
  let modal = document.getElementById('historyModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'historyModal';
    modal.className = 'success-modal';
    document.body.appendChild(modal);
  }

  if (!history.length) {
    modal.innerHTML = `
      <div class="success-modal-content">
        <button class="close-modal" onclick="window.hideAllModals()">✕</button>
        <div style="text-align:center; padding:40px 20px; color:#888;">
          <span class="material-symbols-outlined" style="font-size:56px; color:#ff3b30; display:block; margin-bottom:12px;">history</span>
          <h3 style="color:#aaa; margin:0;">কোনো অর্ডার হিস্ট্রি নেই</h3>
          <p style="font-size:13px; margin-top:6px;">আপনার করা অর্ডার এখানে দেখতে পাবেন।</p>
        </div>
      </div>`;
  } else {
    modal.innerHTML = `
      <div class="success-modal-content">
        <button class="close-modal" onclick="window.hideAllModals()">✕</button>
        <h3 style="color:#00f2fe; text-align:center; margin:0 0 20px 0; font-size:20px; display:flex; align-items:center; justify-content:center; gap:8px;">
          <span class="material-symbols-outlined">history_edu</span> অর্ডার হিস্ট্রি
        </h3>
        ${history.map(order => {
          const s = order.status || 'Pending';
          let statusClass = 'pending', statusIcon = '⏳', statusText = 'পেন্ডিং';
          if (s === 'Processing') { statusClass = 'processing'; statusIcon = '🔄'; statusText = 'প্রসেসিং'; }
          else if (s === 'Delivered') { statusClass = 'delivered'; statusIcon = '✅'; statusText = 'ডেলিভার্ড'; }
          else if (s === 'Cancelled' || s === 'Deleted By Customer') { statusClass = 'cancelled'; statusIcon = '❌'; statusText = 'বাতিল'; }

          return `
          <div class="order-history-card">
            <div class="order-card-header">
              <span class="order-card-id">📦 ${order.orderId}</span>
              <span class="status-badge ${statusClass}">${statusIcon} ${statusText}</span>
            </div>
            <div class="order-card-date">
              <span class="material-symbols-outlined" style="font-size:14px;">schedule</span> ${order.date}
            </div>
            <div class="order-card-products">
              ${order.items}
            </div>
            ${order.courierName || order.trackingId ? `
            <div style="background:rgba(0,242,254,0.04); border-radius:6px; padding:8px 12px; margin-top:8px; font-size:12px; color:#b0b8c4;">
              ${order.courierName ? `<div>🚚 <b>কুরিয়ার:</b> ${order.courierName}</div>` : ''}
              ${order.trackingId ? `<div>📎 <b>ট্র্যাকিং:</b> <span style="color:#00f2fe;">${order.trackingId}</span></div>` : ''}
            </div>` : ''}
            <div class="order-card-footer">
              <div class="order-card-total">💰 ${order.total} ৳</div>
              <div class="order-card-actions">
                ${s === 'Pending' ? `
                  <button class="action-btn edit-btn" onclick="window.editPendingOrder('${order.orderId}')">
                    <span class="material-symbols-outlined" style="font-size:14px;">edit</span> পরিবর্তন
                  </button>
                  <button class="action-btn cancel-btn" onclick="window.cancelPendingOrder('${order.orderId}')">
                    <span class="material-symbols-outlined" style="font-size:14px;">cancel</span> বাতিল
                  </button>
                ` : ''}
                ${['Delivered','Cancelled','Deleted By Customer'].includes(s) ? `
                  <button class="action-btn delete-btn" onclick="window.deleteHistoryOrder('${order.orderId}')">
                    <span class="material-symbols-outlined" style="font-size:16px;">delete</span>
                  </button>
                ` : ''}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }
  modal.style.display = 'flex';
}

// ===================== PRODUCT RENDER =====================
function sortProducts(list, type) {
  const arr = [...list];
  if (type === 'price-low') return arr.sort((a, b) => Number(a.price) - Number(b.price));
  if (type === 'price-high') return arr.sort((a, b) => Number(b.price) - Number(a.price));
  if (type === 'name-az') return arr.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'bn'));
  return arr;
}

function renderProducts(products) {
  const container = document.getElementById('productContainer');
  if (!container) return;
  if (!products.length) {
    container.innerHTML = '<p style="text-align:center;color:#888;padding:40px;">কোনো প্রোডাক্ট নেই</p>';
    return;
  }
  container.innerHTML = products.map(product => {
    const cartItem = cart.find(i => i.id == product.id);
    const qty = cartItem?.quantity || 0;
    const isWish = wishlist.some(i => i.id == product.id);
    const outOfStock = product.stock != null && Number(product.stock) <= 0;
    let badge = '';
    if (outOfStock) badge = '<span class="stock-badge">স্টক নেই</span>';
    else if (product.oldPrice && Number(product.oldPrice) > Number(product.price)) {
      badge = `<span class="discount-badge">-${Math.round(100 - Number(product.price)/Number(product.oldPrice)*100)}%</span>`;
    }
    return `<div class="product-card" data-category="${product.category || ''}">
      ${badge}
      <button class="wishlist-btn ${isWish ? 'active' : ''}" data-id="${product.id}"><span class="material-symbols-outlined">favorite</span></button>
      <img class="product-image" src="${product.image || 'https://via.placeholder.com/250'}" alt="${product.title}" onerror="this.src='https://via.placeholder.com/250'">
      <h3 class="product-name">${product.title}</h3>
      <p class="product-price">${product.oldPrice && Number(product.oldPrice) > Number(product.price) ? `<span style="text-decoration:line-through;color:#777;font-size:13px;">${product.oldPrice} টাকা</span> ` : ''}${product.price} টাকা</p>
      <div class="product-btn-container" id="btn-container-${product.id}">
        ${outOfStock ? '<button class="add-btn" disabled style="opacity:0.5;">স্টক নেই</button>' :
          qty > 0 ? `<div class="main-qty-control"><button class="main-qty-btn minus-btn-click" data-id="${product.id}">−</button><span class="main-qty-display">${qty}</span><button class="main-qty-btn plus-btn-click" data-id="${product.id}">+</button></div>` :
          `<button class="add-btn" data-id="${product.id}">কার্টে যোগ করুন</button>`}
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.wishlist-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      window.toggleWishlist(btn.dataset.id);
    });
  });
}

// ===================== EVENT BINDING =====================
function bindEvents() {
  // Cart sidebar
  document.getElementById('cartBtn').addEventListener('click', () => {
    document.getElementById('cartSidebar').classList.add('open');
    renderCartSidebar();
  });
  document.getElementById('mobileCartBtn').addEventListener('click', () => {
    document.getElementById('cartSidebar').classList.add('open');
    renderCartSidebar();
  });
  document.getElementById('closeCart').addEventListener('click', () => {
    document.getElementById('cartSidebar').classList.remove('open');
  });

  // Checkout navigation
  document.getElementById('goToCheckoutBtn').addEventListener('click', () => {
    if (!cart.length) { showModal('emptyCartModal'); return; }
    document.getElementById('cartSliderWrapper').style.transform = 'translateX(-50%)';
  });
  document.getElementById('backToCartBtn').addEventListener('click', () => {
    document.getElementById('cartSliderWrapper').style.transform = 'translateX(0)';
  });

  // Delivery
  document.getElementById('deliveryArea').addEventListener('change', renderCartSidebar);

  // Coupon
  document.getElementById('applyCouponBtn').addEventListener('click', () => {
    const code = document.getElementById('couponInput').value.trim().toUpperCase();
    if (!code) return window.showToast('কোড লিখুন', 'error');
    if (VALID_COUPONS[code]) {
      appliedCoupon = { code, ...VALID_COUPONS[code] };
      window.showToast(`"${code}" প্রয়োগ হয়েছে!`, 'local_offer');
    } else {
      appliedCoupon = null;
      window.showToast('কোড সঠিক নয়', 'error');
    }
    renderCartSidebar();
  });

  // Sort
  document.getElementById('sortSelect').addEventListener('change', e => {
    currentSort = e.target.value;
    renderProducts(sortProducts(productsData, currentSort));
  });

  // Wishlist modal
  document.getElementById('wishlistBtn').addEventListener('click', () => {
    renderWishlistModal();
    showModal('wishlistModal');
  });
  document.getElementById('mobileWishlistBtn').addEventListener('click', () => {
    renderWishlistModal();
    showModal('wishlistModal');
  });
  document.getElementById('closeWishlistModal').addEventListener('click', () => hideModal('wishlistModal'));

  // History
  document.getElementById('historyBtn').addEventListener('click', refreshHistoryUI);
  document.getElementById('mobileHistoryBtn').addEventListener('click', refreshHistoryUI);

  // Theme
  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    const body = document.body;
    const icon = document.getElementById('themeIcon');
    if (body.classList.contains('light-mode')) {
      body.classList.remove('light-mode');
      icon.textContent = 'dark_mode';
      localStorage.setItem('shagorbenzTheme', 'dark');
    } else {
      body.classList.add('light-mode');
      icon.textContent = 'light_mode';
      localStorage.setItem('shagorbenzTheme', 'light');
    }
  });

  // Checkout submit
  document.getElementById('checkoutBtn').addEventListener('click', async function(e) {
    e.preventDefault();
    const name = document.getElementById('custName').value.trim();
    const address = document.getElementById('custAddress').value.trim();
    const phone = document.getElementById('custPhone').value.trim();
    const note = document.getElementById('custNote').value.trim() || 'নেই';
    const phoneError = document.getElementById('phoneError');

    if (!name || !address || !phone) {
      showModal('emptyCartModal');
      return;
    }
    if (!/^01[3-9]\d{8}$/.test(phone)) {
      phoneError.style.display = 'block';
      return;
    }
    phoneError.style.display = 'none';

    const subtotal = cart.reduce((sum, i) => sum + Number(i.price) * (i.quantity || 1), 0);
    const delivery = parseInt(document.getElementById('deliveryArea').selectedOptions[0].dataset.charge || 60);
    let discount = 0;
    if (appliedCoupon && cart.length) {
      discount = appliedCoupon.type === 'percent' ? Math.round(subtotal * appliedCoupon.value / 100) : appliedCoupon.value;
      discount = Math.min(discount, subtotal);
    }
    const total = subtotal + delivery - discount;
    const orderId = window.currentEditingOrderId || `SB-${new Date().toISOString().slice(2,10).replace(/-/g,'')}-${Math.floor(1000+Math.random()*9000)}`;

    this.textContent = 'প্রসেসিং...';
    this.disabled = true;

    try {
      await fetch('https://script.google.com/macros/s/AKfycbwbzm5xrmSdDVkgT8hNoEgYCR61Dztmam8bDjZ8o-6EL_tBW7r_AOKp62mGpCfinzEm/exec', {
        method: 'POST', mode: 'no-cors',
        body: JSON.stringify({ orderId, name, mobile: phone, address, productName: cart.map(i => `${i.title} (${i.quantity}টি)`).join(', '), subTotal: subtotal, discount, couponCode: appliedCoupon?.code || '', deliveryCharge: delivery, total, paymentMethod: 'COD', stat: 'Pending', courierName: '', trackingId: '', note, 'date&time': new Date().toLocaleString('bn-BD', { hour12: true }) })
      });

      const history = loadOrderHistory();
      history.unshift({ orderId, date: new Date().toLocaleString('bn-BD', { hour12: true }), items: cart.map(i => `${i.title} (${i.quantity}টি)`).join(', '), rawItems: JSON.parse(JSON.stringify(cart)), subTotal: subtotal, deliveryCharge: delivery, total, status: 'Pending', courierName: '', trackingId: '', customerInfo: { name, address, phone } });
      saveOrderHistory(history);
      window.currentEditingOrderId = null;

      showModal('orderSuccessModal');
      if (typeof window.sendOrderNotification === 'function') window.sendOrderNotification(orderId, total);

      cart = []; appliedCoupon = null;
      saveCart();
      renderCartSidebar();
      refreshProductButtons();
      ['custName','custAddress','custPhone','custNote','couponInput'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('cartSidebar').classList.remove('open');
      document.getElementById('cartSliderWrapper').style.transform = 'translateX(0)';
    } catch (err) {
      showModal('emptyCartModal');
    } finally {
      this.textContent = 'অর্ডার কনফার্ম করুন';
      this.disabled = false;
    }
  });

  // Close modals buttons
  document.getElementById('closeModal').addEventListener('click', () => hideModal('productModal'));
  document.getElementById('closeSuccessBtn').addEventListener('click', () => hideModal('orderSuccessModal'));
  document.getElementById('closeEmptyCartBtn').addEventListener('click', () => hideModal('emptyCartModal'));

  // Quick view and modal add
  document.getElementById('productContainer').addEventListener('click', e => {
    if (e.target.classList.contains('add-btn') && !e.target.disabled) {
      window.changeQuantityGlobal(e.target.dataset.id, 1);
      return;
    }
    if (e.target.classList.contains('plus-btn-click')) {
      window.changeQuantityGlobal(e.target.dataset.id, 1);
      return;
    }
    if (e.target.classList.contains('minus-btn-click')) {
      window.changeQuantityGlobal(e.target.dataset.id, -1);
      return;
    }
    const card = e.target.closest('.product-card');
    if (card && !e.target.closest('button')) {
      const img = card.querySelector('.product-image')?.src;
      const title = card.querySelector('.product-name')?.textContent;
      const price = card.querySelector('.product-price')?.textContent;
      const id = card.querySelector('.add-btn, .main-qty-btn')?.dataset.id;
      if (id) {
        document.getElementById('modalImage').src = img || '';
        document.getElementById('modalTitle').textContent = title || '';
        document.getElementById('modalPrice').textContent = price || '';
        document.getElementById('modalAddBtn').dataset.id = id;
        document.getElementById('modalDesc').textContent = productsData.find(p => p.id == id)?.description || 'বিবরণ নেই';
        showModal('productModal');
      }
    }
  });

  document.getElementById('modalAddBtn').addEventListener('click', function() {
    window.changeQuantityGlobal(this.dataset.id, 1);
    hideModal('productModal');
  });
  document.getElementById('modalWishlistBtn').addEventListener('click', () => {
    const id = document.getElementById('modalAddBtn').dataset.id;
    if (id) window.toggleWishlist(id);
  });
}

// ===================== SEARCH & CATEGORY =====================
function setupSearch() {
  const input = document.getElementById('productSearch');
  const dropdown = document.getElementById('searchResultsDropdown');
  if (!input || !dropdown) return;
  input.addEventListener('input', () => {
    const term = input.value.trim().toLowerCase();
    if (!term) { dropdown.classList.remove('active'); dropdown.innerHTML = ''; return; }
    const results = productsData.filter(p => (p.title||'').toLowerCase().includes(term) || (p.category||'').toLowerCase().includes(term));
    dropdown.innerHTML = results.length ? results.map(p => `<div class="search-result-item" data-id="${p.id}"><img src="${p.image||'https://via.placeholder.com/40'}" class="search-result-img" onerror="this.src='https://via.placeholder.com/40'"><div class="search-result-info"><div class="search-result-title">${p.title}</div><div class="search-result-price">${p.price} টাকা</div></div></div>`).join('') : '<div class="no-result-text">পাওয়া যায়নি 🔍</div>';
    dropdown.classList.add('active');
    dropdown.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        const prod = productsData.find(p => p.id == id);
        if (prod) renderProducts([prod, ...productsData.filter(p => p.id != id)]);
        dropdown.classList.remove('active');
        input.value = '';
      });
    });
  });
  document.addEventListener('click', e => { if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.classList.remove('active'); });
}

function setupCategories() {
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      const cat = this.dataset.category?.toLowerCase();
      const filtered = cat && cat !== 'all' ? productsData.filter(p => (p.category||'').toLowerCase() === cat) : productsData;
      renderProducts(sortProducts(filtered, currentSort));
    });
  });
}

// Back to top
window.addEventListener('scroll', () => {
  document.getElementById('backToTopBtn').classList.toggle('show', window.scrollY > 300);
});
document.getElementById('backToTopBtn').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// ===================== INIT =====================
async function init() {
  loadCart();
  loadWishlist();
  document.getElementById('productContainer').innerHTML = Array(6).fill('<div class="skeleton-card"><div class="skeleton-box skeleton-img"></div><div class="skeleton-box skeleton-line"></div><div class="skeleton-box skeleton-line short"></div></div>').join('');
  try {
    productsData = await fetchProducts();
    window.productsData = productsData;
    if (!productsData.length) {
      document.getElementById('productContainer').innerHTML = '<p style="text-align:center;color:#888;padding:40px;">কোনো প্রোডাক্ট নেই</p>';
      return;
    }
    startSlider();
    bindEvents();
    setupSearch();
    setupCategories();
    renderProducts(sortProducts(productsData, currentSort));
    updateCartCount();
    updateWishlistCount();
    renderCartSidebar();
    if (localStorage.getItem('shagorbenzTheme') === 'light') {
      document.body.classList.add('light-mode');
      document.getElementById('themeIcon').textContent = 'light_mode';
    }
  } catch (e) {
    document.getElementById('productContainer').innerHTML = '<p style="text-align:center;color:#ff3b30;padding:40px;">প্রোডাক্ট লোড করা যায়নি</p>';
  } finally {
    setTimeout(() => document.getElementById('pageLoader').style.display = 'none', 500);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();