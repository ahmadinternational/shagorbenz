import { fetchProducts } from './products.js';

// আপনার ব্র্যান্ডের জন্য ডেডিকেটেড হোয়াটসঅ্যাপ নাম্বার
const WHATSAPP_NUMBER = "8801816020682"; 

let cart = [];
let productsData = [];

// DOM Elements
const productContainer = document.getElementById('productContainer');
const cartBtn = document.getElementById('cartBtn');
const cartSidebar = document.getElementById('cartSidebar');
const closeCart = document.getElementById('closeCart');
const cartItemsContainer = document.getElementById('cartItems');
const cartCount = document.getElementById('cartCount');
const cartTotal = document.getElementById('cartTotal');
const checkoutBtn = document.getElementById('checkoutBtn');

// ১. সাইডবার কার্ট ওপেন/ক্লোজ করা
if (cartBtn) cartBtn.addEventListener('click', () => cartSidebar.classList.add('open'));
if (closeCart) closeCart.addEventListener('click', () => cartSidebar.classList.remove('open'));

// ২. ওয়েবসাইট লোড হওয়ার সাথে সাথে গুগল শিট থেকে প্রোডাক্ট আনা
async function init() {
  const loader = document.getElementById('pageLoader');
  if (loader) {
    loader.classList.add('fade-out');
  }
  
  productsData = await fetchProducts();
  
  if (productsData.length === 0) {
    productContainer.innerHTML = "<p>কোনো প্রোডাক্ট পাওয়া যায়নি।</p>";
    return;
  }
  
  renderProducts(productsData);
}

// ৩. স্ক্রিনে প্রোডাক্ট কার্ডগুলো দেখানো
function renderProducts(products) {
  productContainer.innerHTML = "";
  products.forEach(product => {
    const productCard = document.createElement('div');
    productCard.classList.add('product-card');
    
    const cartItem = cart.find(item => item.id == product.id);
    const currentQty = cartItem ? cartItem.quantity : 0;
    
    productCard.innerHTML = `
      <img class="product-image" src="${product.image || 'https://via.placeholder.com/250'}" alt="${product.title}">
      <h3 class="product-title">${product.title}</h3>
      <p class="product-price">${product.price} টাকা</p>
      
      <div class="product-btn-container" id="btn-container-${product.id}">
        ${currentQty > 0 
        ? `
          <div class="main-qty-control">
            <button class="main-qty-btn minus-btn-click" data-id="${product.id}">-</button>
            <span class="main-qty-display">${currentQty}</span>
            <button class="main-qty-btn plus-btn-click" data-id="${product.id}">+</button>
          </div>
        ` : `
          <button class="add-btn" data-id="${product.id}">কার্টে যোগ করুন</button>
        `}
      </div>
    `;
    productContainer.appendChild(productCard);
  });
}

// ৪. কার্টে প্রোডাক্ট যোগ/বিয়োগ করার গ্লোবাল লজিক
function changeQuantity(id, amount) {
  const product = productsData.find(p => p.id == id);
  if (!product) return;

  const existingItem = cart.find(item => item.id == id);
  
  if (existingItem) {
    existingItem.quantity += amount;
    if (existingItem.quantity <= 0) {
      cart = cart.filter(item => item.id != id);
    }
  } else if (amount > 0) {
    cart.push({ ...product, quantity: 1 });
  }

  updateCart();
  refreshAllProductButtons();
}

// গ্লোবাল উইন্ডো ফাংশন
window.changeQuantityGlobal = function(id, amount) {
  changeQuantity(id, amount);
};

// 🎯 ৫. অর্ডার হিস্ট্রি থেকে Delivered এবং Cancelled অর্ডার ডিলিট (Soft Delete) করার গ্লোবাল ফাংশন
window.deleteHistoryOrder = async function(orderId) {
  let orderHistory = JSON.parse(localStorage.getItem('userOrderHistory')) || [];
  const matchedOrder = orderHistory.find(order => order.orderId === orderId);

  if (!matchedOrder) return;
  const currentStat = matchedOrder.status?.trim();
  if (currentStat === "Delivered" || currentStat === "Cancelled") {
    // কাস্টম কনফার্মেশন মডাল
    showModal('emptyCartModal', "মুছে ফেলতে চান?", `আপনি কি নিশ্চিত যে (${orderId}) অর্ডারটি আপনার হিস্ট্রি থেকে মুছে ফেলতে চান?`, true, async () => {
      
      // লোকাল হিস্ট্রি (UI) থেকে মুছে ফেলা
      orderHistory = orderHistory.filter(order => order.orderId !== orderId);
      localStorage.setItem('userOrderHistory', JSON.stringify(orderHistory));
      
      // মডালটি রিয়েল-টাইমে রিফ্রেশ করা
      const historyBtn = document.getElementById('historyBtn');
      if (historyBtn) historyBtn.click(); 

      // সফট ডিলিট লজিক: গুগল শিটে ব্যাকএন্ড অডিটের জন্য স্ট্যাটাস বদলে দেওয়া
      const sheetWebhookUrl = "https://script.google.com/macros/s/AKfycbwbzm5xrmSdDVkgT8hNoEgYCR61Dztmam8bDjZ8o-6EL_tBW7r_AOKp62mGpCfinzEm/exec";
      const softDeleteData = {
        "orderId": orderId,
        "stat": "Deleted By Customer", 
        "date&time": new Date().toLocaleString('bn-BD', { hour12: true }) + " (গ্রাহক হিস্ট্রি থেকে ডিলিট করেছেন)"
      };
      try {
        await fetch(sheetWebhookUrl, {
          method: 'POST',
          mode: 'no-cors',
          body: JSON.stringify(softDeleteData)
        });
      } catch (error) {
        console.error("Failed to sync soft delete with sheet:", error);
      }
    });
  } else {
    showModal('emptyCartModal', "দুঃখিত!", "শুধুমাত্র ডেলিভার্ড বা বাতিল হওয়া অর্ডারই হিস্ট্রি থেকে মুছে ফেলা সম্ভব।", false);
  }
};

