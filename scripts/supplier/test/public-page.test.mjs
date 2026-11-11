import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProductPage, originalImage, splitDescription, parseResellerPrices } from '../lib/public-page.mjs';
import { compileRules, categorize } from '../lib/categories.mjs';
import { normalizeProduct } from '../lib/feed.mjs';
import fs from 'node:fs';
import { chooseSellingPrice as choose } from '../lib/pricing.mjs';

const cf = (name, w = 640) => `/_next/image?url=${encodeURIComponent(`https://d2wuw2wo2jxqrg.cloudfront.net/uploads/${name}`)}&w=${w}&q=75`;
// Text/markup shapes below mirror what the public product pages render.
const page = (over = {}) => ({
    id: 'ABC123',
    headings: ["Badhon's World", "Badhon's World", 'Spider-Man Black Mask', 'Description', 'What our customer says about this product?', 'Spider-Man Black Mask'],
    text: ["Badhon's World", 'শপিং', 'কার্ট দেখুন', '0', '0', 'লগ ইন', '0', 'Spider-Man Black Mask', '', '৳ 2250', '', '৳ 2350', '-100৳', '0/5 (0)', '1 Sold', '', 'Available variant:', '', 'Black', 'Stock: 2', 'Red', 'Stock: 0', '', 'In Stock', '', 'Delivery time: 3-5 days', '', 'Quantity', 'Buy Now', 'Add to Cart', 'Description', '',
        'Product Name: Spider-Man Black Mask', '', 'স্পাইডার-ম্যান ব্ল্যাক মাস্ক', '', '🛒 অর্ডার করতে ইনবক্স করুন Badhon\'s World-এ।', '', 'Warranty: 7 Days', 'Return Policy: No Exchange or Return', 'Visit our Facebook group Badhon\'s World Family', 'What our customer says about this product?', 'No reviews found!', 'Recommended for you', 'Other product', '৳ 100 ৳200'].join('\n'),
    images: [
        { src: '/_next/image?url=%2Fbadhon.jpg&w=640', alt: 'logo' },
        { src: cf('1793164299557-ec57a2544df17f1fd11d57c62157ae0b.jpg', 1200), alt: 'uploads/1793164299557-ec57a2544df17f1fd11d57c62157ae0b.jpg' },
        { src: cf('1793164299557-ec57a2544df17f1fd11d57c62157ae0b.jpg'), alt: 'uploads/1793164299557-ec57a2544df17f1fd11d57c62157ae0b.jpg' },
        { src: cf('1793164299558-89dd258fc953927fbc12b36da6714659.jpg'), alt: 'uploads/1793164299558-89dd258fc953927fbc12b36da6714659.jpg' },
        { src: cf('1793164298734-ec57a2544df17f1fd11d57c62157ae0b.jpg', 828), alt: 'Spider-Man Black Mask' },
        { src: cf('1792219062079-file_c9.png', 828), alt: 'Some Other Recommended Product' },
        { src: '/images/whatsapp.png', alt: 'Whatsapp' }
    ],
    ...over
});

