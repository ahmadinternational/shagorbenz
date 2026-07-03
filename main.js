import { fetchProducts } from './products.js';

// ============================================
// GLOBAL CONFIGURATION
// ============================================
const WHATSAPP_NUMBER = "8801816020682";
window.WHATSAPP_NUMBER = WHATSAPP_NUMBER;

const VALID_COUPONS = {
  'SB10': { type: 'percent', value: 10 },
  'SB50': { type: 'flat', value: 50 },
  'WELCOME': { type: 'percent', value: 15 }
};

// ============================================
// GLOBAL STATE (with localStorage persistence)
// ============================================
let cart = [];
let productsData = [];
let currentSort = 'default';
let appliedCoupon = null;

// Load cart from localStorage safely
try {
  const savedCart = localStorage.getItem('shagorbenzCart');
  if (savedCart) {
    cart = JSON.parse(savedCart);
    if (!Array.isArray(cart)) cart = [];
  }
} catch(e) {
  cart = [];
  console.error('Cart load error:', e);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Save cart to localStorage
function saveCart() {
  try {
    localStorage.setItem('shagorbenzCart', JSON.stringify(cart));
  } catch(e) {
    console.error('Cart save error:', e);
  }
}

// Show toast notification
window.showToast = function(message, icon = 'check_circle') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span>${message}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 300);
  }, 2000);
};

// Update cart count in both desktop and mobile
function updateCartCount() {
  const totalItems = cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
  
  const cartCountEl = document.getElementById('cartCount');
  const mobileCartCountEl = document.getElementById('mobileCartCount');
  
  if (cartCountEl) cartCountEl.textContent = totalItems;
  if (mobileCartCountEl) mobileCartCountEl.textContent = totalItems;
}

// ============================================
// WISHLIST FUNCTIONS
// ============================================
function getWishlist() {
  try {
    const wishlist = localStorage.getItem('userWishlist');
    return wishlist ? JSON.parse(wishlist) : [];
  } catch(e) {
    return [];
  }
}

function saveWishlist(list) {
  try {
    localStorage.setItem('userWishlist', JSON.stringify(list));
  } catch(e) {
    console.error('Wishlist save error:', e);
  }
  updateWishlistCount();
}

function updateWishlistCount() {
  const count = getWishlist().length;
  const el = document.getElementById('wishlistCount');
  if (el) el.textContent = count;
}

window.toggleWishlist = function(productId) {
  const product = productsData.find(p => p.id == productId);
  if (!product) return;

  let wishlist = getWishlist();
  const exists = wishlist.find(item => item.id == productId);

  if (exists) {
    wishlist = wishlist.filter(item => item.id != productId);
    window.showToast('পছন্দের তালিকা থেকে সরানো হয়েছে', 'heart_broken');
  } else {
    wishlist.push({ 
      id: product.id, 
      title: product.title, 
      price: product.price, 
      image: product.image 
    });
    window.showToast('পছন্দের তালিকায় যোগ করা হয়েছে', 'favorite');
  }
  
  saveWishlist(wishlist);
  refreshWishlistIcons();
  
  // Refresh wishlist modal if open
  if (typeof renderWishlistModalContent === 'function') {
    renderWishlistModalContent();
  }
};

