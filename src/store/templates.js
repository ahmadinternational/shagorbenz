// Pure HTML builders. Every dynamic value is escaped here, so callers can set innerHTML safely.

import { escapeHtml as esc, formatNumber, formatPrice, formatDateTime, icon } from '../lib/utils.js';
import { CONFIG, DISTRICTS, STATUS, categoryIcon } from './config.js';
import {
    hasPriceRange, hasVariants, isSoldOut, lineKey, oldPriceOf, priceOf, stockOf, variantOf
} from './api.js';

/** Percent off for a product (its cheapest option when it has options) or for one chosen option. */
export function discountPercent(p, v = null) {
    const price = v ? priceOf(p, v) : p.price;
    const old = v ? oldPriceOf(p, v) : p.oldPrice;
    return old > price && old > 0 ? Math.round(100 - (price / old) * 100) : 0;
}

const img = (src) => esc(src || CONFIG.FALLBACK_IMAGE);

export { esc, icon as iconHtml };

export const pillLabel = (label) => `${esc(label)}${icon('x')}`;

// ───────────────────────── Shared bits ─────────────────────────

export function ratingBadge(stat) {
    if (!stat?.count) return '';
    return `<span class="rating">${icon('star', 'icon-fill')}<b>${stat.avg.toFixed(1)}</b><span>(${formatNumber(stat.count)})</span></span>`;
}

export function starRow(avg) {
    const full = Math.round(avg);
    return `<span class="stars" role="img" aria-label="${avg.toFixed(1)} স্টার">${[1, 2, 3, 4, 5]
        .map((n) => icon('star', n <= full ? 'icon-fill' : 'is-empty'))
        .join('')}</span>`;
}

export function emptyState({ iconName = 'inbox', title, text = '', actionLabel = '', action = '' }) {
    return `<div class="empty">
        <span class="empty-icon">${icon(iconName)}</span>
        <h3>${esc(title)}</h3>
        ${text ? `<p>${esc(text)}</p>` : ''}
        ${actionLabel ? `<button type="button" class="btn btn-primary" data-action="${esc(action)}">${esc(actionLabel)}</button>` : ''}
    </div>`;
}

/** `key` is the cart-line key (see lineKey): product id, or "id~option" for an option line. */
export function qtyControl(key, qty, max = Infinity, size = '') {
    const atMax = qty >= max;
    return `<div class="qty ${size}" role="group" aria-label="পরিমাণ">
        <button type="button" class="qty-btn" data-action="decrease-qty" data-key="${esc(key)}" aria-label="কমান">${icon('minus')}</button>
        <output class="qty-val" aria-live="polite">${formatNumber(qty)}</output>
        <button type="button" class="qty-btn" data-action="increase-qty" data-key="${esc(key)}" aria-label="বাড়ান" ${atMax ? 'disabled' : ''}>${icon('plus')}</button>
    </div>`;
}

// ───────────────────────── Product card ─────────────────────────

export function cardAction(p, qty) {
    if (isSoldOut(p)) return `<button type="button" class="btn btn-add" disabled>স্টক নেই</button>`;
    if (hasVariants(p))
        return `<button type="button" class="btn btn-add" data-action="open-product" data-id="${esc(p.id)}">অপশন বাছুন</button>`;
    if (qty > 0) return qtyControl(p.id, qty, stockOf(p));
    return `<button type="button" class="btn btn-add" data-action="add-to-cart" data-id="${esc(p.id)}">${icon('shopping-bag')}কার্টে যোগ করুন</button>`;
}

export function wishButton(id, active, extra = '') {
    return `<button type="button" class="wish-btn ${extra} ${active ? 'is-active' : ''}" data-action="toggle-wishlist" data-id="${esc(id)}" aria-pressed="${active}" aria-label="${active ? 'পছন্দ থেকে সরান' : 'পছন্দে যোগ করুন'}">${icon('heart', active ? 'icon-fill' : '')}</button>`;
}