// 🎯 6. পেন্ডিং অর্ডার সরাসরি ক্যানসেল বা বাতিল করার গ্লোবাল ফাংশন
window.cancelPendingOrder = async function(orderId) {
  let orderHistory = JSON.parse(localStorage.getItem('userOrderHistory')) || [];
  const matchedOrder = orderHistory.find(order => order.orderId === orderId);

  if (!matchedOrder) return;
  if (matchedOrder.status !== "Pending") {
    showModal('emptyCartModal', "দুঃখিত!", "এই অর্ডারটি আর পেন্ডিং অবস্থায় নেই, তাই বাতিল করা যাবে না।", false);
    return;
  }

  // কাস্টম কনফার্ম পপআপ
  showModal('emptyCartModal', "বাতিল করতে চান?", `আপনি কি নিশ্চিত যে (${orderId}) অর্ডারটি বাতিল করতে চান?`, true, async () => {
    matchedOrder.status = "Cancelled";
    matchedOrder.date = new Date().toLocaleString('bn-BD', { hour12: true }) + " (বাতিলকৃত)";
    localStorage.setItem('userOrderHistory', JSON.stringify(orderHistory));

    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) historyBtn.click();

    const sheetWebhookUrl = "https://script.google.com/macros/s/AKfycbwbzm5xrmSdDVkgT8hNoEgYCR61Dztmam8bDjZ8o-6EL_tBW7r_AOKp62mGpCfinzEm/exec";
    
    const cancelData = {
      "orderId": orderId,
      "stat": "Cancelled",
      "date&time": new Date().toLocaleString('bn-BD', { hour12: true }) + " (গ্রাহক দ্বারা বাতিল)"
    };

    try {
      await fetch(sheetWebhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify(cancelData)
      });
      
      const telegramBotToken = "8703949769:AAHLuqpFfyQFegiyPR1mX8AI9MkR_rq9ISM";
      const telegramChatId = "8440157962"; 
      const telegramApiUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
      const cancelMsg = `❌ <b>ORDER CANCELLED BY CUSTOMER</b>\n\n🆔 <b>অর্ডার আইডি:</b> ${orderId}\n⏰ <b>সময়:</b> ${cancelData["date&time"]}`;
      await fetch(telegramApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramChatId, text: cancelMsg, parse_mode: 'HTML' })
      });
    } catch (error) {
      console.error("Sheet updates failed on cancel:", error);
    }
  });
};

// ৭. কার্ট আপডেট এবং স্ক্রিনে দেখানো
function updateCart() {
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  if (cartCount) cartCount.innerText = totalItems;

  cartItemsContainer.innerHTML = "";
  let productsPrice = 0;
  if (cart.length === 0) {
    cartItemsContainer.innerHTML = `<p class="empty-cart-msg" style="text-align:center; color:#888; margin-top:20px;">আপনার কার্টটি খালি আছে।</p>`;
  } else {
    cart.forEach(item => {
      const itemTotal = Number(item.price) * item.quantity;
      productsPrice += itemTotal;

      const itemDiv = document.createElement('div');
      itemDiv.classList.add('cart-item');
      itemDiv.innerHTML = `
        <div style="flex: 1; text-align: left;">
          <h4 style="margin:0; color:#fff;">${item.title}</h4>
          <p style="margin:4px 0; color:#aaa;">${item.price} x ${item.quantity}</p>
          <div class="quantity-control" style="display:flex; gap:8px; margin-top:5px;">
            <button class="qty-btn" style="padding: 2px 8px; cursor:pointer;" onclick="window.changeQuantityGlobal('${item.id}', -1)">-</button>
            <span style="font-weight:bold; color:#00f2fe;">${item.quantity}</span>
            <button class="qty-btn" style="padding: 2px 8px; cursor:pointer;" onclick="window.changeQuantityGlobal('${item.id}', 1)">+</button>
          </div>
        </div>
        <strong style="color:#00f2fe;">${itemTotal} ৳</strong>
      `;
      cartItemsContainer.appendChild(itemDiv);
    });
  }

  const deliverySelect = document.getElementById('deliveryArea');
  let deliveryCharge = 0;
  if (deliverySelect && deliverySelect.selectedIndex !== -1) {
    deliveryCharge = Number(deliverySelect.options[deliverySelect.selectedIndex].getAttribute('data-charge')) || 0;
  }

  if (cartTotal) cartTotal.innerText = productsPrice; 
  
  const subTotalEl = document.getElementById('subTotalAmount');
  const deliveryChargeEl = document.getElementById('deliveryChargeAmount');
  const totalAmountEl = document.getElementById('cartTotalAmount');
  if (subTotalEl) subTotalEl.innerText = productsPrice;
  if (deliveryChargeEl) deliveryChargeEl.innerText = deliveryCharge;
  if (totalAmountEl) totalAmountEl.innerText = (productsPrice + deliveryCharge);
}