function refreshWishlistIcons() {
  const wishlist = getWishlist();
  document.querySelectorAll('.wishlist-btn').forEach(btn => {
    const id = btn.getAttribute('data-id');
    const isActive = wishlist.some(item => item.id == id);
    if (isActive) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function renderWishlistModalContent() {
  const container = document.getElementById('wishlistItemsContainer');
  if (!container) return;
  
  const wishlist = getWishlist();

  if (wishlist.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; color:#888; padding:30px 0;">
        <span class="material-symbols-outlined" style="font-size:48px; color:#ff3b30; margin-bottom:10px;">favorite_border</span>
        <p>আপনার পছন্দের তালিকা এখনো খালি।</p>
      </div>`;
    return;
  }

  container.innerHTML = wishlist.map(item => `
    <div style="display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
      <img src="${item.image || 'https://via.placeholder.com/60'}" 
           style="width:50px; height:50px; object-fit:cover; border-radius:8px;" 
           alt="${item.title}"
           onerror="this.src='https://via.placeholder.com/60'">
      <div style="flex:1;">
        <div style="color:#fff; font-size:14px; font-weight:600;">${item.title}</div>
        <div style="color:#00f2fe; font-size:13px;">${item.price} টাকা</div>
      </div>
      <button onclick="window.addToCartFromWishlist('${item.id}')" 
              style="background:#00f2fe; color:#000; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;">
        কার্টে যোগ
      </button>
      <button onclick="window.removeFromWishlist('${item.id}')" 
              style="background:transparent; border:none; color:#ff3b30; cursor:pointer; font-size:20px;" 
              aria-label="সরান">
        ✕
      </button>
    </div>
  `).join('');
}

window.addToCartFromWishlist = function(productId) {
  const product = getWishlist().find(item => item.id == productId);
  if (product) {
    changeQuantity(productId, 1);
    window.removeFromWishlist(productId);
  }
};

window.removeFromWishlist = function(productId) {
  let wishlist = getWishlist();
  wishlist = wishlist.filter(item => item.id != productId);
  saveWishlist(wishlist);
  renderWishlistModalContent();
  refreshWishlistIcons();
  window.showToast('পছন্দের তালিকা থেকে সরানো হয়েছে', 'delete');
};

// ============================================
// CART FUNCTIONS
// ============================================
function changeQuantity(id, amount) {
  const product = productsData.find(p => p.id == id);
  if (!product) {
    console.error('Product not found:', id);
    return;
  }

  if (product.stock !== undefined && Number(product.stock) <= 0 && amount > 0) {
    window.showToast('দুঃখিত, প্রোডাক্টটি স্টকে নেই', 'error');
    return;
  }

  const existingItem = cart.find(item => item.id == id);

  if (existingItem) {
    existingItem.quantity = (existingItem.quantity || 1) + amount;
    if (existingItem.quantity <= 0) {
      cart = cart.filter(item => item.id != id);
    }
  } else if (amount > 0) {
    cart.push({ 
      id: product.id,
      title: product.title,
      price: product.price,
      image: product.image,
      quantity: 1,
      category: product.category,
      stock: product.stock,
      description: product.description
    });
    window.showToast('কার্টে যোগ করা হয়েছে', 'shopping_cart');
  }

  saveCart();
  updateCart();
  refreshAllProductButtons();
}

window.changeQuantityGlobal = function(id, amount) {
  changeQuantity(id, amount);
};

function updateCart() {
  updateCartCount();
  
  const cartItemsContainer = document.getElementById('cartItems');
  if (!cartItemsContainer) return;

  // Update cart items display
  let productsPrice = 0;
  
  if (cart.length === 0) {
    cartItemsContainer.innerHTML = `
      <div style="text-align:center; color:#888; padding:30px 0;">
        <span class="material-symbols-outlined" style="font-size:48px; margin-bottom:10px;">shopping_cart</span>
        <p>আপনার কার্টটি খালি আছে।</p>
      </div>`;
  } else {
    cartItemsContainer.innerHTML = cart.map(item => {
      const itemTotal = Number(item.price) * (item.quantity || 1);
      productsPrice += itemTotal;
      
      return `
        <div class="cart-item" style="display:flex; align-items:center; padding:12px; gap:12px; border-bottom:1px solid rgba(255,255,255,0.08);">
          <img src="${item.image || 'https://via.placeholder.com/50'}" 
               style="width:50px; height:50px; object-fit:cover; border-radius:8px;" 
               alt="${item.title}"
               onerror="this.src='https://via.placeholder.com/50'">
          <div style="flex:1; text-align:left;">
            <h4 style="margin:0; color:#fff; font-size:14px;">${item.title}</h4>
            <p style="margin:4px 0; color:#aaa; font-size:12px;">${item.price} ৳ x ${item.quantity}</p>
            <div style="display:flex; gap:8px; margin-top:5px; align-items:center;">
              <button onclick="window.changeQuantityGlobal('${item.id}', -1)" 
                      style="background:#333; color:#fff; border:1px solid #ff3b30; width:28px; height:28px; border-radius:4px; cursor:pointer; font-size:16px;">-</button>
              <span style="font-weight:bold; color:#00f2fe;">${item.quantity}</span>
              <button onclick="window.changeQuantityGlobal('${item.id}', 1)" 
                      style="background:#333; color:#fff; border:1px solid #00f2fe; width:28px; height:28px; border-radius:4px; cursor:pointer; font-size:16px;">+</button>
            </div>
          </div>
          <strong style="color:#00f2fe;">${itemTotal} ৳</strong>
        </div>
      `;
    }).join('');
  }

  // Calculate delivery charge
  const deliverySelect = document.getElementById('deliveryArea');
  let deliveryCharge = 60; // default
  if (deliverySelect && deliverySelect.selectedIndex !== -1) {
    deliveryCharge = Number(deliverySelect.options[deliverySelect.selectedIndex].getAttribute('data-charge')) || 60;
  }

  // Calculate discount
  let discountValue = 0;
  if (appliedCoupon && cart.length > 0) {
    discountValue = appliedCoupon.type === 'percent'
      ? Math.round(productsPrice * (appliedCoupon.value / 100))
      : appliedCoupon.value;
    discountValue = Math.min(discountValue, productsPrice);
  }

  // Update billing display
  const subTotalEl = document.getElementById('subTotalAmount');
  const deliveryChargeEl = document.getElementById('deliveryChargeAmount');
  const totalAmountEl = document.getElementById('cartTotalAmount');
  const discountRow = document.getElementById('discountRow');
  const discountAmountEl = document.getElementById('discountAmount');
  const couponCodeLabelEl = document.getElementById('couponCodeLabel');

  if (subTotalEl) subTotalEl.textContent = productsPrice;
  if (deliveryChargeEl) deliveryChargeEl.textContent = deliveryCharge;
  if (totalAmountEl) totalAmountEl.textContent = (productsPrice + deliveryCharge - discountValue);
  
  if (discountRow) {
    discountRow.style.display = discountValue > 0 ? 'flex' : 'none';
  }
  if (discountAmountEl) discountAmountEl.textContent = discountValue;
  if (couponCodeLabelEl) couponCodeLabelEl.textContent = appliedCoupon ? appliedCoupon.code : '';
}

function refreshAllProductButtons() {
  document.querySelectorAll('.product-btn-container').forEach(container => {
    const id = container.id.replace('btn-container-', '');
    const product = productsData.find(p => p.id == id);
    if (!product) return;
    
    const outOfStock = product.stock !== undefined && Number(product.stock) <= 0;
    if (outOfStock) return;
    
    const cartItem = cart.find(item => item.id == id);
    
    if (cartItem && cartItem.quantity > 0) {
      container.innerHTML = `
        <div class="main-qty-control">
          <button class="main-qty-btn minus-btn-click" data-id="${id}">-</button>
          <span class="main-qty-display">${cartItem.quantity}</span>
          <button class="main-qty-btn plus-btn-click" data-id="${id}">+</button>
        </div>
      `;
    } else {
      container.innerHTML = `<button class="add-btn" data-id="${id}">কার্টে যোগ করুন</button>`;
    }
  });
}

// ============================================
// MODAL FUNCTIONS
// ============================================
function showModal(modalId, titleText = '', messageText = '', isConfirm = false, onConfirmCallback = null) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  if (titleText) {
    const titleEl = modal.querySelector('h2') || modal.querySelector('h3');
    if (titleEl) titleEl.textContent = titleText;
  }

  if (messageText) {
    const msgEl = document.getElementById('emptyCartMessage') || modal.querySelector('p');
    if (msgEl) msgEl.textContent = messageText;
  }

  if (modalId === 'emptyCartModal' && isConfirm) {
    let actionBtn = document.getElementById('closeEmptyCartBtn');
    if (actionBtn) {
      // Remove old listeners by cloning
      const newBtn = actionBtn.cloneNode(true);
      actionBtn.parentNode.replaceChild(newBtn, actionBtn);
      actionBtn = newBtn;
      
      actionBtn.textContent = "হ্যাঁ, নিশ্চিত";
      actionBtn.style.background = "linear-gradient(135deg, #24e044, #1e9439)";
      
      let cancelBtn = document.getElementById('cancelEmptyCartBtn');
      if (!cancelBtn) {
        cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancelEmptyCartBtn';
        cancelBtn.textContent = "না, ফিরে যান";
        cancelBtn.style.cssText = "margin-top:10px; background:#ff3b30; color:white; width:100%; padding:10px; border:none; border-radius:8px; font-weight:bold; cursor:pointer;";
        actionBtn.parentNode.insertBefore(cancelBtn, actionBtn.nextSibling);
      }
      cancelBtn.style.display = "block";
      cancelBtn.onclick = () => hideModal(modal);
      actionBtn.onclick = () => {
        if (onConfirmCallback) onConfirmCallback();
        hideModal(modal);
      };
    }
  }

  modal.style.display = 'flex';
}

function hideModal(modal) {
  if (!modal) return;
  modal.style.display = 'none';
  
  // Reset confirm modal if needed
  const cancelBtn = document.getElementById('cancelEmptyCartBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
}

// ============================================
// PRODUCT RENDERING
// ============================================
function renderSkeletonLoader(count = 6) {
  const container = document.getElementById('productContainer');
  if (!container) return;
  
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-card">
        <div class="skeleton-box skeleton-img"></div>
        <div class="skeleton-box skeleton-line"></div>
        <div class="skeleton-box skeleton-line short"></div>
      </div>
    `;
  }
  container.innerHTML = html;
}

function sortProducts(products, sortType) {
  const list = [...products];
  switch (sortType) {
    case 'price-low':
      return list.sort((a, b) => Number(a.price) - Number(b.price));
    case 'price-high':
      return list.sort((a, b) => Number(b.price) - Number(a.price));
    case 'name-az':
      return list.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'bn'));
    default:
      return list;
  }
}

function renderProducts(products) {
  const container = document.getElementById('productContainer');
  if (!container) return;
  
  if (!products || products.length === 0) {
    container.innerHTML = `
      <p style="text-align:center; color:#888; padding:40px; grid-column:1/-1;">
        কোনো প্রোডাক্ট পাওয়া যায়নি।
      </p>`;
    return;
  }

  const wishlist = getWishlist();
  
  container.innerHTML = products.map(product => {
    const cartItem = cart.find(item => item.id == product.id);
    const currentQty = cartItem ? cartItem.quantity : 0;
    const isWishlisted = wishlist.some(item => item.id == product.id);
    const outOfStock = product.stock !== undefined && Number(product.stock) <= 0;
    
    let badgeHtml = '';
    if (outOfStock) {
      badgeHtml = '<span class="stock-badge">স্টক নেই</span>';
    } else if (product.oldPrice && Number(product.oldPrice) > Number(product.price)) {
      const discountPct = Math.round(100 - (Number(product.price) / Number(product.oldPrice)) * 100);
      badgeHtml = `<span class="discount-badge">-${discountPct}%</span>`;
    }

    return `
      <div class="product-card" data-category="${product.category || ''}">
        ${badgeHtml}
        <button class="wishlist-btn ${isWishlisted ? 'active' : ''}" data-id="${product.id}" aria-label="পছন্দের তালিকায় যোগ করুন">
          <span class="material-symbols-outlined">favorite</span>
        </button>
        <img class="product-image" src="${product.image || 'https://via.placeholder.com/250'}" alt="${product.title}" loading="lazy" onerror="this.src='https://via.placeholder.com/250'">
        <h3 class="product-name">${product.title}</h3>
        <p class="product-price">
          ${product.oldPrice && Number(product.oldPrice) > Number(product.price) ? `<span style="text-decoration:line-through; color:#777; font-size:13px; margin-right:6px;">${product.oldPrice} টাকা</span>` : ''}
          ${product.price} টাকা
        </p>
        <div class="product-btn-container" id="btn-container-${product.id}">
          ${outOfStock ? 
            '<button class="add-btn" disabled style="opacity:0.5; cursor:not-allowed;">স্টক নেই</button>' :
            currentQty > 0 ?
            `<div class="main-qty-control">
              <button class="main-qty-btn minus-btn-click" data-id="${product.id}">-</button>
              <span class="main-qty-display">${currentQty}</span>
              <button class="main-qty-btn plus-btn-click" data-id="${product.id}">+</button>
            </div>` :
            `<button class="add-btn" data-id="${product.id}">কার্টে যোগ করুন</button>`
          }
        </div>
      </div>
    `;
  }).join('');

  // Add event listeners for wishlist buttons
  container.querySelectorAll('.wishlist-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.toggleWishlist(btn.getAttribute('data-id'));
    });
  });
}