const MAX_SWATCHES = 5;
function swatches(p) {
    const shown = p.variants.slice(0, MAX_SWATCHES);
    const more = p.variants.length - shown.length;
    return `<div class="swatches" aria-hidden="true">${shown
        .map((v) =>
            v.image
                ? `<span class="swatch" title="${esc(v.label)}"><img src="${esc(v.image)}" alt="" loading="lazy" /></span>`
                : `<span class="swatch swatch-text" title="${esc(v.label)}">${esc([...v.label][0] || '')}</span>`
        )
        .join('')}${more > 0 ? `<span class="swatch swatch-more">+${formatNumber(more)}</span>` : ''}</div>`;
}

export function productCard(p, { qty = 0, wished = false, stat = null } = {}) {
    const sold = isSoldOut(p);
    const multi = hasVariants(p);
    const pct = discountPercent(p);
    const left = stockOf(p);
    const low = !sold && !multi && left <= CONFIG.LOW_STOCK_THRESHOLD;
    const badge = sold
        ? '<span class="badge badge-out">স্টক নেই</span>'
        : pct
          ? `<span class="badge badge-sale">−${formatNumber(pct)}%</span>`
          : '';

    return `<article class="product-card ${sold ? 'is-sold' : ''}" data-product-id="${esc(p.id)}">
        <div class="product-media" data-action="open-product" data-id="${esc(p.id)}">
            <img src="${img(p.image)}" alt="${esc(p.title)}" loading="lazy" decoding="async" width="400" height="400" />
            ${badge}
            ${multi ? `<span class="opt-badge">${formatNumber(p.variants.length)}টি অপশন</span>` : ''}
            ${low ? `<span class="stock-note">মাত্র ${formatNumber(left)}টি বাকি</span>` : ''}
            ${wishButton(p.id, wished)}
        </div>
        <div class="product-body">
            <h3 class="product-title"><button type="button" class="product-link" title="${esc(p.title)}" data-action="open-product" data-id="${esc(p.id)}">${esc(p.title)}</button></h3>
            <div class="rating-slot" data-slot="rating">${ratingBadge(stat)}</div>
            <div class="price-row">
                ${hasPriceRange(p) ? '<span class="price-from">থেকে</span>' : ''}
                <span class="price">${formatPrice(p.price)}</span>
                ${pct ? `<span class="price-old">${formatPrice(p.oldPrice)}</span>` : ''}
            </div>
            ${multi ? swatches(p) : ''}
        </div>
        <div class="product-cta" data-slot="cta">${cardAction(p, qty)}</div>
    </article>`;
}

export const skeletonCard = () => `<div class="product-card skeleton-card" aria-hidden="true">
    <div class="product-media skeleton"></div>
    <div class="product-body">
        <span class="skeleton line w-40"></span>
        <span class="skeleton line w-90"></span>
        <span class="skeleton line w-60"></span>
    </div>
    <div class="product-cta"><span class="skeleton btn-skel"></span></div>
</div>`;

// ───────────────────────── Product detail ─────────────────────────

export function detailActions(p, v, qty, wished = false) {
    const wish = wishButton(p.id, wished, 'wish-inline');
    if (hasVariants(p) && !v) {
        if (isSoldOut(p)) return `<div class="detail-actions"><button type="button" class="btn btn-primary btn-lg" disabled>স্টক নেই</button>${wish}</div>`;
        return `<div class="detail-actions"><button type="button" class="btn btn-primary btn-lg" data-action="need-option">অপশন বাছুন</button>${wish}</div>`;
    }
    if (isSoldOut(p, v)) {
        return `<div class="detail-actions"><button type="button" class="btn btn-primary btn-lg" disabled>স্টক নেই</button>${wish}</div>`;
    }
    const attrs = `data-id="${esc(p.id)}"${v ? ` data-variant="${esc(v.id)}"` : ''}`;
    if (qty > 0) {
        return `<div class="detail-actions">
            ${qtyControl(lineKey(p.id, v?.id), qty, stockOf(p, v), 'qty-lg')}
            <button type="button" class="btn btn-primary btn-lg" data-action="open-cart">কার্ট দেখুন</button>
            ${wish}
        </div>`;
    }
    return `<div class="detail-actions">
        <button type="button" class="btn btn-primary btn-lg" data-action="add-to-cart" ${attrs}>${icon('shopping-bag')}কার্টে যোগ করুন</button>
        <button type="button" class="btn btn-brand btn-lg" data-action="buy-now" ${attrs}>এখনই কিনুন</button>
        ${wish}
    </div>`;
}