const deliverySelectElement = document.getElementById('deliveryArea');
if (deliverySelectElement) {
  deliverySelectElement.addEventListener('change', updateCart);
}

// ৮. স্ক্রিনের সব প্রোডাক্ট কার্ড বাটন লাইভ রিফ্রেশ
function refreshAllProductButtons() {
  const allContainers = document.querySelectorAll('.product-btn-container');
  allContainers.forEach(container => {
    const id = container.id.replace('btn-container-', '');
    const isExist = cart.find(item => item.id == id);
    if (isExist && isExist.quantity > 0) {
      container.innerHTML = `
        <div class="main-qty-control">
          <button class="main-qty-btn minus-btn-click" data-id="${id}">-</button>
          <span class="main-qty-display">${isExist.quantity}</span>
          <button class="main-qty-btn plus-btn-click" data-id="${id}">+</button>
        </div>
      `;
    } else {
      container.innerHTML = `<button class="add-btn" data-id="${id}">কার্টে যোগ করুন</button>`;
    }
  });
}

// 🎯 উন্নত ও ফিক্সড মডাল মাস্টার ফাংশন (আইডি ওভাররাইট বাগ মুক্ত)
function showModal(modalId, titleText, messageText, isConfirm = false, onConfirmCallback = null) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  
  if (titleText) {
    const modalTitle = document.getElementById('emptyCartTitle') || modal.querySelector('h2') || modal.querySelector('h1') || modal.querySelector('h3');
    if (modalTitle) modalTitle.innerText = titleText;
  }
  
  if (messageText) {
    const modalMessage = document.getElementById('emptyCartMessage') || modal.querySelector('p');
    if (modalMessage) modalMessage.innerText = messageText;
  }

  if (modalId === 'emptyCartModal') {
    let actionBtn = document.getElementById('closeEmptyCartBtn');
    
    if (actionBtn) {
      if (isConfirm) {
        actionBtn.innerText = "হ্যাঁ, নিশ্চিত";
        actionBtn.style.background = "linear-gradient(135deg, #24e044, #1e9439)";
        
        let cancelBtn = document.getElementById('cancelEmptyCartBtn');
        if (!cancelBtn) {
          cancelBtn = document.createElement('button');
          cancelBtn.id = 'cancelEmptyCartBtn';
          cancelBtn.innerText = "না, ফিরে যান";
          cancelBtn.style.cssText = "margin-top:10px; background:#ff3b30; color:white; width:100%; padding:10px; border:none; border-radius:8px; font-weight:bold; cursor:pointer;";
          actionBtn.parentNode.insertBefore(cancelBtn, actionBtn.nextSibling);
        }
        cancelBtn.style.display = "block";
        cancelBtn.onclick = function() { hideModal(modal); };
        actionBtn.onclick = function() {
          if (onConfirmCallback) onConfirmCallback();
          hideModal(modal);
        };
      } else {
        actionBtn.innerText = "ঠিক আছে";
        actionBtn.style.background = ""; 
        actionBtn.onclick = function() { hideModal(modal); };
        
        let cancelBtn = document.getElementById('cancelEmptyCartBtn');
        if (cancelBtn) cancelBtn.style.display = "none";
      }
    }
  }

  modal.classList.add('open', 'active');
  modal.style.setProperty('display', 'flex', 'important');
}

// মডাল বন্ধ করার মাস্টার ফাংশন
function hideModal(modal) {
  if (!modal) return;
  modal.classList.remove('open', 'active');
  modal.style.setProperty('display', 'none', 'important');
}