// ============================================
// SLIDER FUNCTIONS
// ============================================
let currentSlide = 0;
let slideInterval;

function startSlider() {
  const slider = document.getElementById('imageSlider');
  const dots = document.querySelectorAll('#sliderDots .dot');
  const totalSlides = 3;

  if (!slider || dots.length === 0) return;

  function goToSlide(index) {
    currentSlide = index;
    slider.style.transform = `translateX(-${(currentSlide * 100) / totalSlides}%)`;
    dots.forEach((dot, i) => {
      dot.style.background = i === currentSlide ? '#00f2fe' : 'rgba(255,255,255,0.25)';
    });
  }

  slideInterval = setInterval(() => {
    goToSlide((currentSlide + 1) % totalSlides);
  }, 3000);

  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      const index = parseInt(dot.getAttribute('data-slide'));
      goToSlide(index);
      clearInterval(slideInterval);
      slideInterval = setInterval(() => {
        goToSlide((currentSlide + 1) % totalSlides);
      }, 3000);
    });
  });
}

// ============================================
// ORDER HISTORY FUNCTIONS
// ============================================
function saveOrderToHistory(customerName, customerAddress, customerPhone, deliveryArea, subTotal, deliveryCharge, total, orderId) {
  let orderHistory = [];
  try {
    orderHistory = JSON.parse(localStorage.getItem('userOrderHistory') || '[]');
  } catch(e) {
    orderHistory = [];
  }

  // Remove if editing existing order
  if (window.currentEditingOrderId) {
    orderHistory = orderHistory.filter(order => order.orderId !== window.currentEditingOrderId);
  }

  const newOrder = {
    orderId: orderId,
    date: new Date().toLocaleString('bn-BD', { hour12: true }),
    items: cart.map(item => `${item.title} (${item.quantity}টি)`).join(', '),
    rawItems: JSON.parse(JSON.stringify(cart)),
    subTotal: subTotal,
    deliveryCharge: deliveryCharge,
    total: total,
    status: "Pending",
    courierName: "",
    trackingId: "",
    customerInfo: {
      name: customerName,
      address: customerAddress,
      phone: customerPhone
    }
  };

  orderHistory.unshift(newOrder);
  if (orderHistory.length > 20) orderHistory.pop();
  
  localStorage.setItem('userOrderHistory', JSON.stringify(orderHistory));
  window.currentEditingOrderId = null;
}