function optionPicker(p, v) {
    return `<fieldset class="options" id="optionPicker">
        <legend>অপশন বাছুন${v ? `: <b>${esc(v.label)}</b>` : ''}</legend>
        <div class="option-list">${p.variants
            .map((x) => {
                const selected = v?.id === x.id;
                const out = isSoldOut(p, x);
                return `<button type="button" class="option ${x.image ? '' : 'option-text'} ${selected ? 'is-selected' : ''} ${out ? 'is-out' : ''}" data-action="select-variant" data-variant="${esc(x.id)}" aria-pressed="${selected}">
                    ${x.image ? `<img src="${esc(x.image)}" alt="" width="36" height="36" loading="lazy" />` : ''}
                    <span>${esc(x.label)}</span>${out ? '<small>স্টক নেই</small>' : ''}
                </button>`;
            })
            .join('')}</div>
    </fieldset>`;
}

/** The top half of the dialog; re-rendered when an option is picked (reviews below are left alone). */
export function detailMain(p, { variantId = null, qty = 0, wished = false, stat = null, deliveryNote = '' } = {}) {
    const v = variantOf(p, variantId);
    const shownPrice = v ? priceOf(p, v) : p.price;
    const shownOld = v ? oldPriceOf(p, v) : p.oldPrice;
    const range = !v && hasPriceRange(p);
    const pct = range ? 0 : shownOld > shownPrice && shownOld > 0 ? Math.round(100 - (shownPrice / shownOld) * 100) : 0;

    const sold = isSoldOut(p, v);
    const left = stockOf(p, v);
    const low = !sold && Number.isFinite(left) && left <= CONFIG.LOW_STOCK_THRESHOLD && (v || !hasVariants(p));
    const stockClass = sold ? 'is-out' : low ? 'is-low' : 'is-in';
    const stockText = sold ? 'স্টক নেই' : low ? `মাত্র ${formatNumber(left)}টি বাকি — দ্রুত অর্ডার করুন` : 'স্টকে আছে';
    const image = v?.image || p.image;

    return `<div class="detail-grid">
        <div class="detail-media"><img src="${img(image)}" alt="${esc(p.title)}" width="640" height="640" /></div>
        <div class="detail-info">
            ${p.category ? `<span class="product-cat">${esc(p.category)}</span>` : ''}
            <h2 class="detail-title">${esc(p.title)}</h2>
            <div class="detail-rating" id="detailRating">${stat?.count ? `${starRow(stat.avg)}<span>${stat.avg.toFixed(1)} · ${formatNumber(stat.count)}টি রিভিউ</span>` : '<span class="muted">এখনো কোনো রিভিউ নেই</span>'}</div>
            <div class="detail-price">
                ${range ? '<span class="price-from">থেকে</span>' : ''}
                <span class="price price-lg">${formatPrice(shownPrice)}</span>
                ${pct ? `<span class="price-old">${formatPrice(shownOld)}</span><span class="badge badge-sale">−${formatNumber(pct)}% ছাড়</span>` : ''}
            </div>
            <p class="stock-pill ${stockClass}"><span class="dot"></span>${esc(stockText)}</p>
            ${hasVariants(p) ? optionPicker(p, v) : ''}
            <div id="detailActions" data-pid="${esc(p.id)}">${detailActions(p, v, qty, wished)}</div>
            ${p.description ? `<p class="detail-desc">${esc(p.description)}</p>` : ''}
            <ul class="perks">
                <li>${icon('truck')}<span>${esc(deliveryNote)}</span></li>
                <li>${icon('headset')}<span>অর্ডার নিয়ে প্রশ্ন? হোয়াটসঅ্যাপে মেসেজ করুন</span></li>
            </ul>
        </div>
    </div>`;
}