// গ্লোবাল ক্লিক লিসেনার
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('add-btn')) {
    const productId = e.target.getAttribute('data-id');
    changeQuantity(productId, 1);
  }
  if (e.target.classList.contains('plus-btn-click')) {
    const productId = e.target.getAttribute('data-id');
    changeQuantity(productId, 1);
  }
  if (e.target.classList.contains('minus-btn-click')) {
    const productId = e.target.getAttribute('data-id');
    changeQuantity(productId, -1);
  }
  
  if (e.target.id === 'modalAddBtn' || e.target.closest('#modalAddBtn')) {
    const targetBtn = e.target.id === 'modalAddBtn' ? e.target : e.target.closest('#modalAddBtn');
    const productId = targetBtn.getAttribute('data-id');
    if (productId) {
      changeQuantity(productId, 1);
      hideModal(document.getElementById('productModal'));
    }
  }

  if (e.target.id === 'closeEmptyCartBtn' && !e.target.onclick) {
    hideModal(document.getElementById('emptyCartModal'));
  }
  
  if (e.target.id === 'closeSuccessBtn' || e.target.closest('#closeSuccessBtn')) {
    hideModal(document.getElementById('orderSuccessModal'));
  }

  if (e.target.id === 'closeModal' || e.target.closest('#closeModal') || e.target.classList.contains('close-modal')) {
    hideModal(document.getElementById('productModal'));
  }

  if (e.target.id === 'emptyCartModal') hideModal(e.target);
  if (e.target.id === 'orderSuccessModal') hideModal(e.target);
  if (e.target.id === 'productModal') hideModal(e.target);
  if (e.target.id === 'historyModal') hideModal(e.target);
});

// ৯. ফর্ম ন্যাভিগেশন ও খালি কার্ট পপআপ
const sliderWrapper = document.getElementById('cartSliderWrapper');
const goToCheckoutBtn = document.getElementById('goToCheckoutBtn');
const backToCartBtn = document.getElementById('backToCartBtn');

if (goToCheckoutBtn) {
  goToCheckoutBtn.addEventListener('click', function(e) {
    if (cart.length === 0) {
      showModal('emptyCartModal', "কার্ট খালি!", "আপনার কার্টটি বর্তমানে খালি রয়েছে।", false);
    } else {
      if (sliderWrapper) sliderWrapper.classList.add('slide-active');
    }
  });
}

if (backToCartBtn) {
  backToCartBtn.addEventListener('click', () => {
    if (sliderWrapper) sliderWrapper.classList.remove('slide-active');
  });
}