window.editPendingOrder = function(orderId) {
  let orderHistory = [];
  try {
    orderHistory = JSON.parse(localStorage.getItem('userOrderHistory') || '[]');
  } catch(e) {
    return;
  }
  
  const matchedOrder = orderHistory.find(order => order.orderId === orderId);
  if (!matchedOrder) return;
  
  if (matchedOrder.status !== "Pending") {
    showModal('emptyCartModal', "দুঃখিত!", "এই অর্ডারটি পেন্ডিং অবস্থায় নেই। তাই এডিট করা সম্ভব নয়!", false);
    return;
  }

  // Load order items to cart
  cart = [];
  if (matchedOrder.rawItems && Array.isArray(matchedOrder.rawItems)) {
    matchedOrder.rawItems.forEach(item => cart.push({...item}));
  }
  saveCart();
  updateCart();
  refreshAllProductButtons();

  // Fill customer info
  setTimeout(() => {
    const nameEl = document.getElementById('custName');
    const addressEl = document.getElementById('custAddress');
    const phoneEl = document.getElementById('custPhone');
    if (nameEl && matchedOrder.customerInfo) nameEl.value = matchedOrder.customerInfo.name || '';
    if (addressEl && matchedOrder.customerInfo) addressEl.value = matchedOrder.customerInfo.address || '';
    if (phoneEl && matchedOrder.customerInfo) phoneEl.value = matchedOrder.customerInfo.phone || '';
  }, 200);

  window.currentEditingOrderId = orderId;
  
  // Open cart sidebar
  const cartSidebar = document.getElementById('cartSidebar');
  if (cartSidebar) cartSidebar.classList.add('open');
  
  // Reset slider to first slide
  const sliderWrapper = document.getElementById('cartSliderWrapper');
  if (sliderWrapper) sliderWrapper.style.transform = 'translateX(0)';
  
  showModal('emptyCartModal', "অর্ডার লোড হয়েছে!", `অর্ডারটি (${orderId}) সফলভাবে কার্টে লোড হয়েছে।`, false);
};

window.cancelPendingOrder = async function(orderId) {
  let orderHistory = [];
  try {
    orderHistory = JSON.parse(localStorage.getItem('userOrderHistory') || '[]');
  } catch(e) {
    return;
  }
  
  const matchedOrder = orderHistory.find(order => order.orderId === orderId);
  if (!matchedOrder || matchedOrder.status !== "Pending") {
    showModal('emptyCartModal', "দুঃখিত!", "এই অর্ডারটি বাতিল করা যাবে না।", false);
    return;
  }

  showModal('emptyCartModal', "বাতিল করতে চান?", `আপনি কি নিশ্চিত যে (${orderId}) অর্ডারটি বাতিল করতে চান?`, true, async () => {
    matchedOrder.status = "Cancelled";
    matchedOrder.date = new Date().toLocaleString('bn-BD', { hour12: true }) + " (বাতিলকৃত)";
    localStorage.setItem('userOrderHistory', JSON.stringify(orderHistory));

    // Refresh history modal
    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) historyBtn.click();
    else buildHistoryList(orderHistory);

    // Send cancellation to Google Sheets
    try {
      const sheetWebhookUrl = "https://script.google.com/macros/s/AKfycbwbzm5xrmSdDVkgT8hNoEgYCR61Dztmam8bDjZ8o-6EL_tBW7r_AOKp62mGpCfinzEm/exec";
      await fetch(sheetWebhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify({
          orderId: orderId,
          stat: "Cancelled",
          "date&time": new Date().toLocaleString('bn-BD', { hour12: true }) + " (গ্রাহক দ্বারা বাতিল)"
        })
      });
    } catch(e) {
      console.error('Sheet update failed:', e);
    }
  });
};