export function productDetail(p, ctx = {}) {
    return `<div id="detailMain">${detailMain(p, ctx)}</div>
    <section class="reviews" aria-labelledby="reviewsTitle">
        <div class="reviews-head">
            <h3 id="reviewsTitle">গ্রাহক রিভিউ</h3>
            <span class="muted" id="reviewSummary"></span>
        </div>
        <div class="review-list" id="reviewList"><div class="skeleton line w-60"></div></div>
        <form class="review-form" id="reviewForm" novalidate>
            <h4>আপনার অভিজ্ঞতা শেয়ার করুন</h4>
            <fieldset class="star-input">
                <legend class="sr-only">আপনার রেটিং</legend>
                ${[5, 4, 3, 2, 1]
                    .map(
                        (n) =>
                            `<input type="radio" name="rating" id="rate${n}" value="${n}" /><label for="rate${n}" title="${formatNumber(n)} স্টার">${icon('star')}<span class="sr-only">${formatNumber(n)} স্টার</span></label>`
                    )
                    .join('')}
            </fieldset>
            <input type="text" name="name" maxlength="40" autocomplete="name" placeholder="আপনার নাম (ঐচ্ছিক)" aria-label="আপনার নাম" />
            <textarea name="comment" rows="3" maxlength="400" placeholder="প্রোডাক্টটি কেমন লাগলো লিখুন…" aria-label="আপনার মন্তব্য"></textarea>
            <button type="submit" class="btn btn-primary" id="submitReview">রিভিউ জমা দিন</button>
        </form>
    </section>`;
}

export function reviewCard(r) {
    const rating = Math.round(Number(r.rating) || 0);
    return `<article class="review-card">
        <div class="review-top">
            <strong>${esc(r.customer_name || 'ক্রেতা')}</strong>
            ${starRow(rating)}
        </div>
        ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
        <time class="muted">${esc(formatDateTime(r.created_at))}</time>
    </article>`;
}

// ───────────────────────── Cart ─────────────────────────

export function cartItem(item, product) {
    const v = product ? variantOf(product, item.variantId) : null;
    const max = product ? stockOf(product, v) : Infinity;
    const sold = product ? isSoldOut(product, v) : false;
    const old = product ? oldPriceOf(product, v) : 0;
    const oldPrice = old > item.price ? old : 0;
    const warning = sold
        ? '<p class="cart-warn">এই পণ্যটি এখন স্টকে নেই</p>'
        : item.quantity > max
          ? `<p class="cart-warn">মাত্র ${formatNumber(max)}টি আছে</p>`
          : '';
    return `<li class="cart-item" data-key="${esc(item.key)}">
        <img src="${img(item.image)}" alt="" class="cart-thumb" width="72" height="72" loading="lazy" />
        <div class="cart-info">
            <button type="button" class="cart-title product-link" data-action="open-product" data-id="${esc(item.id)}">${esc(item.title)}</button>
            ${item.variant ? `<p class="cart-variant">${esc(item.variant)}</p>` : ''}
            <p class="cart-unit">${oldPrice ? `<span class="price-old">${formatPrice(oldPrice)}</span>` : ''}${formatPrice(item.price)}</p>
            ${warning}
            ${qtyControl(item.key, item.quantity, max, 'qty-sm')}
        </div>
        <div class="cart-side">
            <strong>${formatPrice(item.price * item.quantity)}</strong>
            <button type="button" class="icon-btn icon-btn-sm" data-action="cart-remove" data-key="${esc(item.key)}" aria-label="${esc(item.title)} সরান">${icon('trash-2')}</button>
        </div>
    </li>`;
}

