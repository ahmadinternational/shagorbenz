// Storefront configuration — change business rules here, not in the UI code.

export const CONFIG = {
    // Delivery zones. The checkout form, bill and announcement bar all read this list.
    DELIVERY: [
        { id: 'inside', label: 'ঢাকার ভিতরে', charge: 80 },
        { id: 'outside', label: 'ঢাকার বাইরে', charge: 110 }
    ],

    // NOTE: coupons are validated in the browser only. Anyone can read them from the
    // bundle, so treat them as marketing codes, not security (see README/notes).
    COUPONS: {
        SB10: { type: 'percent', value: 10 },
        SB50: { type: 'flat', value: 50 },
        WELCOME: { type: 'percent', value: 15 }
    },

    // Same keys as the previous version so returning customers keep their cart.
    KEYS: {
        CART: 'shagorbenzCart',
        WISHLIST: 'shagorbenzWishlist',
        RECENT: 'shagorbenzRecentlyViewed',
        SAVED_INFO: 'shagorbenzSavedCheckoutInfo',
        DELIVERY: 'shagorbenzDeliveryArea',
        ORDERS: 'shagorbenzMyOrders', // orders placed from this browser
        LEGACY_ORDERS: 'userOrderHistory' // pre-redesign key, migrated on first load
    },

    LOW_STOCK_THRESHOLD: 5,
    RECENT_LIMIT: 8,
    MAX_SAVED_ORDERS: 30,
    PAGE_SIZE: 24,
    SCROLL_TOP_THRESHOLD: 600,
    // Shown when a product photo fails to load (dark glass tile with a neutral image glyph).
    FALLBACK_IMAGE: `data:image/svg+xml,${encodeURIComponent(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'><defs><radialGradient id='g' cx='50%' cy='38%' r='70%'><stop offset='0' stop-color='#1a2530'/><stop offset='1' stop-color='#0a0f14'/></radialGradient></defs><rect width='120' height='120' fill='url(#g)'/><path d='M38 78l16-20 12 14 8-9 14 15H38z' fill='#2c3a48'/><circle cx='47' cy='44' r='7' fill='#2c3a48'/></svg>"
    )}`
};

export const STATUS = {
    Pending: { label: 'পেন্ডিং', icon: 'hourglass', tone: 'warn', step: 1 },
    Processing: { label: 'প্রসেসিং', icon: 'refresh-cw', tone: 'info', step: 2 },
    Delivered: { label: 'ডেলিভার্ড', icon: 'circle-check', tone: 'success', step: 3 },
    Cancelled: { label: 'বাতিল', icon: 'circle-x', tone: 'danger', step: 0 }
};

const CATEGORY_ICON_RULES = [
    [/smart\s*watch|watch/, 'watch'],
    [/power\s*bank|battery/, 'battery-charging'],
    [/earbud|airpod/, 'earbuds'],
    [/earphone|headphone|headset/, 'headphones'],
    [/phone|mobile/, 'smartphone'],
    [/laptop|notebook/, 'laptop'],
    [/tablet|ipad/, 'tablet'],
    [/router|wifi|modem/, 'router'],
    [/keyboard/, 'keyboard'],
    [/mouse/, 'mouse'],
    [/charger|cable|adapter/, 'cable'],
    [/pen\s*drive|usb|memory/, 'usb'],
    [/speaker|sound/, 'speaker'],
    [/camera/, 'camera'],
    [/tv|television|monitor/, 'tv'],
    [/game|gaming/, 'gamepad-2'],
    [/humidifier|diffuser|defuser|aroma/, 'droplets'],
    [/lamp|lantern/, 'lamp'],
    [/lighter|flame/, 'flame'],
    [/light|\bled\b|bulb/, 'lightbulb'],
    [/clock|alarm/, 'clock'],
    [/fan|cooler/, 'fan'],
    [/\bcars?\b|vehicle|automotive/, 'car'],
    [/drone/, 'plane'],
    [/self\s*defen[cs]e|safety|security/, 'shield'],
    [/bank|saving/, 'piggy-bank'],
    [/banner|flag/, 'flag'],
    [/gift|toy/, 'gift'],
    [/furniture|sofa/, 'sofa'],
    [/cloth|shirt|fashion/, 'shirt'],
    [/spice|masala|grocer|rice|food/, 'wheat']
];

export function categoryIcon(name = '') {
    const key = name.toLowerCase();
    for (const [pattern, iconName] of CATEGORY_ICON_RULES) if (pattern.test(key)) return iconName;
    return 'box';
}

/** The 64 districts of Bangladesh (for the checkout form). */
export const DISTRICTS = [
    'ঢাকা', 'গাজীপুর', 'নারায়ণগঞ্জ', 'নরসিংদী', 'মানিকগঞ্জ', 'মুন্সীগঞ্জ', 'ফরিদপুর', 'গোপালগঞ্জ', 'মাদারীপুর',
    'রাজবাড়ী', 'শরীয়তপুর', 'কিশোরগঞ্জ', 'টাঙ্গাইল', 'ময়মনসিংহ', 'নেত্রকোনা', 'জামালপুর', 'শেরপুর', 'চট্টগ্রাম',
    'কক্সবাজার', 'কুমিল্লা', 'ব্রাহ্মণবাড়িয়া', 'চাঁদপুর', 'নোয়াখালী', 'ফেনী', 'লক্ষ্মীপুর', 'খাগড়াছড়ি', 'রাঙ্গামাটি',
    'বান্দরবান', 'রাজশাহী', 'নাটোর', 'নওগাঁ', 'চাঁপাইনবাবগঞ্জ', 'পাবনা', 'সিরাজগঞ্জ', 'বগুড়া', 'জয়পুরহাট', 'খুলনা',
    'বাগেরহাট', 'সাতক্ষীরা', 'যশোর', 'ঝিনাইদহ', 'মাগুরা', 'নড়াইল', 'কুষ্টিয়া', 'চুয়াডাঙ্গা', 'মেহেরপুর', 'বরিশাল',
    'পটুয়াখালী', 'ভোলা', 'পিরোজপুর', 'ঝালকাঠি', 'বরগুনা', 'সিলেট', 'মৌলভীবাজার', 'হবিগঞ্জ', 'সুনামগঞ্জ', 'রংপুর',
    'দিনাজপুর', 'গাইবান্ধা', 'কুড়িগ্রাম', 'লালমনিরহাট', 'নীলফামারী', 'পঞ্চগড়', 'ঠাকুরগাঁও'
];
