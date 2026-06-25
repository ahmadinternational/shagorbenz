import { fetchProducts } from './products.js';

// আপনার ব্র্যান্ডের জন্য ডেডিকেটেড হোয়াটসঅ্যাপ নাম্বার (Country code সহ)
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
    productContainer.innerHTML = "<p>কোনো প্রোডাক্ট পাওয়া যায়নি। দয়া করে গুগল শিট চেক করুন।</p>";
    return;
  }
  
  renderProducts(productsData);
}

// ৩. স্ক্রিনে প্রোডাক্ট কার্ডগুলো দেখানো (প্লাস-মাইনাস ও ডাইনামিক বাটনসহ)
function renderProducts(products) {
  productContainer.innerHTML = ""; // আগের টেক্সট ক্লিয়ার করা
  
  products.forEach(product => {
    const productCard = document.createElement('div');
    productCard.classList.add('product-card');
    
    const cartItem = cart.find(item => item.id === product.id);
    const currentQty = cartItem ? cartItem.quantity : 0;
    
    productCard.innerHTML = `
      <img class="product-image" src="${product.image || 'https://via.placeholder.com/250'}" alt="${product.title}">
      <h3 class="product-title">${product.title}</h3>
      <p class="product-price">${product.price} টাকা</p>
      
      <div class="product-btn-container" id="btn-container-${product.id}">
        ${currentQty > 0 ? `
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

// ৪. কার্টে প্রোডাক্ট যোগ/বিয়োগ করার গ্লোবাল লজিক (কোয়ান্টিটি চেঞ্জার)
function changeQuantity(id, amount) {
  const product = productsData.find(p => p.id === id);
  if (!product) return;

  const existingItem = cart.find(item => item.id === id);
  
  if (existingItem) {
    existingItem.quantity += amount;
    if (existingItem.quantity <= 0) {
      cart = cart.filter(item => item.id !== id);
    }
  } else if (amount > 0) {
    cart.push({ ...product, quantity: 1 });
  }

  updateCart();
  refreshAllProductButtons();
}

// ৫. কার্ট আপডেট এবং স্ক্রিনে দেখানো (ডেলিভারি চার্জ হিসাবসহ)
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
        <div style="flex: 1;">
          <h4>${item.title}</h4>
          <p>${item.price} x ${item.quantity}</p>
          <div class="quantity-control" style="display:flex; gap:8px; margin-top:5px;">
            <button class="qty-btn" style="padding: 2px 8px; cursor:pointer;" onclick="window.changeQuantityGlobal('${item.id}', -1)">-</button>
            <span style="font-weight:bold; color:#00f2fe;">${item.quantity}</span>
            <button class="qty-btn" style="padding: 2px 8px; cursor:pointer;" onclick="window.changeQuantityGlobal('${item.id}', 1)">+</button>
          </div>
        </div>
        <strong>${itemTotal} ৳</strong>
      `;
      cartItemsContainer.appendChild(itemDiv);
    });
  }

  // ডেলিভারি চার্জ হিসাব করা
  const deliverySelect = document.getElementById('deliveryArea');
  let deliveryCharge = 0;
  if (deliverySelect) {
    deliveryCharge = Number(deliverySelect.options[deliverySelect.selectedIndex].getAttribute('data-charge')) || 0;
  }

  // স্ক্রিনে দামগুলো লাইভ আপডেট করা
  if (cartTotal) cartTotal.innerText = productsPrice; // সাইডবারের জন্য
  
  const subTotalEl = document.getElementById('subTotalAmount');
  const deliveryChargeEl = document.getElementById('deliveryChargeAmount');
  const totalAmountEl = document.getElementById('cartTotalAmount');

  if (subTotalEl) subTotalEl.innerText = productsPrice;
  if (deliveryChargeEl) deliveryChargeEl.innerText = deliveryCharge;
  if (totalAmountEl) totalAmountEl.innerText = (productsPrice + deliveryCharge);
}

// গ্লোবাল এক্সেস দেওয়ার জন্য উইন্ডো অবজেক্টে বাইন্ড করা
window.changeQuantityGlobal = changeQuantity;

// কাস্টমার ড্রপডাউন চেঞ্জ করলে যেন সাথে সাথে বিল আপডেট হয়
const deliverySelectElement = document.getElementById('deliveryArea');
if (deliverySelectElement) {
  deliverySelectElement.addEventListener('change', updateCart);
}

// ৬. স্ক্রিনের সব প্রোডাক্ট কার্ড বাটন একসাথে লাইভ আপডেট করার ফাংশন
function refreshAllProductButtons() {
  const allContainers = document.querySelectorAll('.product-btn-container');
  allContainers.forEach(container => {
    const id = container.id.replace('btn-container-', '');
    const isExist = cart.find(item => item.id === id);
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

// 🎯 ৭. গ্লোবাল ক্লিক লিসেনার
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
  if (e.target.id === 'modalAddBtn') {
    const productId = e.target.getAttribute('data-id') || document.getElementById('modalAddBtn')?.getAttribute('data-id');
    if (productId) {
      changeQuantity(productId, 1);
      const modal = document.getElementById('productModal');
      if (modal) modal.classList.remove('open');
    }
  }
});

// ৮. মাল্টি-স্লাইড ফর্ম ন্যাভিগেশন ও হোয়াটসঅ্যাপে ফাইনাল অর্ডার পাঠানো
const sliderWrapper = document.getElementById('cartSliderWrapper');
const goToCheckoutBtn = document.getElementById('goToCheckoutBtn');
const backToCartBtn = document.getElementById('backToCartBtn');

// 🛠️ ফিক্সড কন্ডিশন (কার্ট খালি কি না চেক করার লজিক)
if (goToCheckoutBtn) {
  goToCheckoutBtn.addEventListener('click', function() {
    if (cart.length === 0) {
      document.getElementById('emptyCartModal').style.display = 'flex';
    } else {
      if (sliderWrapper) sliderWrapper.classList.add('slide-active');
    }
  });
}

const closeEmptyCartBtn = document.getElementById('closeEmptyCartBtn');
if (closeEmptyCartBtn) {
  closeEmptyCartBtn.addEventListener('click', function() {
    document.getElementById('emptyCartModal').style.display = 'none';
  });
}

if (backToCartBtn) {
  backToCartBtn.addEventListener('click', () => {
    if (sliderWrapper) sliderWrapper.classList.remove('slide-active');
  });
}

// ফাইনাল চেকআউট বাটন লজিক
if (checkoutBtn) {
  checkoutBtn.addEventListener('click', async () => {
    const nameEl = document.getElementById('name') || document.getElementById('custName');
    const addressEl = document.getElementById('address') || document.getElementById('custAddress');
    const phoneEl = document.getElementById('phone') || document.getElementById('custPhone');
    const deliverySelect = document.getElementById('deliveryArea');
    
    if (nameEl && addressEl && phoneEl && deliverySelect) {
      const name = nameEl.value.trim();
      const address = addressEl.value.trim();
      const phone = phoneEl.value.trim();
      const note = document.getElementById('note')?.value.trim() || document.getElementById('custNote')?.value.trim() || "নেই";
      const phoneError = document.getElementById('phoneError');

      const bdPhoneRegex = /^(?:\+88|88)?(01[3-9]\d{8})$/;

      if (!name || !address || !phone) {
        alert("দয়া করে সবগুলো স্টার (*) চিহ্নিত ঘরগুলো পূরণ করুন।");
        return;
      }

      if (!bdPhoneRegex.test(phone)) {
        if (phoneError) phoneError.style.display = 'block';
        phoneEl.style.borderColor = '#ff3b30';
        return;
      } else {
        if (phoneError) phoneError.style.display = 'none';
        phoneEl.style.borderColor = '';
      }

      checkoutBtn.innerText = "অর্ডার প্রসেস হচ্ছে...";
      checkoutBtn.disabled = true;

      const selectedAreaText = deliverySelect.options[deliverySelect.selectedIndex].text;
      
      let subTotalBill = 0;
      cart.forEach(item => {
        subTotalBill += Number(item.price) * item.quantity;
      });
      const deliveryCharge = Number(deliverySelect.options[deliverySelect.selectedIndex].getAttribute('data-charge')) || 0;
      const finalBill = subTotalBill + deliveryCharge;

      let message = `🛒 <b>নতুন অর্ডার এসেছে - SHAGORBENZ</b>\n\n`;
      message += `👤 <b>নাম:</b> ${name}\n`;
      message += `📍 <b>ঠিকানা:</b> ${address}\n`;
      message += `📞 <b>ফোন নম্বর:</b> ${phone}\n`;
      message += `🚚 <b>ডেলিভারি এলাকা:</b> ${selectedAreaText}\n`;
      message += `📝 <b>নোট:</b> ${note}\n\n`;
      message += `📦 <b>অর্ডার আইটেমসমূহ:</b>\n`;
      
      cart.forEach((item, index) => {
        message += `${index + 1}. ${item.title} (পরিমাণ: ${item.quantity}) - ${Number(item.price) * item.quantity} টাকা\n`;
      });
      
      message += `\n-------------------------\n`;
      message += `💵 <b>প্রোডাক্ট মূল্য:</b> ${subTotalBill} টাকা\n`;
      message += `➕ <b>ডেলিভারি চার্জ:</b> ${deliveryCharge} টাকা\n`;
      message += `💰 <b>সর্বমোট প্রদেয় বিল:</b> ${finalBill} টাকা\n\n`;
      message += `<i>(ক্যাশ অন ডেলিভারি)</i>`;

      const telegramBotToken = "8703949769:AAHLuqpFfyQFegiyPR1mX8AI9MkR_rq9ISM"; 
      const telegramChatId = "8440157962"; 

      const apiUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
      
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramChatId,
            text: message,
            parse_mode: 'HTML'
          })
        });

        const result = await response.json();

        if (result.ok) {
          document.getElementById('orderSuccessModal').style.display = 'flex';
          
          cart = [];
          updateCart();
          refreshAllProductButtons();
          
          if (cartSidebar) cartSidebar.classList.remove('open');
          if (sliderWrapper) sliderWrapper.classList.remove('slide-active');
          
          nameEl.value = "";
          addressEl.value = "";
          phoneEl.value = "";
          const noteInput = document.getElementById('note') || document.getElementById('custNote');
          if (noteInput) noteInput.value = "";
        } else {
          throw new Error(result.description);
        }

      } catch (error) {
        console.error("Telegram Order Error: ", error);
        alert("দুঃখিত, কারিগরি সমস্যার কারণে অর্ডারটি নেওয়া যায়নি। আবার চেষ্টা করুন।");
      } finally {
        checkoutBtn.innerText = "অর্ডার কনফার্ম করুন"; 
        checkoutBtn.disabled = false;
      }
    }
  });
}

const closeSuccessBtn = document.getElementById('closeSuccessBtn');
if (closeSuccessBtn) {
  closeSuccessBtn.addEventListener('click', function() {
    document.getElementById('orderSuccessModal').style.display = 'none';
  });
}

// অটোমেটিক ব্যানার স্লাইডার লজিক
let currentSlide = 0;
const slider = document.getElementById('imageSlider');
const totalSlides = 3;

if (slider) {
  setInterval(() => {
    currentSlide = (currentSlide + 1) % totalSlides;
    slider.style.transform = `translateX(-${(currentSlide * 100) / totalSlides}%)`;
  }, 3000);
}

// কুইক ভিউ মডাল ডেসক্রিপশন রিড লজিক
const productContainerEl = document.getElementById('productContainer');
if (productContainerEl) {
  productContainerEl.addEventListener('click', async (e) => {
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
    const productModal = document.getElementById('productModal');

    if (modalImage) modalImage.src = image;
    if (modalTitle) modalTitle.innerText = title;
    if (modalPrice) modalPrice.innerText = price;
    if (modalDesc) modalDesc.innerText = "লোডিং...";
    if (modalAddBtn && btnId) modalAddBtn.setAttribute('data-id', btnId);
    if (productModal) productModal.classList.add('open');

    try {
      const { fetchProducts } = await import('./products.js');
      const allProducts = await fetchProducts();
      const matchedProduct = allProducts.find(p => p.title.trim() === title.trim() || p.id === btnId);
      
      if (modalDesc) {
        if (matchedProduct && matchedProduct.description) {
          modalDesc.innerText = matchedProduct.description;
        } else {
          modalDesc.innerText = "এই প্রোডাক্টটির কোনো বিবরণ দেওয়া নেই।";
        }
      }
    } catch (error) {
      if (modalDesc) modalDesc.innerText = "বিবরণ লোড করা যায়নি।";
    }
  });
}

// মডাল ক্লোজ লজিক
document.addEventListener('click', (e) => {
  if (e.target.id === 'closeModal' || e.target.classList.contains('close-modal')) {
    const modal = document.getElementById('productModal');
    if (modal) modal.classList.remove('open');
  }
  if (e.target.id === 'productModal') {
    e.target.classList.remove('open');
  }
});

// টোস্ট নোটিফিকেশন অবজার্ভার
if (cartCount) {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        const newCount = cartCount.innerText.trim();
        
        
      }
    });
  });
  observer.observe(cartCount, { childList: true });
}

// টোস্ট নোটিফিকেশন (UI)
function showToast(message) {
  const container = document.getElementById('toastContainer');
  if (!container) {
    return;
  }

  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.textContent = message;

  container.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3200);
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
        
        const matchedProduct = allProducts.find(p => p.id === btnId);
        const productCategory = matchedProduct && matchedProduct.category ? matchedProduct.category.trim().toLowerCase() : "";

        if (selectedCategory === 'all') {
          card.style.display = 'block';
        } else {
          if (productCategory === selectedCategory) {
            card.style.display = 'block';
          } else {
            card.style.display = 'none';
          }
        }
      });
    } catch (error) {
      console.error(error);
    }
  });
});

// রিয়েল-টাইম প্রোডাক্ট সার্চ বার লজিক
const searchInput = document.getElementById('productSearch');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    const searchText = e.target.value.toLowerCase().trim();
    const allCards = document.querySelectorAll('.product-card');

    const catButtonsInner = document.querySelectorAll('.cat-btn');
    catButtonsInner.forEach(b => b.classList.remove('active'));
    const allCatBtn = document.querySelector('.cat-btn[data-category="all"]');
    if (allCatBtn) allCatBtn.classList.add('active');

    allCards.forEach(card => {
      const title = card.querySelector('.product-title').innerText.toLowerCase();
      if (title.includes(searchText)) {
        card.style.display = 'block';
      } else {
        card.style.display = 'none';
      }
    });

    const visibleCards = Array.from(allCards).filter(c => c.style.display !== 'none');
    const existingNoProductMsg = document.getElementById('noProductMsg');
    
    if (visibleCards.length === 0) {
      if (!existingNoProductMsg) {
        const noProductMsg = document.createElement('p');
        noProductMsg.id = 'noProductMsg';
        noProductMsg.style.cssText = 'text-align: center; color: #888; margin-top: 20px; width: 100%; grid-column: 1/-1;';
        noProductMsg.innerText = 'দুঃখিত, এই নামে কোনো প্রোডাক্ট পাওয়া যায়নি!';
        productContainer.appendChild(noProductMsg);
      }
    } else {
      if (existingNoProductMsg) existingNoProductMsg.remove();
    }
  });
}

// প্রজেক্ট চালু করা
init();