export function summaryRows({ subtotal, discount = 0, couponCode = '', delivery = null, total = null, totalLabel = 'সর্বমোট', totalOnly = false }) {
    const rows = totalOnly ? [] : [`<div class="sum-row"><dt>পণ্যের মূল্য</dt><dd>${formatPrice(subtotal)}</dd></div>`];
    if (!totalOnly && discount > 0)
        rows.push(`<div class="sum-row sum-save"><dt>কুপন (${esc(couponCode)})</dt><dd>−${formatPrice(discount)}</dd></div>`);
    if (!totalOnly && delivery !== null) rows.push(`<div class="sum-row"><dt>ডেলিভারি চার্জ</dt><dd>${formatPrice(delivery)}</dd></div>`);
    if (total !== null) rows.push(`<div class="sum-row sum-total"><dt>${esc(totalLabel)}</dt><dd>${formatPrice(total)}</dd></div>`);
    return rows.join('');
}

export function deliveryOptions(selectedId) {
    return CONFIG.DELIVERY.map(
        (z) => `<label class="radio-card">
            <input type="radio" name="delivery" value="${esc(z.id)}" ${z.id === selectedId ? 'checked' : ''} />
            <span class="radio-body"><strong>${esc(z.label)}</strong><span>${formatPrice(z.charge)}</span></span>
        </label>`
    ).join('');
}

export function districtOptions() {
    return `<option value="">জেলা বাছুন</option>${DISTRICTS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}`;
}

export function checkoutReview(items, breakdownHtml = '') {
    return `<h4>অর্ডারের পণ্য (${formatNumber(items.reduce((s, i) => s + i.quantity, 0))}টি)</h4>
    <ul>${items
        .map(
            (i) =>
                `<li><span>${esc(i.title)}${i.variant ? ` <em>(${esc(i.variant)})</em>` : ''} <b>× ${formatNumber(i.quantity)}</b></span><span>${formatPrice(i.price * i.quantity)}</span></li>`
        )
        .join('')}</ul>
    ${breakdownHtml ? `<dl class="summary">${breakdownHtml}</dl>` : ''}`;
}

export function wishlistItem(p) {
    const sold = isSoldOut(p);
    return `<li class="wish-item">
        <img src="${img(p.image)}" alt="" width="64" height="64" loading="lazy" />
        <div class="wish-info">
            <button type="button" class="product-link" data-action="open-product" data-id="${esc(p.id)}">${esc(p.title)}</button>
            <span class="price">${hasPriceRange(p) ? 'থেকে ' : ''}${formatPrice(p.price)}</span>
        </div>
        <button type="button" class="btn btn-outline btn-sm" data-action="wishlist-to-cart" data-id="${esc(p.id)}" ${sold ? 'disabled' : ''}>${sold ? 'স্টক নেই' : hasVariants(p) ? 'অপশন বাছুন' : 'কার্টে নিন'}</button>
        <button type="button" class="icon-btn icon-btn-sm" data-action="toggle-wishlist" data-id="${esc(p.id)}" aria-label="${esc(p.title)} সরান">${icon('x')}</button>
    </li>`;
}

// ───────────────────────── Orders ─────────────────────────

export function parseItems(raw) {
    try {
        const items = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(items) ? items : [];
    } catch {
        return [];
    }
}

const TRACK_STEPS = ['অর্ডার গৃহীত', 'প্রসেসিং', 'ডেলিভার্ড'];