// ১০. ফাইনাল চেকআউট বাটন লজিক (কোরিয়ান টেক্সট ফিক্সড)
if (checkoutBtn) {
  checkoutBtn.addEventListener('click', async (event) => {
    if (event) event.preventDefault();

    const nameEl = document.getElementById('custName');
    const addressEl = document.getElementById('custAddress');
    const phoneEl = document.getElementById('custPhone');
    const deliverySelect = document.getElementById('deliveryArea');
    
    const customerName = nameEl ? nameEl.value.trim() : "";
    const customerAddress = addressEl ? addressEl.value.trim() : "";
    const customerPhone = phoneEl ? phoneEl.value.trim() : "";
    const note = document.getElementById('custNote')?.value.trim() || "নেই";
    const phoneError = document.getElementById('phoneError');

    if (!customerName || !customerAddress || !customerPhone) {
      showModal('emptyCartModal', "তথ্য বাকি আছে!", "দয়া করে নাম, ঠিকানা এবং মোবাইল নম্বর সঠিকভাবে পূরণ করুন।", false);
      return; 
    }

    const bdPhoneRegex = /^(?:\+88|88)?(01[3-9]\d{8})$/;
    if (!bdPhoneRegex.test(customerPhone)) {
      if (phoneError) phoneError.style.display = 'block';
      if (phoneEl) phoneEl.style.borderColor = '#ff3b30';
      return;
    } else {
      if (phoneError) phoneError.style.display = 'none';
      if (phoneEl) phoneEl.style.borderColor = '';
    }

    if (!deliverySelect) return;

    checkoutBtn.innerText = "অর্ডার প্রসেস হচ্ছে...";
    checkoutBtn.disabled = true;
    const selectedAreaText = deliverySelect.options[deliverySelect.selectedIndex].text;
    const subTotalBill = cart.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);
    const deliveryCharge = Number(deliverySelect.options[deliverySelect.selectedIndex].getAttribute('data-charge')) || 0;
    const finalBill = subTotalBill + deliveryCharge;
    
    const productNamesString = cart.map(item => `${item.title} (${item.quantity}টি)`).join(', ');
    const currentOrderTime = new Date().toLocaleString('bn-BD', { hour12: true });

    const isEditMode = window.currentEditingOrderId ? true : false;
    let generatedOrderId = window.currentEditingOrderId;
    if (!generatedOrderId) {
      const prefix = "SB";
      const dateStr = new Date().toISOString().slice(2,10).replace(/-/g,""); 
      const randomNum = Math.floor(1000 + Math.random() * 9000); 
      generatedOrderId = `${prefix}-${dateStr}-${randomNum}`;
    }

    const googleSheetData = {
      "date&time": currentOrderTime + (isEditMode ? " (আপডেটেড)" : ""),
      "orderId": generatedOrderId,
      "name": customerName,
      "mobile": customerPhone,
      "address": customerAddress,
      "productName": productNamesString,
      "subTotal": subTotalBill,
      "deliveryCharge": deliveryCharge,
      "total": finalBill,
      "paymentMethod": "COD", 
      "stat": "Pending",
      "courierName": "", 
      "trackingId": "",  
      "note": note
    };

    let telegramMessage = isEditMode ? `🔄 <b>SHAGORBENZ UPDATED ORDER (${generatedOrderId})</b>\n\n` : `🛒 <b>SHAGORBENZ NEW ORDER</b>\n\n`;
    telegramMessage += `👤 <b>নাম:</b> ${customerName}\n`;
    telegramMessage += `📍 <b>ঠিকানা:</b> ${customerAddress}\n`;
    telegramMessage += `📞 <b>ফোন নম্বর:</b> ${customerPhone}\n`;
    telegramMessage += `🚚 <b>ডেলিভারি এলাকা:</b> ${selectedAreaText}\n`;
    telegramMessage += `📝 <b>নোট:</b> ${note}\n\n`;
    telegramMessage += `📦 <b>অর্ডার আইটেমসমূহ:</b>\n${productNamesString}\n`;
    telegramMessage += `\n-------------------------\n`;
    telegramMessage += `💵 <b>প্রোডাক্ট মূল্য:</b> ${subTotalBill} টাকা\n`;
    telegramMessage += `➕ <b>ডেলিভারি চার্জ:</b> ${deliveryCharge} টাকা\n`;
    telegramMessage += `💰 <b>সর্বমোট প্রদেয় বিল:</b> ${finalBill} টাকা\n\n`;
    telegramMessage += `<i>(ক্যাশ অন ডেলিভারি)</i>`;

    const telegramBotToken = "8703949769:AAHLuqpFfyQFegiyPR1mX8AI9MkR_rq9ISM"; 
    const telegramChatId = "8440157962"; 
    const telegramApiUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;

    try {
      await fetch(telegramApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramChatId, text: telegramMessage, parse_mode: 'HTML' })
      });
      const sheetWebhookUrl = "https://script.google.com/macros/s/AKfycbwbzm5xrmSdDVkgT8hNoEgYCR61Dztmam8bDjZ8o-6EL_tBW7r_AOKp62mGpCfinzEm/exec";
      await fetch(sheetWebhookUrl, { 
        method: 'POST', 
        mode: 'no-cors', 
        body: JSON.stringify(googleSheetData) 
      });

      saveOrderToHistory(customerName, customerAddress, customerPhone, selectedAreaText, subTotalBill, deliveryCharge, finalBill, generatedOrderId);
      
      showModal('orderSuccessModal', "ধন্যবাদ!", "আপনার অর্ডারটি সফলভাবে নেওয়া হয়েছে । আমাদের প্রতিনিধি শীঘ্রই আপনার সাথে যোগাযোগ করবেন ।", false);
      
      cart = [];
      updateCart();
      refreshAllProductButtons();

      if (cartSidebar) cartSidebar.classList.remove('open');
      if (sliderWrapper) sliderWrapper.classList.remove('slide-active');
      
      if (nameEl) nameEl.value = "";
      if (addressEl) addressEl.value = "";
      if (phoneEl) phoneEl.value = "";
      const noteInput = document.getElementById('custNote');
      if (noteInput) noteInput.value = "";
    } catch (error) {
      console.error("Order Error: ", error);
      showModal('emptyCartModal', "দুঃখিত!", "কারিগরি সমস্যার কারণে অর্ডারটি নেওয়া যায়নি । আবার চেষ্টা করুন।", false);
    } finally {
      checkoutBtn.innerText = "অর্ডার কনফার্ম করুন"; 
      checkoutBtn.disabled = false;
    }
  });
}

// অটোমেটিক ব্যানার স্লাইডার
let currentSlide = 0;
const slider = document.getElementById('imageSlider');
const totalSlides = 3;
if (slider) {
  setInterval(() => {
    currentSlide = (currentSlide + 1) % totalSlides;
    slider.style.transform = `translateX(-${(currentSlide * 100) / totalSlides}%)`;
  }, 3000);
}

// কুইক ভিউ মডাল ডেসক্রিপশন লজিক
if (productContainer) {
  productContainer.addEventListener('click', async (e) => {
    const card = e.target.closest('.product-card');
    if (!card) return;
    if (e.target.classList.contains('add-btn') || e.target.classList.contains('main-qty-btn')) return;

    const title = card.querySelector('.product-title').innerText;
    const price = card.querySelector('.product-price').innerText;
    const image = card.querySelector('.product-image').src;
    const btn = card.querySelector('.add-btn') || card.querySelector('.main-qty-btn');
    const btnId = btn ? btn.getAttribute('data-id') : null;

    const modalImage = document.getElementById('modalImage');
    const modalTitle = document.getElementById('modalTitle');
    const modalPrice = document.getElementById('modalPrice');
    const modalDesc = document.getElementById('modalDesc');
    const modalAddBtn = document.getElementById('modalAddBtn');

    if (modalImage) modalImage.src = image;
    if (modalTitle) modalTitle.innerText = title;
    if (modalPrice) modalPrice.innerText = price;
    if (modalDesc) modalDesc.innerText = "লোডিং...";
    if (modalAddBtn && btnId) modalAddBtn.setAttribute('data-id', btnId);
    
    showModal('productModal');
    try {
      const { fetchProducts } = await import('./products.js');
      const allProducts = await fetchProducts();
      const matchedProduct = allProducts.find(p => p.id == btnId);
      
      if (modalDesc) {
        modalDesc.innerText = (matchedProduct && matchedProduct.description) ?
        matchedProduct.description : "এই প্রোডাক্টটির কোনো বিবরণ দেওয়া নেই।";
      }
    } catch (error) {
      if (modalDesc) modalDesc.innerText = "বিবরণ লোড করা যায়নি।";
    }
  });
}