window.deleteHistoryOrder = async function(orderId) {
  let orderHistory = [];
  try {
    orderHistory = JSON.parse(localStorage.getItem('userOrderHistory') || '[]');
  } catch(e) {
    return;
  }
  
  const matchedOrder = orderHistory.find(order => order.orderId === orderId);
  if (!matchedOrder) return;
  
  const status = matchedOrder.status?.trim();
  if (!["Delivered", "Cancelled", "Deleted By Customer"].includes(status)) {
    showModal('emptyCartModal', "দুঃখিত!", "শুধুমাত্র ডেলিভার্ড বা বাতিল হওয়া অর্ডারই মুছে ফেলা সম্ভব।", false);
    return;
  }

  showModal('emptyCartModal', "মুছে ফেলতে চান?", `আপনি কি নিশ্চিত যে (${orderId}) অর্ডারটি হিস্ট্রি থেকে মুছে ফেলতে চান?`, true, async () => {
    orderHistory = orderHistory.filter(order => order.orderId !== orderId);
    localStorage.setItem('userOrderHistory', JSON.stringify(orderHistory));

    // Refresh
    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) historyBtn.click();
    else buildHistoryList(orderHistory);

    try {
      const sheetWebhookUrl = "https://script.google.com/macros/s/AKfycbwbzm5xrmSdDVkgT8hNoEgYCR61Dztmam8bDjZ8o-6EL_tBW7r_AOKp62mGpCfinzEm/exec";
      await fetch(sheetWebhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify({
          orderId: orderId,
          stat: "Deleted By Customer",
          "date&time": new Date().toLocaleString('bn-BD', { hour12: true })
        })
      });
    } catch(e) {
      console.error('Sheet update failed:', e);
    }
  });
};

function buildHistoryList(orderHistory) {
  let modal = document.getElementById('historyModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'historyModal';
    modal.className = 'success-modal';
    document.body.appendChild(modal);
  }

  if (!orderHistory || orderHistory.length === 0) {
    modal.innerHTML = `
      <div class="success-modal-content">
        <button class="close-modal" onclick="document.getElementById('historyModal').style.display='none'">✕</button>
        <div style="text-align:center; padding:30px; color:#888;">
          <span class="material-symbols-outlined" style="font-size:48px; color:#ff3b30;">history</span>
          <p style="margin-top:10px;">কোনো অর্ডার হিস্ট্রি নেই</p>
        </div>
      </div>`;
    modal.style.display = 'flex';
    return;
  }

  let html = `
    <div class="success-modal-content" style="max-width:500px; max-height:80vh; overflow-y:auto;">
      <button class="close-modal" onclick="document.getElementById('historyModal').style.display='none'">✕</button>
      <h3 style="color:#00f2fe; text-align:center; margin-bottom:15px;">
        <span class="material-symbols-outlined">history_edu</span> অর্ডার হিস্ট্রি
      </h3>
      <div style="max-height:350px; overflow-y:auto;">`;

  orderHistory.forEach(order => {
    const status = order.status?.trim() || "Pending";
    let statusColor = "#ffcc00";
    let statusText = "পেন্ডিং";
    
    if (status === "Processing") { statusColor = "#00f2fe"; statusText = "প্রসেসিং"; }
    else if (status === "Delivered") { statusColor = "#4cd964"; statusText = "ডেলিভার্ড"; }
    else if (status === "Cancelled" || status === "Deleted By Customer") { statusColor = "#ff3b30"; statusText = "বাতিল"; }

    const canDelete = ["Delivered", "Cancelled", "Deleted By Customer"].includes(status);
    const isPending = status === "Pending";

    html += `
      <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(0,242,254,0.15); border-radius:8px; padding:12px; margin-bottom:10px; position:relative;">
        ${canDelete ? `
          <button onclick="window.deleteHistoryOrder('${order.orderId}')" 
                  style="position:absolute; top:8px; right:8px; background:none; border:none; color:#ff3b30; cursor:pointer; font-size:18px;">🗑️</button>
        ` : ''}
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong style="color:#00f2fe;">🆔 ${order.orderId}</strong>
          <span style="color:${statusColor}; font-size:12px; font-weight:bold;">${statusText}</span>
        </div>
        <div style="color:#888; font-size:11px; margin:5px 0;">⏰ ${order.date}</div>
        <div style="color:#fff; font-size:13px;">📦 ${order.items}</div>
        ${order.courierName || order.trackingId ? `
          <div style="margin-top:8px; padding:8px; background:rgba(0,242,254,0.05); border-radius:6px; font-size:12px; color:#fff;">
            ${order.courierName ? `🚚 ${order.courierName}` : ''}
            ${order.trackingId ? `📦 ${order.trackingId}` : ''}
          </div>
        ` : ''}
        <div style="display:flex; justify-content:space-between; margin-top:8px; font-size:13px; color:#b0b8c4;">
          <span>মোট:</span>
          <span style="color:#00f2fe; font-weight:bold;">${order.total} ৳</span>
        </div>
        ${isPending ? `
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button onclick="window.editPendingOrder('${order.orderId}')" 
                    style="flex:1; background:linear-gradient(135deg,#00f2fe,#4facfe); color:#000; border:none; padding:8px; border-radius:6px; cursor:pointer; font-weight:bold; font-size:12px;">
              ✏️ পরিবর্তন
            </button>
            <button onclick="window.cancelPendingOrder('${order.orderId}')" 
                    style="flex:1; background:linear-gradient(135deg,#ff3b30,#b30000); color:#fff; border:none; padding:8px; border-radius:6px; cursor:pointer; font-weight:bold; font-size:12px;">
              ❌ বাতিল
            </button>
          </div>
        ` : ''}
      </div>`;
  });

  html += `</div></div>`;
  modal.innerHTML = html;
  modal.style.display = 'flex';
}