export function orderCard(o) {
    const cfg = STATUS[o.status] || STATUS.Pending;
    const items = parseItems(o.items);
    const tracker =
        cfg.step === 0
            ? `<p class="track-cancel">${icon('circle-x')}এই অর্ডারটি বাতিল করা হয়েছে</p>`
            : `<ol class="track" aria-label="অর্ডারের অবস্থা">${TRACK_STEPS.map(
                  (label, i) =>
                      `<li class="${i + 1 < cfg.step ? 'is-done' : ''} ${i + 1 === cfg.step ? 'is-current' : ''}"><span class="track-dot">${i + 1 <= cfg.step ? icon('check') : ''}</span><span>${label}</span></li>`
              ).join('')}</ol>`;

    return `<article class="order-card" data-order-id="${esc(o.order_id)}">
        <header class="order-top">
            <div>
                <strong class="order-id">${esc(o.order_id)}</strong>
                <time class="muted">${esc(formatDateTime(o.created_at))}</time>
            </div>
            <span class="status status-${cfg.tone}">${icon(cfg.icon)}${cfg.label}</span>
        </header>
        ${tracker}
        <ul class="order-items">${
            items.length
                ? items.map((i) => `<li><span>${esc(i.title)}</span><b>× ${formatNumber(i.quantity)}</b></li>`).join('')
                : '<li><span class="muted">পণ্যের তালিকা পাওয়া যায়নি</span></li>'
        }</ul>
        ${o.address ? `<p class="order-address">${icon('map-pin')}<span>${esc(o.address)}</span></p>` : ''}
        <footer class="order-total"><span>সর্বমোট</span><strong>${formatPrice(o.total_price)}</strong></footer>
    </article>`;
}

// ───────────────────────── Filters ─────────────────────────

export function filterPanel({ min = '', max = '', discount = false, stock = false, priceBounds = null, showHead = true }) {
    const ph = (v) => (v === undefined || v === null ? '' : formatNumber(v));
    return `<div class="filter-panel">
        ${
            showHead
                ? `<div class="filter-head"><h3>ফিল্টার</h3><button type="button" class="link-btn" data-action="reset-filters">রিসেট</button></div>`
                : ''
        }
        <fieldset class="filter-block">
            <legend>দামের পরিসর (৳)</legend>
            <div class="range">
                <input type="text" inputmode="numeric" data-filter="min" value="${esc(min)}" placeholder="${priceBounds ? ph(priceBounds.min) : 'সর্বনিম্ন'}" aria-label="সর্বনিম্ন দাম" />
                <span aria-hidden="true">–</span>
                <input type="text" inputmode="numeric" data-filter="max" value="${esc(max)}" placeholder="${priceBounds ? ph(priceBounds.max) : 'সর্বোচ্চ'}" aria-label="সর্বোচ্চ দাম" />
            </div>
        </fieldset>
        <fieldset class="filter-block">
            <legend>অফার ও প্রাপ্যতা</legend>
            <label class="check"><input type="checkbox" data-filter="discount" ${discount ? 'checked' : ''} /><span>শুধু ছাড়ের পণ্য</span></label>
            <label class="check"><input type="checkbox" data-filter="stock" ${stock ? 'checked' : ''} /><span>শুধু স্টকে আছে</span></label>
        </fieldset>
    </div>`;
}

export function categoryChip(key, label, count, active) {
    return `<button type="button" class="chip ${active ? 'is-active' : ''}" data-category="${esc(key)}" aria-pressed="${active}">${icon(categoryIcon(label))}${esc(label)}<span class="chip-count">${formatNumber(count)}</span></button>`;
}

export function searchResultItem(p, active) {
    return `<div class="search-item ${active ? 'is-active' : ''}" role="option" aria-selected="${active}" data-action="open-product" data-id="${esc(p.id)}" id="sr-${esc(p.id)}">
        <img src="${img(p.image)}" alt="" width="44" height="44" loading="lazy" />
        <div><strong>${esc(p.title)}</strong><span>${p.category ? `${esc(p.category)} · ` : ''}${formatPrice(p.price)}</span></div>
    </div>`;
}