// ক্যাটাগরি ফিল্টারিং লজিক
const catButtons = document.querySelectorAll('.cat-btn');
catButtons.forEach(btn => {
  btn.addEventListener('click', async (e) => {
    catButtons.forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    
    const selectedCategory = e.target.getAttribute('data-category').trim().toLowerCase();
    const allCards = document.querySelectorAll('.product-card');

    try {
      const { fetchProducts } = await import('./products.js');
      const allProducts = await fetchProducts();

      allCards.forEach(card => {
        const btnEl = card.querySelector('.add-btn') || card.querySelector('.main-qty-btn');
        const btnId = btnEl ? btnEl.getAttribute('data-id') : null;
        const matchedProduct = allProducts.find(p => p.id == btnId);
        const productCategory = matchedProduct && matchedProduct.category ? matchedProduct.category.trim().toLowerCase() : "";

        if (selectedCategory === 'all' || productCategory === selectedCategory) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    } catch (error) {
      console.error(error);
    }
  });
});

// সার্চ বার লজিক
const searchInput = document.getElementById('productSearch');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    const searchText = e.target.value.toLowerCase().trim();
    const allCards = document.querySelectorAll('.product-card');

    allCards.forEach(card => {
      const title = card.querySelector('.product-title').innerText.toLowerCase();
      card.style.display = title.includes(searchText) ? 'block' : 'none';
    });
  });
}

// ১১. অর্ডার হিস্ট্রি ডাটা সেভ করার ফাংশন
function saveOrderToHistory(customerName, customerAddress, customerPhone, selectedAreaText, subTotalBill, deliveryCharge, finalBill, customId = null) {
  let orderHistory = JSON.parse(localStorage.getItem('userOrderHistory')) || [];
  
  let generatedOrderId = customId;
  if (!generatedOrderId) {
    const prefix = "SB";
    const dateStr = new Date().toISOString().slice(2,10).replace(/-/g,"");
    const randomNum = Math.floor(1000 + Math.random() * 9000); 
    generatedOrderId = `${prefix}-${dateStr}-${randomNum}`;
  } else {
    orderHistory = orderHistory.filter(order => order.orderId !== customId);
  }

  const newOrder = {
    orderId: generatedOrderId, 
    date: new Date().toLocaleString('bn-BD', { hour12: true }) + (customId ? " (আপডেটেড)" : ""), 
    items: cart.map(item => `${item.title} (${item.quantity}টি)`).join(', '), 
    rawItems: JSON.parse(JSON.stringify(cart)), 
    subTotal: subTotalBill, 
    deliveryCharge: deliveryCharge, 
    total: finalBill, 
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
  if (orderHistory.length > 10) orderHistory.pop(); 
  localStorage.setItem('userOrderHistory', JSON.stringify(orderHistory));
  window.currentEditingOrderId = null;
}

// ১২. কাস্টমারের পেন্ডিং অর্ডার এডিট করার লজিক ফাংশন
window.editPendingOrder = function(orderId) {
  const orderHistory = JSON.parse(localStorage.getItem('userOrderHistory')) || [];
  const matchedOrder = orderHistory.find(order => order.orderId === orderId);
  
  if (!matchedOrder) return;
  if (matchedOrder.status !== "Pending") {
    showModal('emptyCartModal', "দুঃখিত!", "এই অর্ডারটি পেন্ডিং অবস্থায় নেই। তাই এডিট করা সম্ভব নয়!", false);
    return;
  }

  cart.length = 0; 
  if (matchedOrder.rawItems) {
    matchedOrder.rawItems.forEach(item => cart.push(item));
  }
  
  updateCart();
  refreshAllProductButtons();

  setTimeout(() => {
    const nameEl = document.getElementById('custName');
    const addressEl = document.getElementById('custAddress');
    const phoneEl = document.getElementById('custPhone');
    
    if (nameEl && matchedOrder.customerInfo) nameEl.value = matchedOrder.customerInfo.name || "";
    if (addressEl && matchedOrder.customerInfo) addressEl.value = matchedOrder.customerInfo.address || "";
    if (phoneEl && matchedOrder.customerInfo) phoneEl.value = matchedOrder.customerInfo.phone || "";
  }, 200);
  window.currentEditingOrderId = orderId;

  hideModal(document.getElementById('historyModal'));
  const cartSidebar = document.getElementById('cartSidebar');
  if (cartSidebar) cartSidebar.classList.add('open');
  showModal('emptyCartModal', "অর্ডার লোড হয়েছে!", `অর্ডারটি (${orderId}) সফলভাবে কার্টে লোড হয়েছে। পরিবর্তন করে আবার সাবমিট করতে পারবেন।`, false);
};

// Helper function to render history content structure
function renderHistoryModalContent(modalEl, innerHtmlContent) {
  modalEl.innerHTML = `
    <div class="modal-content" style="background:#0c0f14; border: 2px solid #00f2fe; padding:25px; max-width:480px; width:100%; text-align:center; box-shadow:0 0 25px rgba(0, 242, 254, 0.25); border-radius:12px; position:relative;">
      <h3 style="color:#00f2fe; margin-bottom:10px; border-bottom:2px solid rgba(0, 242, 254, 0.2); padding-bottom:10px; text-shadow: 0 0 8px rgba(0,242,254,0.4); display: flex; align-items: center; justify-content: center; gap: 8px;">
        <span class="material-symbols-outlined">history_edu</span> আপনার অর্ডার হিস্ট্রি
      </h3>
      ${innerHtmlContent}
      <button type="button" id="closeHistoryBtn" style="margin-top:20px; background:linear-gradient(135deg, #ff3b30, #b30000); color: white; width:100%; padding: 12px; border:none; border-radius:8px; font-weight:bold; cursor:pointer; box-shadow: 0 0 10px rgba(255,59,48,0.3); transition: 0.2s;">বন্ধ করুন</button>
    </div>
  `;
  const closeHistoryBtn = modalEl.querySelector('#closeHistoryBtn');
  if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener('click', () => hideModal(modalEl));
  }
}