// ============================================
// EVENT LISTENERS SETUP
// ============================================
function setupEventListeners() {
  // Cart open/close
  document.getElementById('cartBtn')?.addEventListener('click', () => {
    document.getElementById('cartSidebar')?.classList.add('open');
    updateCart();
  });
  
  document.getElementById('closeCart')?.addEventListener('click', () => {
    document.getElementById('cartSidebar')?.classList.remove('open');
  });

  // Mobile cart
  document.getElementById('mobileCartBtn')?.addEventListener('click', () => {
    document.getElementById('cartSidebar')?.classList.add('open');
    updateCart();
  });

  // Cart slider navigation
  document.getElementById('goToCheckoutBtn')?.addEventListener('click', () => {
    if (cart.length === 0) {
      showModal('emptyCartModal', "কার্ট খালি!", "আপনার কার্টটি বর্তমানে খালি রয়েছে।", false);
      return;
    }
    const wrapper = document.getElementById('cartSliderWrapper');
    if (wrapper) wrapper.style.transform = 'translateX(-50%)';
  });

  document.getElementById('backToCartBtn')?.addEventListener('click', () => {
    const wrapper = document.getElementById('cartSliderWrapper');
    if (wrapper) wrapper.style.transform = 'translateX(0)';
  });

  // Delivery area change
  document.getElementById('deliveryArea')?.addEventListener('change', updateCart);

  // Coupon apply
  document.getElementById('applyCouponBtn')?.addEventListener('click', () => {
    const input = document.getElementById('couponInput');
    const code = input?.value.trim().toUpperCase() || '';
    
    if (!code) {
      window.showToast('কুপন কোড লিখুন', 'error');
      return;
    }
    
    if (VALID_COUPONS[code]) {
      appliedCoupon = { code, ...VALID_COUPONS[code] };
      window.showToast(`"${code}" কুপন প্রয়োগ হয়েছে!`, 'local_offer');
    } else {
      appliedCoupon = null;
      window.showToast('কুপন কোডটি সঠিক নয়', 'error');
    }
    updateCart();
  });

  // Sort change
  document.getElementById('sortSelect')?.addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderProducts(sortProducts(productsData, currentSort));
  });

  // Wishlist buttons
  document.getElementById('wishlistBtn')?.addEventListener('click', () => {
    renderWishlistModalContent();
    document.getElementById('wishlistModal').style.display = 'flex';
  });
  
  document.getElementById('mobileWishlistBtn')?.addEventListener('click', () => {
    renderWishlistModalContent();
    document.getElementById('wishlistModal').style.display = 'flex';
  });
  
  document.getElementById('closeWishlistModal')?.addEventListener('click', () => {
    document.getElementById('wishlistModal').style.display = 'none';
  });

  // History button
  document.getElementById('historyBtn')?.addEventListener('click', () => {
    const orderHistory = JSON.parse(localStorage.getItem('userOrderHistory') || '[]');
    buildHistoryList(orderHistory);
  });
  
  document.getElementById('mobileHistoryBtn')?.addEventListener('click', () => {
    const orderHistory = JSON.parse(localStorage.getItem('userOrderHistory') || '[]');
    buildHistoryList(orderHistory);
  });

  // Theme toggle
  document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
    const body = document.body;
    const icon = document.getElementById('themeIcon');
    
    if (body.classList.contains('light-mode')) {
      body.classList.remove('light-mode');
      if (icon) icon.textContent = 'dark_mode';
      localStorage.setItem('shagorbenzTheme', 'dark');
    } else {
      body.classList.add('light-mode');
      if (icon) icon.textContent = 'light_mode';
      localStorage.setItem('shagorbenzTheme', 'light');
    }
  });

  // Checkout button
  document.getElementById('checkoutBtn')?.addEventListener('click', async function(e) {
    e.preventDefault();
    
    const name = document.getElementById('custName')?.value.trim() || '';
    const address = document.getElementById('custAddress')?.value.trim() || '';
    const phone = document.getElementById('custPhone')?.value.trim() || '';
    const note = document.getElementById('custNote')?.value.trim() || 'নেই';
    const deliverySelect = document.getElementById('deliveryArea');
    const phoneError = document.getElementById('phoneError');

    // Validation
    if (!name || !address || !phone) {
      showModal('emptyCartModal', "তথ্য বাকি!", "নাম, ঠিকানা এবং মোবাইল নম্বর পূরণ করুন।", false);
      return;
    }

    if (!/^01[3-9]\d{8}$/.test(phone)) {
      if (phoneError) phoneError.style.display = 'block';
      return;
    }
    if (phoneError) phoneError.style.display = 'none';

    // Calculate totals
    const subTotal = cart.reduce((sum, item) => sum + (Number(item.price) * (item.quantity || 1)), 0);
    const deliveryCharge = deliverySelect ? Number(deliverySelect.selectedOptions[0]?.dataset?.charge || 60) : 60;
    let discount = 0;
    if (appliedCoupon) {
      discount = appliedCoupon.type === 'percent' 
        ? Math.round(subTotal * (appliedCoupon.value / 100))
        : appliedCoupon.value;
      discount = Math.min(discount, subTotal);
    }
    const total = subTotal + deliveryCharge - discount;

    // Generate order ID
    const orderId = window.currentEditingOrderId || 
      `SB-${new Date().toISOString().slice(2,10).replace(/-/g,'')}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Prepare data
    const sheetData = {
      "date&time": new Date().toLocaleString('bn-BD', { hour12: true }),
      "orderId": orderId,
      "name": name,
      "mobile": phone,
      "address": address,
      "productName": cart.map(item => `${item.title} (${item.quantity}টি)`).join(', '),
      "subTotal": subTotal,
      "discount": discount,
      "couponCode": appliedCoupon?.code || '',
      "deliveryCharge": deliveryCharge,
      "total": total,
      "paymentMethod": "COD",
      "stat": "Pending",
      "courierName": "",
      "trackingId": "",
      "note": note
    };

    // Disable button
    this.textContent = "অর্ডার প্রসেস হচ্ছে...";
    this.disabled = true;

    try {
      // Send to Google Sheets
      await fetch("https://script.google.com/macros/s/AKfycbwbzm5xrmSdDVkgT8hNoEgYCR61Dztmam8bDjZ8o-6EL_tBW7r_AOKp62mGpCfinzEm/exec", {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify(sheetData)
      });

      // Save to local history
      saveOrderToHistory(name, address, phone, deliverySelect?.selectedOptions[0]?.text || '', subTotal, deliveryCharge, total, orderId);

      // Show success
      showModal('orderSuccessModal');
      // Send push notification
if (typeof window.sendOrderNotification === 'function') {
  window.sendOrderNotification(orderId, finalBill);
}
      document.getElementById('orderSuccessModal').style.display = 'flex';

      // Reset everything
      cart = [];
      appliedCoupon = null;
      saveCart();
      updateCart();
      refreshAllProductButtons();

      // Clear form
      document.getElementById('custName').value = '';
      document.getElementById('custAddress').value = '';
      document.getElementById('custPhone').value = '';
      document.getElementById('custNote').value = '';
      document.getElementById('couponInput').value = '';

      // Close sidebar
      document.getElementById('cartSidebar').classList.remove('open');
      document.getElementById('cartSliderWrapper').style.transform = 'translateX(0)';
      
    } catch(err) {
      console.error('Order error:', err);
      showModal('emptyCartModal', "এরর!", "অর্ডার সম্পন্ন হয়নি। আবার চেষ্টা করুন।", false);
    } finally {
      this.textContent = "অর্ডার কনফার্ম করুন";
      this.disabled = false;
    }
  });

  // Global click handler for product buttons
  document.addEventListener('click', (e) => {
    // Add to cart
    if (e.target.classList.contains('add-btn') && !e.target.disabled) {
      const id = e.target.getAttribute('data-id');
      if (id) changeQuantity(id, 1);
      return;
    }
    
    // Plus button
    if (e.target.classList.contains('plus-btn-click')) {
      const id = e.target.getAttribute('data-id');
      if (id) changeQuantity(id, 1);
      return;
    }
    
    // Minus button
    if (e.target.classList.contains('minus-btn-click')) {
      const id = e.target.getAttribute('data-id');
      if (id) changeQuantity(id, -1);
      return;
    }

    // Close modals on overlay click
    if (e.target.classList.contains('success-modal') && e.target.style.display === 'flex') {
      e.target.style.display = 'none';
    }

    // Modal close buttons
    if (e.target.id === 'closeSuccessBtn') {
      document.getElementById('orderSuccessModal').style.display = 'none';
    }
    if (e.target.id === 'closeEmptyCartBtn' || e.target.id === 'cancelEmptyCartBtn') {
      document.getElementById('emptyCartModal').style.display = 'none';
    }
  });

  // Product card click for quick view
  document.getElementById('productContainer')?.addEventListener('click', (e) => {
    const card = e.target.closest('.product-card');
    if (!card) return;
    if (e.target.closest('button')) return; // Skip button clicks
    
    const img = card.querySelector('.product-image')?.src;
    const title = card.querySelector('.product-name')?.textContent;
    const price = card.querySelector('.product-price')?.textContent;
    const btn = card.querySelector('.add-btn, .main-qty-btn');
    const id = btn?.getAttribute('data-id');

    if (id) {
      document.getElementById('modalImage').src = img || '';
      document.getElementById('modalTitle').textContent = title || '';
      document.getElementById('modalPrice').textContent = price || '';
      document.getElementById('modalAddBtn').setAttribute('data-id', id);
      
      const product = productsData.find(p => p.id == id);
      document.getElementById('modalDesc').textContent = product?.description || 'বিবরণ নেই';
      
      document.getElementById('productModal').style.display = 'flex';
    }
  });

  // Modal add to cart
  document.getElementById('modalAddBtn')?.addEventListener('click', function() {
    const id = this.getAttribute('data-id');
    if (id) {
      changeQuantity(id, 1);
      document.getElementById('productModal').style.display = 'none';
    }
  });

  // Modal wishlist
  document.getElementById('modalWishlistBtn')?.addEventListener('click', () => {
    const id = document.getElementById('modalAddBtn')?.getAttribute('data-id');
    if (id) window.toggleWishlist(id);
  });

  // Close product modal
  document.getElementById('closeModal')?.addEventListener('click', () => {
    document.getElementById('productModal').style.display = 'none';
  });
}

// ============================================
// SEARCH FUNCTIONALITY
// ============================================
function setupSearch() {
  const input = document.getElementById('productSearch');
  const dropdown = document.getElementById('searchResultsDropdown');
  if (!input || !dropdown) return;

  input.addEventListener('input', (e) => {
    const term = e.target.value.trim().toLowerCase();
    
    if (!term) {
      dropdown.classList.remove('active');
      dropdown.innerHTML = '';
      return;
    }

    const results = productsData.filter(p => 
      (p.title || '').toLowerCase().includes(term) ||
      (p.category || '').toLowerCase().includes(term)
    );

    if (results.length === 0) {
      dropdown.innerHTML = '<div class="no-result-text">কোনো প্রোডাক্ট পাওয়া যায়নি 🔍</div>';
    } else {
      dropdown.innerHTML = results.map(p => `
        <div class="search-result-item" data-id="${p.id}">
          <img src="${p.image || 'https://via.placeholder.com/40'}" alt="${p.title}" class="search-result-img" onerror="this.src='https://via.placeholder.com/40'">
          <div class="search-result-info">
            <div class="search-result-title">${p.title}</div>
            <div class="search-result-price">${p.price} টাকা</div>
          </div>
        </div>
      `).join('');

      // Add click listeners
      dropdown.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.getAttribute('data-id');
          const product = productsData.find(p => p.id == id);
          if (product) {
            renderProducts([product, ...productsData.filter(p => p.id != id)]);
            document.getElementById('productContainer')?.scrollIntoView({ behavior: 'smooth' });
          }
          dropdown.classList.remove('active');
          input.value = '';
        });
      });
    }
    dropdown.classList.add('active');
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove('active');
    }
  });
}

// ============================================
// CATEGORY FILTER
// ============================================
function setupCategoryFilter() {
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      
      const category = this.getAttribute('data-category')?.toLowerCase();
      let filtered = productsData;
      
      if (category && category !== 'all') {
        filtered = productsData.filter(p => (p.category || '').toLowerCase() === category);
      }
      
      renderProducts(sortProducts(filtered, currentSort));
    });
  });
}

// ============================================
// BACK TO TOP
// ============================================
function setupBackToTop() {
  const btn = document.getElementById('backToTopBtn');
  if (!btn) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
      btn.classList.add('show');
    } else {
      btn.classList.remove('show');
    }
  });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ============================================
// INITIALIZATION
// ============================================
async function init() {
  renderSkeletonLoader();

  try {
    productsData = await fetchProducts();
    window.productsData = productsData;
  } catch(err) {
    console.error('Product fetch failed:', err);
    document.getElementById('productContainer').innerHTML = `
      <p style="text-align:center; color:#ff3b30; padding:40px; grid-column:1/-1;">
        প্রোডাক্ট লোড করা যায়নি। পেজ রিফ্রেশ করুন।
      </p>`;
    document.getElementById('pageLoader').style.display = 'none';
    return;
  }

  if (productsData.length === 0) {
    document.getElementById('productContainer').innerHTML = `
      <p style="text-align:center; color:#888; padding:40px; grid-column:1/-1;">
        কোনো প্রোডাক্ট পাওয়া যায়নি।
      </p>`;
    document.getElementById('pageLoader').style.display = 'none';
    return;
  }

  // Initialize all components
  startSlider();
  setupEventListeners();
  setupSearch();
  setupCategoryFilter();
  setupBackToTop();
  
  // Render products
  renderProducts(sortProducts(productsData, currentSort));
  
  // Update UI
  updateCart();
  updateWishlistCount();
  
  // Load saved theme
  if (localStorage.getItem('shagorbenzTheme') === 'light') {
    document.body.classList.add('light-mode');
    const icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = 'light_mode';
  }
  
  // Hide loader
  setTimeout(() => {
    const loader = document.getElementById('pageLoader');
    if (loader) loader.style.display = 'none';
  }, 500);

  console.log('✅ SHAGORBENZ initialized successfully!');
}
// ============================================
// 🔔 PUSH NOTIFICATION FUNCTIONS
// ============================================

/**
 * Send a push notification to the current user
 * @param {string} title - Notification title
 * @param {string} message - Notification body
 * @param {string} url - URL to open on click (optional)
 */
window.sendPushNotification = async function(title, message, url = '') {
  const playerId = localStorage.getItem('oneSignalPlayerId');
  if (!playerId) {
    console.warn('No player ID found – user may not be subscribed');
    return false;
  }

  try {
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': 'os_v2_app_s6azapujfvh7lggbm5vxlbrh7syxr7cfws4ufe43wfswdtukwmwjedb7iqjvunk3ufadxief3o4fysmbdwucveibh3blchq6mtqhvqi' // ⚠️ আপনার REST API Key বসান
      },
      body: JSON.stringify({
        app_id: "9781903e-892d-4ff5-98c1-676b758627fc", // ⚠️ আপনার App ID
        include_player_ids: [playerId],
        headings: { en: title },
        contents: { en: message },
        url: url || window.location.origin,
        chrome_web_icon: "https://shagorbenz.com/logo.jpeg",
        chrome_web_badge: "https://shagorbenz.com/logo.jpeg"
      })
    });

    const data = await response.json();
    console.log('Notification sent:', data);
    return true;
  } catch (error) {
    console.error('Failed to send notification:', error);
    return false;
  }
};

/**
 * Send order confirmation notification
 */
window.sendOrderNotification = function(orderId, total) {
  window.sendPushNotification(
    '🛒 অর্ডার কনফার্ম হয়েছে!',
    `আপনার অর্ডার #${orderId} সফলভাবে গ্রহণ করা হয়েছে। মোট বিল: ${total} টাকা। আমরা শীঘ্রই যোগাযোগ করব।`
  );
};

/**
 * Send order status update notification
 */
window.sendStatusNotification = function(orderId, status) {
  const statusMessages = {
    'Processing': 'প্রসেসিং হচ্ছে',
    'Delivered': 'ডেলিভারি সম্পন্ন হয়েছে',
    'Cancelled': 'বাতিল করা হয়েছে'
  };

  const bengaliStatus = statusMessages[status] || status;
  window.sendPushNotification(
    `📦 অর্ডার আপডেট #${orderId}`,
    `আপনার অর্ডার ${bengaliStatus}। বিস্তারিত জানতে ক্লিক করুন।`
  );
};
// Start the app
document.addEventListener('DOMContentLoaded', init);