test('parses price, old price, variants with per-variant stock and overall availability', () => {
    const r = parseProductPage(page());
    assert.ok(r.ok);
    assert.equal(r.row.price, 2250);
    assert.equal(r.row.regular_price, 2350);
    assert.deepEqual(r.row.variants, [{ label: 'Black', stock: 2 }, { label: 'Red', stock: 0 }]);
    assert.equal(r.row.stock_status, 'in_stock');
    assert.equal(r.row.stock_quantity, 2);
    assert.equal(r.row.url, 'https://badhonsworld.com/products/ABC123');
});
test('images: original CloudFront URLs, duplicates (same picture uploaded twice) removed, recommended/other products and site chrome ignored', () => {
    const r = parseProductPage(page());
    assert.equal(r.row.images.length, 2);
    assert.ok(r.row.images.every((u) => u.startsWith('https://d2wuw2wo2jxqrg.cloudfront.net/uploads/')));
    assert.ok(!r.row.images.some((u) => /Recommended|c9\.png|badhon\.jpg|whatsapp/i.test(u)));
    assert.equal(originalImage('/_next/image?url=%2Fbadhon.jpg&w=640'), null);
});
test('supplier boilerplate (warranty, return policy, "inbox Badhon\'s World", group link) is not carried into the description', () => {
    const { row } = parseProductPage(page());
    assert.ok(row.description.includes('স্পাইডার-ম্যান ব্ল্যাক মাস্ক'));
    assert.ok(!/warranty|return policy|ইনবক্স|facebook/i.test(row.description));
});
test('technical specifications are moved into a table (not duplicated in the text); brand only from the supplier\'s own "Brand:" line', () => {
    const { description, specifications } = splitDescription('Intro line\n\n⚙️ Technical Specifications\n\n- Brand: Hoco\n\n- Model: EQ34 Plus\n\n- Color: Black\n\nImportant note: values may vary.');
    assert.deepEqual(specifications.map((s) => [s.label, s.value]), [['Brand', 'Hoco'], ['Model', 'EQ34 Plus'], ['Color', 'Black']]);
    assert.ok(description.includes('Intro line') && description.includes('Important note') && !description.includes('EQ34'));
    const r = parseProductPage(page({ text: page().text.replace('Product Name: Spider-Man Black Mask', '⚙️ Technical Specifications\n\n- Brand: Hoco\n\n- Model: X1') }));
    assert.equal(r.row.brand, 'Hoco');
    assert.equal(parseProductPage(page()).row.brand, null, 'no Brand line → brand stays empty');
});
test('a product with no old price, no variants: out-of-stock text is respected', () => {
    const text = page().text.replace('৳ 2350\n', '').replace(/Available variant:[\s\S]*?In Stock/, 'Out of Stock');
    const r = parseProductPage(page({ text }));
    assert.equal(r.row.regular_price, undefined);
    assert.deepEqual(r.row.variants, []);
    assert.equal(r.row.stock_status, 'out_of_stock');
});
test('pages that cannot be read are refused, never guessed', () => {
    assert.equal(parseProductPage(page({ headings: ["Badhon's World"] })).ok, false);
    assert.equal(parseProductPage(page({ text: page().text.replace('৳ 2250', 'N/A').replace('৳ 2350', '') })).ok, false);
});
test('a parsed row is accepted by the importer\'s own validation', () => {
    const r = parseProductPage(page());
    const n = normalizeProduct(r.row, { supplier: 'badhons-world' });
    assert.ok(n.ok, n.error);
    assert.equal(n.record.variants.length, 2);
});
test('category rules: first match wins, unmatched stay empty', () => {
    const rules = compileRules(JSON.parse(fs.readFileSync(new URL('../category-rules.json', import.meta.url), 'utf8')));
    const c = (t) => categorize(t, rules);
    assert.equal(c('QIF QY-54 Mini PD30W Power Bank – 10000mAh'), 'Power Bank');
    assert.equal(c('SSOMFEX Mushroom Lamp Humidifier'), 'Humidifier');
    assert.equal(c('Kuromi LED Night Light with Pen Holder'), 'Lamp');
    assert.equal(c('Naruto Money Bank / Naruto Coin Bank'), 'Bank');
    assert.equal(c('Pokémon Mystery Character Blind Box (per piece)'), 'Mystery Box');
    assert.equal(c('Cristiano Ronaldo Mini Football Figure'), 'Figures & Collectibles');
    assert.equal(c('Golden Football Trophy Keychain'), 'Football Collectibles');
    assert.equal(c('ONIKUMA K19 Professional Gaming Headset'), 'Headphones');
    assert.equal(c('Spider-Man Black Mask'), 'Toys & Games');
    assert.equal(c('Smart Scalp Massager (A grade)'), 'Personal Care');
    assert.equal(c('SSOMEX TL16 Mobile Phone Cooling Fan'), 'Fan', 'earlier, more specific rule wins');
    assert.equal(c('A totally unrelated thing'), null, 'no rule → stays empty (importer uses Other)');
});

test('reseller view: buy rate, commission, minimum selling price and the price shown to resellers', () => {
    const text = page().text.replace('৳ 2250\n\n৳ 2350\n-100৳', '৳ 1209\nBuy rate: 699৳\nCommission: 510৳\nMinimum selling price: 749৳');
    const rp = parseResellerPrices(page({ text }));
    assert.deepEqual(rp, { shownPrice: 1209, buyRate: 699, commission: 510, minSellingPrice: 749 });
    assert.equal(parseResellerPrices(page()), null, 'public page has no reseller block');
});
test('reseller-view page still parses as a normal product page (variants, images, description)', () => {
    const text = page().text.replace('৳ 2250\n\n৳ 2350\n-100৳', '৳ 1209\nBuy rate: 699৳\nCommission: 510৳\nMinimum selling price: 749৳');
    const r = parseProductPage(page({ text }));
    assert.ok(r.ok);
    assert.equal(r.row.price, 1209);
    assert.equal(r.row.variants.length, 2);
});

test('titles with double spaces in the heading (innerText collapses them) are still matched, and stored with single spaces', () => {
    const r = parseProductPage(page({ headings: ["Badhon's World", 'Spider-Man  Black   Mask', 'Description'], images: page().images.map((i) => (i.alt === 'Spider-Man Black Mask' ? { ...i, alt: 'Spider-Man  Black Mask' } : i)) }));
    assert.ok(r.ok, r.error);
    assert.equal(r.row.title, 'Spider-Man Black Mask');
    assert.equal(r.row.images.length, 2);
});

test('selling price policy: lowest of public/reseller, never below the supplier minimum', () => {
    assert.deepEqual(choose({ publicPrice: 1280, resellerPrice: 1209, minPrice: 749 }), { price: 1209, source: 'reseller' });
    assert.deepEqual(choose({ publicPrice: 7550, resellerPrice: 8390, minPrice: 5290 }), { price: 7550, source: 'public' }, 'supplier website must not undercut the shop');
    assert.deepEqual(choose({ publicPrice: 500, resellerPrice: 500, minPrice: 400 }), { price: 500, source: 'both' });
    assert.deepEqual(choose({ publicPrice: 300, resellerPrice: 320, minPrice: 350 }), { price: 350, source: 'minimum' }, 'floor = minimum selling price');
    assert.deepEqual(choose({ policy: 'reseller', publicPrice: 7550, resellerPrice: 8390, minPrice: 5290 }), { price: 8390, source: 'reseller' });
    assert.deepEqual(choose({ policy: 'public', publicPrice: 1280, resellerPrice: 1209 }), { price: 1280, source: 'public' });
    assert.deepEqual(choose({ publicPrice: 999 }), { price: 999, source: 'public' }, 'no reseller data → public price');
    assert.equal(choose({ publicPrice: 0, resellerPrice: 0, minPrice: 0 }), null, 'a ৳0 listing has no usable price');
});