// 🎯 ১৩. হিস্ট্রি মডাল পপআপ দেখানোর লাইভ লজিক (CORS এবং ক্যাশ বাগ ফিক্সড সংস্করণ)
// 🎯 ১৩. হিস্ট্রি মডাল পপআপ দেখানোর লাইভ লজিক (অনক্লিক অপ্টিমাইজড ও ফাস্ট সংস্করণ)
const historyBtn = document.getElementById('historyBtn');
if (historyBtn) {
  historyBtn.addEventListener('click', async () => {
    let historyModal = document.getElementById('historyModal');
    
    if (!historyModal) {
      historyModal = document.createElement('div');
      historyModal.id = 'historyModal';
      historyModal.classList.add('modal');
      document.body.appendChild(historyModal);
    }

    const orderHistory = JSON.parse(localStorage.getItem('userOrderHistory')) || [];

    if (orderHistory.length === 0) {
      const emptyHtml = `
        <div style="padding: 40px 20px; color:#888;">
          <span class="material-symbols-outlined" style="font-size: 48px; color: #ff3b30; margin-bottom: 10px;">production_quantity_limits</span>
          <p style="margin: 0; font-size: 16px;">আপনার আগের কোনো অর্ডারের রেকর্ড পাওয়া যায়নি!</p>
        </div>`;
      renderHistoryModalContent(historyModal, emptyHtml);
      showModal('historyModal');
    } else {
      buildHistoryList(orderHistory);
      showModal('historyModal');
      
      const sheetWebhookUrl = "https://script.google.com/macros/s/AKfycbwbzm5xrmSdDVkgT8hNoEgYCR61Dztmam8bDjZ8o-6EL_tBW7r_AOKp62mGpCfinzEm/exec";
      const cacheBuster = `&t=${new Date().getTime()}`;
      
      // ১. সবগুলো অর্ডার আইডি একসাথে কমা (,) দিয়ে যুক্ত করা হচ্ছে
      const allOrderIds = orderHistory.map(order => order.orderId).join(",");
      
      try {
        // ২. আলাদা আলাদা লুপ না চালিয়ে মাত্র ১টি রিকোয়েস্টে সব আইডি পাঠানো হচ্ছে
        const response = await fetch(`${sheetWebhookUrl}?orderIds=${allOrderIds}${cacheBuster}`);
        const resData = await response.json();
        
        if (resData && resData.status === "success" && resData.data) {
          // ৩. গুগল শিটের ম্যাপ থেকে ডেটা নিয়ে লোকাল অবজেক্ট একবারে আপডেট
          orderHistory.forEach(order => {
            const updatedData = resData.data[order.orderId];
            if (updatedData) {
              order.status = updatedData.stat; 
              order.courierName = updatedData.courierName; 
              order.trackingId = updatedData.trackingId; 
            }
          });
        }
      } catch (err) {
        console.error("Live status sync failed", err);
      }
      
      localStorage.setItem('userOrderHistory', JSON.stringify(orderHistory));
      buildHistoryList(orderHistory);
    }

    function buildHistoryList(currentOrders) {
      let html = `<div style="max-height: 380px; overflow-y: auto; text-align: left; margin-top: 15px; padding-right: 5px;">`;
      currentOrders.forEach((order) => {
        const currentStat = order.status ? order.status.trim() : "Pending";
        
        let statusColor = "#ffcc00"; 
        let statusBg = "rgba(255, 204, 0, 0.1)";
        let statusTextBengali = "পেন্ডিং";

        if (currentStat === "Processing") {
          statusColor = "#00f2fe";
          statusBg = "rgba(0, 242, 254, 0.1)";
          statusTextBengali = "প্রসেসিং";
        } else if (currentStat === "Delivered") {
          statusColor = "#4cd964";
          statusBg = "rgba(76, 217, 100, 0.1)";
          statusTextBengali = "ডেলিভার্ড";
        } else if (currentStat === "Cancelled" || currentStat === "Deleted By Customer") {
          statusColor = "#ff3b30";
          statusBg = "rgba(255, 59, 48, 0.1)";
          statusTextBengali = "বাতিল";
        }

        const isPending = currentStat === "Pending";
        const canDelete = (currentStat === "Delivered" || currentStat === "Cancelled" || currentStat === "Deleted By Customer");

        let courierHtml = '';
        if (order.courierName || order.trackingId) {
          courierHtml = `
            <div style="background: rgba(0, 242, 254, 0.05); border: 1px dashed rgba(0, 242, 254, 0.3); padding: 8px 12px; border-radius: 6px; font-size: 13px; color: #fff; margin-top: 10px; display: flex; flex-direction: column; gap: 4px;">
              ${order.courierName ? `<div>🚚 <b>কুরিয়ার:</b> ${order.courierName}</div>` : ''}
              ${order.trackingId ? `<div>📦 <b>ট্র্যাকিং আইডি:</b> <span style="color:#00f2fe; font-family: monospace; font-weight:bold;">${order.trackingId}</span></div>` : ''}
            </div>
          `;
        }

        html += `
          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(0, 242, 254, 0.15); border-radius: 8px; padding: 15px; margin-bottom: 12px; box-shadow: inset 0 0 10px rgba(0,242,254,0.02); position: relative;">
            
            ${canDelete ? `
              <button type="button" onclick="window.deleteHistoryOrder('${order.orderId}')" style="position: absolute; right: 12px; bottom: 15px; background: transparent; color: #ff3b30; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 5px; border-radius: 4px; transition: 0.2s;" title="হিস্ট্রি থেকে মুছুন">
                <span class="material-symbols-outlined" style="font-size: 20px;">delete</span>
              </button>
            ` : ''}

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding-right: 25px;">
              <strong style="color: #00f2fe; font-size: 14px; letter-spacing: 0.5px;">🆔 ${order.orderId}</strong>
              <span style="color: ${statusColor}; background: ${statusBg}; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; border: 1px solid ${statusColor}40;">
                ⏳ ${statusTextBengali}
              </span>
            </div>

            <div style="color: #888; font-size: 12px; margin-bottom: 10px;">
              ⏰ ${order.date}
            </div>
            
            <div style="margin-bottom: 12px;">
              <p style="margin: 0 0 5px 0; color: #aaa; font-size: 13px;"><b>ক্রয়কৃত প্রোডাক্টসমূহ:</b></p>
              <p style="margin: 0; color: #fff; font-size: 14px; line-height: 1.4; padding-left: 8px; border-left: 2px solid #00f2fe;">
                ${order.items}
              </p>
            </div>

            ${courierHtml}
            
            <div style="background: rgba(0,0,0,0.3); padding: 8px 12px; border-radius: 6px; font-size: 13px; color: #b0b8c4; border: 1px solid rgba(255,255,255,0.03); margin-top: 10px; margin-bottom: 10px; width: calc(100% - 30px);">
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span>প্রোডাক্ট মূল্য:</span>
                <span style="color:#fff;">${order.subTotal || 0} ৳</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span>ডেলিভারি চার্জ:</span>
                <span style="color:#fff;">${order.deliveryCharge || 0} ৳</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-weight: bold; color: #00f2fe; border-top: 1px solid rgba(255,255,255,0.08); margin-top: 6px; padding-top: 4px; font-size: 14px;">
                <span>সর্বমোট বিল:</span>
                <span style="color: #00f2fe;">${order.total || 0} ৳</span>
              </div>
            </div>

            ${isPending ? `
              <div style="display: flex; gap: 8px; width: calc(100% - 35px); margin-top: 5px;">
                <button type="button" onclick="window.editPendingOrder('${order.orderId}')" style="flex: 1; background: linear-gradient(135deg, #00f2fe, #4facfe); color: #000; font-weight: bold; border: none; padding: 8px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 13px;">
                  <span class="material-symbols-outlined" style="font-size: 16px;">edit_note</span> পরিবর্তন করুন
                </button>
                <button type="button" onclick="window.cancelPendingOrder('${order.orderId}')" style="flex: 1; background: linear-gradient(135deg, #ff3b30, #b30000); color: #fff; font-weight: bold; border: none; padding: 8px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 13px;">
                  <span class="material-symbols-outlined" style="font-size: 16px;">cancel</span> বাতিল করুন
                </button>
              </div>
            ` : ''}

          </div>
        `;
      });
      html += `</div>`;
      renderHistoryModalContent(historyModal, html);
    }
  });
}
// প্রজেক্ট রান করা
init();