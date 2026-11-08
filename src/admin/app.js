// SHAGORBENZ admin panel.
//
// SECURITY NOTE — read before relying on this screen:
// Login below compares a username/password stored in the `admins` table, and every
// data call afterwards uses the public anon key. That means the real protection is
// whatever Row Level Security you configured in Supabase, NOT this login form.
// The recommended hardening (Supabase Auth + RLS policies) is described in the README.

import { supabase } from '../lib/supabase.js';
import {
    $, $$, escapeHtml as esc, formatNumber, formatPrice, formatDateTime, icon,
    normalizePhone, storage, toEnglishDigits
} from '../lib/utils.js';
import { openDialog, closeDialog, bindDialog, Toast } from '../lib/overlay.js';
import { STATUS } from '../store/config.js';

const SESSION_KEY = 'adminAuthenticated';
const PAGE = 30;
const STALE_MS = 30_000;
const LOW_STOCK = 5;

const data = { orders: [], products: [], reviews: [], loadedAt: { orders: 0, products: 0, reviews: 0 } };
const ui = { tab: 'overview', orderFilter: 'all', orderQuery: '', orderVisible: PAGE, productQuery: '', editingId: null };
const newOrderIds = new Set();
let unseenOrders = 0;
let channel = null;

const el = {};
const dlg = {};
const TITLES = { overview: 'ওভারভিউ', orders: 'অর্ডার ম্যানেজমেন্ট', products: 'পণ্য ম্যানেজমেন্ট', reviews: 'রিভিউ ম্যানেজমেন্ট' };

// ───────────────────────── Data ─────────────────────────

/** Reads every row (PostgREST caps a single request at 1000). */
async function fetchAll(table, orderBy) {
    const rows = [];
    const size = 1000;
    for (let from = 0; ; from += size) {
        let query = supabase.from(table).select('*');
        for (const [col, asc] of orderBy) query = query.order(col, { ascending: asc });
        const { data: page, error } = await query.range(from, from + size - 1);
        if (error) throw error;
        rows.push(...page);
        if (page.length < size) break;
    }
    return rows;
}

const LOADERS = {
    orders: () => fetchAll('orders', [['created_at', false], ['id', false]]),
    products: () => fetchAll('products', [['priority', true], ['id', false]]),
    reviews: () => fetchAll('reviews', [['created_at', false], ['id', false]])
};

async function load(kind, { force = false } = {}) {
    if (!force && Date.now() - data.loadedAt[kind] < STALE_MS) return;
    try {
        data[kind] = await LOADERS[kind]();
        data.loadedAt[kind] = Date.now();
        el.lastUpdated.textContent = `আপডেট: ${new Date().toLocaleTimeString('bn-BD', { hour: 'numeric', minute: '2-digit' })}`;
    } catch (err) {
        console.error(`Load ${kind} failed:`, err);
        Toast.error(`${{ orders: 'অর্ডার', products: 'পণ্য', reviews: 'রিভিউ' }[kind]} লোড করা যায়নি: ${err.message || 'অজানা ত্রুটি'}`);
    }
    renderActive();
}

const loadAll = (opts) => Promise.all(Object.keys(LOADERS).map((k) => load(k, opts)));

// ───────────────────────── Auth ─────────────────────────

function setLoginError(message) {
    el.loginError.hidden = !message;
    el.loginError.textContent = message || '';
}

async function login(event) {
    event.preventDefault();
    const username = $('#loginUser').value.trim();
    const password = $('#loginPass').value;
    if (!username || !password) return setLoginError('ইউজারনেম ও পাসওয়ার্ড দিন');
    setLoginError('');
    el.loginBtn.classList.add('is-loading');
    el.loginBtn.disabled = true;
    try {
        const { data: row, error } = await supabase
            .from('admins')
            .select('id')
            .eq('username', username)
            .eq('password', password)
            .maybeSingle();
        if (error) throw error;
        if (!row) {
            await new Promise((r) => setTimeout(r, 600)); // slow down guessing a little
            return setLoginError('ইউজারনেম বা পাসওয়ার্ড ভুল');
        }
        storage.set(SESSION_KEY, true);
        $('#loginPass').value = '';
        showDashboard();
    } catch (err) {
        console.error(err);
        setLoginError('লগইন করা যায়নি — ইন্টারনেট সংযোগ পরীক্ষা করুন');
    } finally {
        el.loginBtn.classList.remove('is-loading');
        el.loginBtn.disabled = false;
    }
}

async function logout() {
    const ok = await confirmAction({ title: 'লগআউট করবেন?', text: 'আবার প্রবেশ করতে পাসওয়ার্ড লাগবে।', okLabel: 'লগআউট' });
    if (!ok) return;
    storage.remove(SESSION_KEY);
    if (channel) supabase.removeChannel(channel);
    channel = null;
    el.dashboard.hidden = true;
    el.loginView.hidden = false;
    $('#loginUser').focus();
}

function showDashboard() {
    el.loginView.hidden = true;
    el.dashboard.hidden = false;
    renderActive();
    loadAll({ force: true });
    subscribeOrders();
}

// ───────────────────────── Realtime ─────────────────────────

function subscribeOrders() {
    if (channel) return;
    channel = supabase
        .channel('admin-orders')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, ({ new: row }) => {
            if (data.orders.some((o) => o.id === row.id)) return;
            data.orders.unshift(row);
            newOrderIds.add(row.id);
            if (ui.tab !== 'orders') setUnseen(unseenOrders + 1);
            Toast.info(`নতুন অর্ডার: ${row.order_id}`);
            renderActive();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, ({ new: row }) => {
            const existing = data.orders.find((o) => o.id === row.id);
            if (existing && existing.status !== row.status) {
                Object.assign(existing, row);
                renderActive();
            }
        })
        .subscribe();
}

function setUnseen(n) {
    unseenOrders = n;
    el.newOrdersBadge.hidden = n <= 0;
    el.newOrdersBadge.textContent = formatNumber(n);
}

// ───────────────────────── Helpers ─────────────────────────

const tone = (status) => STATUS[status] || STATUS.Pending;
const statusPill = (status) => {
    const c = tone(status);
    return `<span class="status status-${c.tone}">${icon(c.icon)}${c.label}</span>`;
};
const sumPrice = (list) => list.reduce((s, o) => s + Number(o.total_price || 0), 0);
const parseItems = (raw) => {
    try {
        const items = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(items) ? items : [];
    } catch {
        return [];
    }
};
const emptyBlock = (iconName, title, text = '') =>
    `<div class="empty-a">${icon(iconName)}<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
const skeletonRows = (n = 4) => Array.from({ length: n }, () => '<div class="skeleton row"></div>').join('');
const stars = (n) =>
    `<span class="stars" role="img" aria-label="${n} স্টার" style="display:inline-flex;color:var(--star)">${[1, 2, 3, 4, 5]
        .map((i) => icon('star', i <= n ? 'icon-fill' : 'is-empty'))
        .join('')}</span>`;

function confirmAction({ title, text, okLabel = 'নিশ্চিত করুন' }) {
    return new Promise((resolve) => {
        let result = false;
        $('#confirmTitle').textContent = title;
        $('#confirmText').textContent = text;
        const ok = $('#confirmOk');
        ok.textContent = okLabel;
        const onOk = () => {
            result = true;
            closeDialog(dlg.confirm);
        };
        ok.addEventListener('click', onOk, { once: true });
        openDialog(dlg.confirm, {
            onClose: () => {
                ok.removeEventListener('click', onOk);
                resolve(result);
            }
        });
    });
}

// ───────────────────────── Overview ─────────────────────────

function renderOverview() {
    const root = $('#view-overview');
    if (!data.loadedAt.orders) {
        root.innerHTML = skeletonRows(3);
        return;
    }
    const orders = data.orders;
    const live = orders.filter((o) => o.status !== 'Cancelled');
    const delivered = orders.filter((o) => o.status === 'Delivered');
    const count = (s) => orders.filter((o) => o.status === s).length;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - ((startOfDay.getDay() + 1) % 7)); // weeks start on Saturday
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const since = (date) => live.filter((o) => new Date(o.created_at) >= date);

    const kpi = (label, iconName, value, sub = '', cls = '') =>
        `<div class="kpi ${cls}"><div class="kpi-label">${icon(iconName)}${esc(label)}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
    const period = (label, list) => kpi(label, 'calendar-days', formatPrice(sumPrice(list)), `${formatNumber(list.length)}টি অর্ডার`);

    // Top products (cancelled orders excluded)
    const sold = new Map();
    for (const o of live) {
        for (const item of parseItems(o.items)) {
            const key = item.title || item.id;
            const row = sold.get(key) || { title: key, qty: 0, revenue: 0 };
            row.qty += Number(item.quantity) || 0;
            row.revenue += (Number(item.price) || 0) * (Number(item.quantity) || 0);
            sold.set(key, row);
        }
    }
    const top = [...sold.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
    const lowStock = data.products
        .filter((p) => p.stock !== null && Number(p.stock) <= LOW_STOCK)
        .sort((a, b) => Number(a.stock) - Number(b.stock))
        .slice(0, 6);
    const total = orders.length || 1;

    root.innerHTML = `
        <div class="kpi-grid">
            ${kpi('মোট বিক্রি (বাতিল বাদে)', 'wallet', formatPrice(sumPrice(live)), `${formatNumber(live.length)}টি অর্ডার`, 'accent')}
            ${kpi('ডেলিভার্ড বিক্রি', 'circle-check', formatPrice(sumPrice(delivered)), `${formatNumber(delivered.length)}টি অর্ডার`)}
            ${kpi('গড় অর্ডার মান', 'trending-up', formatPrice(live.length ? sumPrice(live) / live.length : 0))}
            ${kpi('অপেক্ষমাণ অর্ডার', 'hourglass', formatNumber(count('Pending')), `প্রসেসিংয়ে: ${formatNumber(count('Processing'))}টি`)}
        </div>
        <div class="kpi-grid">
            ${period('আজ', since(startOfDay))}
            ${period('এই সপ্তাহ', since(startOfWeek))}
            ${period('এই মাস', since(startOfMonth))}
            ${period('এই বছর', since(startOfYear))}
        </div>
        <div class="two-col">
            <section class="card-a" aria-labelledby="ovStatus">
                <h2 id="ovStatus">অর্ডারের অবস্থা</h2>
                <div class="bar-list">${Object.entries(STATUS)
                    .map(([key, c]) => {
                        const n = count(key);
                        return `<div><div class="bar-row-top"><span>${c.label}</span><span>${formatNumber(n)}টি · ${formatNumber(Math.round((n / total) * 100))}%</span></div><div class="bar"><i class="tone-${c.tone}" style="width:${(n / total) * 100}%"></i></div></div>`;
                    })
                    .join('')}</div>
            </section>
            <section class="card-a" aria-labelledby="ovTop">
                <h2 id="ovTop">সবচেয়ে বেশি বিক্রি হওয়া পণ্য</h2>
                <div class="mini-list">${
                    top.length
                        ? top
                              .map(
                                  (t) =>
                                      `<div class="mini-row"><div><strong>${esc(t.title)}</strong><small>${formatNumber(t.qty)}টি বিক্রি</small></div><span class="right">${formatPrice(t.revenue)}</span></div>`
                              )
                              .join('')
                        : emptyBlock('package', 'এখনো বিক্রির তথ্য নেই')
                }</div>
            </section>
        </div>
        <div class="two-col">
            <section class="card-a" aria-labelledby="ovRecent">
                <h2 id="ovRecent">সাম্প্রতিক অর্ডার</h2>
                <div class="mini-list">${
                    orders.length
                        ? orders
                              .slice(0, 5)
                              .map(
                                  (o) =>
                                      `<div class="mini-row"><div><strong>${esc(o.order_id)}</strong><small>${esc(o.customer_name || '')} · ${esc(formatDateTime(o.created_at))}</small></div><div class="right">${formatPrice(o.total_price)}<br>${statusPill(o.status)}</div></div>`
                              )
                              .join('')
                        : emptyBlock('inbox', 'কোনো অর্ডার নেই')
                }</div>
            </section>
            <section class="card-a" aria-labelledby="ovLow">
                <h2 id="ovLow">স্টক কম / শেষ</h2>
                <div class="mini-list">${
                    lowStock.length
                        ? lowStock
                              .map((p) => {
                                  const out = Number(p.stock) <= 0;
                                  return `<div class="mini-row"><div><strong>${esc(p.title)}</strong><small>${esc(p.category || '')}</small></div><span class="stock-chip ${out ? 'out' : ''}">${out ? 'স্টক নেই' : `${formatNumber(p.stock)}টি বাকি`}</span></div>`;
                              })
                              .join('')
                        : emptyBlock('circle-check', 'সব পণ্যের স্টক ঠিক আছে')
                }</div>
            </section>
        </div>`;
}

// ───────────────────────── Orders ─────────────────────────

function filteredOrders() {
    const q = ui.orderQuery.toLowerCase();
    return data.orders.filter(
        (o) =>
            (ui.orderFilter === 'all' || o.status === ui.orderFilter) &&
            (!q || [o.order_id, o.customer_name, o.phone].some((v) => String(v ?? '').toLowerCase().includes(q)))
    );
}

function orderCard(o) {
    const items = parseItems(o.items);
    const phone = normalizePhone(o.phone);
    const waNumber = phone.startsWith('0') ? `880${phone.slice(1)}` : phone;
    return `<article class="a-order ${newOrderIds.has(o.id) ? 'is-new' : ''}" data-id="${esc(o.id)}">
        <header class="a-order-top">
            <div><span class="a-order-id">${esc(o.order_id)}</span><time>${esc(formatDateTime(o.created_at))}</time></div>
            <label class="sr-only" for="st-${esc(o.id)}">অর্ডারের স্ট্যাটাস</label>
            <select class="select status-select" id="st-${esc(o.id)}" data-id="${esc(o.id)}">
                ${Object.entries(STATUS).map(([k, c]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${c.label}</option>`).join('')}
            </select>
        </header>
        <div class="a-order-grid">
            <div>
                <h4>গ্রাহক</h4>
                <p><strong>${esc(o.customer_name || '—')}</strong><br>${esc(o.phone || '')}</p>
                <div class="contact-links">
                    <a href="tel:${esc(phone)}">${icon('phone')}কল</a>
                    <a href="https://wa.me/${esc(waNumber)}" target="_blank" rel="noopener noreferrer">${icon('message-circle')}হোয়াটসঅ্যাপ</a>
                </div>
            </div>
            <div><h4>ঠিকানা</h4><p>${esc(o.address || '—')}</p></div>
        </div>
        <div class="a-order-grid" style="grid-template-columns:1fr">
            <div><h4>পণ্য</h4><ul class="a-items">${
                items.length
                    ? items.map((i) => `<li><span>${esc(i.title)}</span><b>× ${formatNumber(i.quantity)} · ${formatPrice(Number(i.price) * Number(i.quantity))}</b></li>`).join('')
                    : '<li><span class="muted">পণ্যের তালিকা পাওয়া যায়নি</span></li>'
            }</ul></div>
        </div>
        <footer class="a-order-foot"><span>সর্বমোট</span><strong>${formatPrice(o.total_price)}</strong></footer>
    </article>`;
}

function renderOrders() {
    const list = $('#orderList');
    if (!data.loadedAt.orders) {
        list.innerHTML = skeletonRows(3);
        return;
    }
    const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, data.orders.filter((o) => o.status === k).length]));
    $('#orderFilters').innerHTML =
        `<button type="button" class="chip-a ${ui.orderFilter === 'all' ? 'is-active' : ''}" data-filter="all">সব <b>${formatNumber(data.orders.length)}</b></button>` +
        Object.entries(STATUS)
            .map(([k, c]) => `<button type="button" class="chip-a ${ui.orderFilter === k ? 'is-active' : ''}" data-filter="${k}">${c.label} <b>${formatNumber(counts[k])}</b></button>`)
            .join('');

    const all = filteredOrders();
    const shown = all.slice(0, ui.orderVisible);
    list.innerHTML = shown.length ? shown.map(orderCard).join('') : `<div class="card-a">${emptyBlock('inbox', 'কোনো অর্ডার পাওয়া যায়নি')}</div>`;
    $('#orderMoreWrap').hidden = all.length <= shown.length;
    $('#orderMore').textContent = `আরও দেখুন (${formatNumber(all.length - shown.length)}টি বাকি)`;
    newOrderIds.clear(); // highlight only on first paint after arrival
}

async function changeStatus(select) {
    const order = data.orders.find((o) => String(o.id) === select.dataset.id);
    if (!order || order.status === select.value) return;
    const previous = order.status;
    order.status = select.value;
    select.disabled = true;
    const { error } = await supabase.from('orders').update({ status: order.status }).eq('id', order.id);
    if (error) {
        order.status = previous;
        console.error(error);
        Toast.error('স্ট্যাটাস পরিবর্তন করা যায়নি');
    } else {
        Toast.success(`স্ট্যাটাস: ${tone(order.status).label}`);
    }
    renderActive();
}

// ───────────────────────── Products ─────────────────────────

function stockChip(p) {
    if (p.stock === null) return '<span class="stock-chip ok">আনলিমিটেড</span>';
    const n = Number(p.stock);
    if (n <= 0) return '<span class="stock-chip out">স্টক নেই</span>';
    if (n <= LOW_STOCK) return `<span class="stock-chip">${formatNumber(n)}টি বাকি</span>`;
    return `<span class="stock-chip ok">স্টক: ${formatNumber(n)}</span>`;
}

function renderProducts() {
    const root = $('#productList');
    if (!data.loadedAt.products) {
        root.innerHTML = skeletonRows(5);
        return;
    }
    const q = ui.productQuery.toLowerCase();
    const list = data.products.filter((p) => !q || `${p.title} ${p.category}`.toLowerCase().includes(q));
    root.innerHTML = list.length
        ? list
              .map(
                  (p) => `<article class="p-row" data-id="${esc(p.id)}">
                <img src="${esc(p.image || '')}" alt="" loading="lazy" width="56" height="56" onerror="this.style.visibility='hidden'" />
                <div class="p-title"><strong>${esc(p.title)}</strong><small>${esc(p.category || 'ক্যাটাগরি নেই')}</small></div>
                <div class="p-price"><strong>${formatPrice(p.price)}</strong>${Number(p.old_price) > Number(p.price) ? `<small>${formatPrice(p.old_price)}</small>` : ''}</div>
                <div class="p-stock">${parseOptions(p.options).length ? `<span class="stock-chip ok">${formatNumber(parseOptions(p.options).length)}টি অপশন</span>` : stockChip(p)}</div>
                <div class="p-prio">প্রায়োরিটি ${formatNumber(p.priority || 0)}</div>
                <div class="p-actions">
                    <button type="button" class="icon-btn icon-btn-sm" data-action="edit-product" data-id="${esc(p.id)}" aria-label="${esc(p.title)} এডিট করুন">${icon('pencil')}</button>
                    <button type="button" class="icon-btn icon-btn-sm danger" data-action="delete-product" data-id="${esc(p.id)}" aria-label="${esc(p.title)} ডিলিট করুন">${icon('trash-2')}</button>
                </div>
            </article>`
              )
              .join('')
        : emptyBlock('boxes', 'কোনো পণ্য নেই', q ? 'ভিন্ন শব্দে খুঁজুন।' : '“নতুন পণ্য” বাটনে চেপে প্রথম পণ্যটি যোগ করুন।');
}

const KEYWORDS = [
    [/watch|garmin/, 'Smartwatch'],
    [/earbud|headphone|airpod|earphone/, 'Earbuds'],
    [/power\s*bank|charger/, 'Power Bank'],
    [/phone|mobile|iphone|samsung/, 'Phone'],
    [/spice|masala|jira|cumin|মশলা/, 'Spices'],
    [/rice|dal|oil|grocery|মুদি/, 'Groceries']
];
const guessCategory = (title) => KEYWORDS.find(([re]) => re.test(title.toLowerCase()))?.[1] || '';

const num = (value) => {
    const cleaned = toEnglishDigits(value).replace(/[,\s]/g, '');
    return cleaned === '' ? null : Number(cleaned);
};

function setErr(id, message) {
    const input = $(`#${id}`);
    const field = input.closest('.field');
    field.classList.toggle('has-error', !!message);
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    $(`#${id}Error`).textContent = message || '';
}

function updateImagePreview() {
    const url = $('#fImage').value.trim();
    const box = $('#imgPreview');
    const img = $('img', box);
    box.hidden = !url;
    if (url) img.src = url;
    img.onerror = () => (box.hidden = true);
}

// ── Product options (variants) ──

const parseOptions = (raw) => {
    let list = raw;
    if (typeof list === 'string') {
        try {
            list = JSON.parse(list);
        } catch {
            list = [];
        }
    }
    return Array.isArray(list) ? list : [];
};

const newVariantId = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));

function variantRow(v = {}, index = 0) {
    const val = (x) => (x === null || x === undefined || x === 0 ? '' : esc(x));
    return `<div class="var-row" data-vid="${esc(v.id || newVariantId())}">
        <div class="var-top">
            <strong>অপশন <span class="var-n">${formatNumber(index + 1)}</span></strong>
            <button type="button" class="icon-btn icon-btn-sm danger" data-action="remove-variant" aria-label="অপশনটি মুছুন">${icon('trash-2')}</button>
        </div>
        <label class="var-f"><span>নাম *</span><input class="v-label" type="text" value="${esc(v.label || '')}" placeholder="যেমন: Gold / লাল / XL" /></label>
        <label class="var-f"><span>মূল্য (৳)</span><input class="v-price" type="text" inputmode="decimal" value="${val(v.price)}" placeholder="ফাঁকা = পণ্যের মূল্য" /></label>
        <label class="var-f var-wide"><span>ছবির লিঙ্ক</span><input class="v-image" type="url" value="${esc(v.image || '')}" placeholder="https://… (ঐচ্ছিক)" /></label>
        <label class="var-f"><span>পূর্বের মূল্য</span><input class="v-old" type="text" inputmode="decimal" value="${val(v.old_price)}" placeholder="ঐচ্ছিক" /></label>
        <label class="var-f"><span>স্টক</span><input class="v-stock" type="text" inputmode="numeric" value="${v.stock === null || v.stock === undefined ? '' : esc(v.stock)}" placeholder="ফাঁকা = আনলিমিটেড" /></label>
    </div>`;
}

function renderVariantRows(list) {
    $('#variantList').innerHTML = list.map((v, i) => variantRow(v, i)).join('');
}

function setVariantsError(message) {
    $('#variantsError').textContent = message || '';
}

/** Reads the option rows. Returns { options } or { error, focus }. Entirely blank rows are skipped. */
function collectVariants(productPrice) {
    const options = [];
    const labels = new Set();
    for (const row of $$('.var-row', $('#variantList'))) {
        const get = (cls) => $(`.${cls}`, row).value.trim();
        const label = get('v-label');
        const image = get('v-image');
        const price = num(get('v-price'));
        const old = num(get('v-old'));
        const stock = num(get('v-stock'));
        if (!label && !image && price === null && old === null && stock === null) continue;
        const fail = (error, cls) => ({ error: `${error} (অপশন ${options.length + 1})`, focus: $(`.${cls}`, row) });

        if (!label) return fail('অপশনের নাম লিখুন', 'v-label');
        if (labels.has(label.toLowerCase())) return fail(`“${label}” নামটি আগেও আছে`, 'v-label');
        labels.add(label.toLowerCase());
        if (image) {
            let ok = false;
            try {
                ok = /^https?:$/.test(new URL(image).protocol);
            } catch {
                /* invalid */
            }
            if (!ok) return fail('ছবির লিঙ্ক সঠিক নয়', 'v-image');
        }
        if (price !== null && !(Number.isFinite(price) && price > 0)) return fail('সঠিক মূল্য দিন', 'v-price');
        const effective = price ?? productPrice;
        if (old !== null && !(Number.isFinite(old) && old > effective)) return fail('পূর্বের মূল্য অপশনের মূল্যের চেয়ে বেশি হতে হবে', 'v-old');
        if (stock !== null && !(Number.isInteger(stock) && stock >= 0)) return fail('স্টক ০ বা তার বেশি পূর্ণসংখ্যা হতে হবে', 'v-stock');

        options.push({ id: row.dataset.vid, label, image, price, old_price: old, stock });
    }
    return { options };
}

function openProductEditor(product = null) {
    ui.editingId = product ? String(product.id) : null;
    delete $('#fCategory').dataset.touched;
    $('#productDialogTitle').textContent = product ? 'পণ্য এডিট করুন' : 'নতুন পণ্য';
    $('#fTitle').value = product?.title || '';
    $('#fCategory').value = product?.category || '';
    $('#fPriority').value = product?.priority ?? 0;
    $('#fPrice').value = product?.price ?? '';
    $('#fOldPrice').value = Number(product?.old_price) > 0 ? product.old_price : '';
    $('#fImage').value = product?.image || '';
    $('#fStock').value = product ? (product.stock ?? '') : 20;
    $('#fDesc').value = product?.description || '';
    ['fTitle', 'fCategory', 'fPrice', 'fOldPrice', 'fImage', 'fStock'].forEach((id) => setErr(id, ''));
    $('#categoryOptions').innerHTML = [...new Set(data.products.map((p) => p.category).filter(Boolean))]
        .map((c) => `<option value="${esc(c)}"></option>`)
        .join('');
    ui.hadOptions = parseOptions(product?.options).length > 0;
    renderVariantRows(parseOptions(product?.options));
    setVariantsError('');
    updateImagePreview();
    openDialog(dlg.product);
}

function validateProduct() {
    const title = $('#fTitle').value.trim();
    const category = $('#fCategory').value.trim();
    const price = num($('#fPrice').value);
    const oldPrice = num($('#fOldPrice').value);
    const stock = num($('#fStock').value);
    const priority = num($('#fPriority').value) ?? 0;
    const image = $('#fImage').value.trim();
    const errors = [];
    const check = (id, ok, msg) => {
        setErr(id, ok ? '' : msg);
        if (!ok) errors.push(id);
    };
    let imageOk = false;
    try {
        imageOk = /^https?:$/.test(new URL(image).protocol);
    } catch {
        /* invalid */
    }
    check('fTitle', title.length >= 2, 'পণ্যের নাম লিখুন');
    check('fCategory', !!category, 'ক্যাটাগরি লিখুন');
    check('fPrice', Number.isFinite(price) && price > 0, 'সঠিক মূল্য দিন');
    check('fOldPrice', oldPrice === null || (Number.isFinite(oldPrice) && oldPrice > price), 'পূর্বের মূল্য বর্তমান মূল্যের চেয়ে বেশি হতে হবে');
    check('fImage', imageOk, 'সঠিক ছবির লিঙ্ক দিন (https://…)');
    check('fStock', Number.isInteger(stock) && stock >= 0, 'স্টক ০ বা তার বেশি পূর্ণসংখ্যা হতে হবে');
    if (errors.length) {
        $(`#${errors[0]}`).focus();
        return null;
    }
    const variants = collectVariants(price);
    setVariantsError(variants.error || '');
    if (variants.error) {
        variants.focus.focus();
        return null;
    }
    return {
        // Send `options` when there are some, or to clear previously saved ones; otherwise leave the column untouched.
        ...(variants.options.length || ui.hadOptions ? { options: variants.options } : {}),
        title, category, price, image, stock,
        old_price: oldPrice ?? 0,
        priority: Number.isInteger(priority) ? priority : 0,
        description: $('#fDesc').value.trim()
    };
}

async function saveProduct(event) {
    event.preventDefault();
    const payload = validateProduct();
    if (!payload) return;
    const btn = $('#productSaveBtn');
    btn.classList.add('is-loading');
    btn.disabled = true;
    try {
        const query = ui.editingId
            ? supabase.from('products').update(payload).eq('id', ui.editingId)
            : supabase.from('products').insert(payload);
        const { error } = await query;
        if (error) throw error;
        Toast.success(ui.editingId ? 'পণ্য আপডেট হয়েছে' : 'পণ্য যোগ হয়েছে');
        localStorage.removeItem('sb:products:v3'); // let the storefront cache refresh on this browser too
        await closeDialog(dlg.product);
        await load('products', { force: true });
    } catch (err) {
        console.error(err);
        const missingColumn = err?.code === 'PGRST204' || /options/.test(err?.message || '');
        Toast.error(
            missingColumn
                ? 'অপশন সংরক্ষণ করা যায়নি: Supabase-এ products টেবিলে `options` কলাম নেই (README দেখুন)'
                : `সংরক্ষণ করা যায়নি: ${err.message || 'অজানা ত্রুটি'}`
        );
    } finally {
        btn.classList.remove('is-loading');
        btn.disabled = false;
    }
}

async function deleteProduct(id) {
    const product = data.products.find((p) => String(p.id) === id);
    const ok = await confirmAction({
        title: 'পণ্যটি ডিলিট করবেন?',
        text: `“${product?.title || ''}” স্থায়ীভাবে মুছে যাবে। এটি ফেরানো যাবে না।`,
        okLabel: 'ডিলিট করুন'
    });
    if (!ok) return;
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) {
        console.error(error);
        return Toast.error(`ডিলিট করা যায়নি: ${error.message}`);
    }
    Toast.success('পণ্য ডিলিট হয়েছে');
    await load('products', { force: true });
}

// ───────────────────────── Reviews ─────────────────────────

function renderReviews() {
    const root = $('#reviewList');
    if (!data.loadedAt.reviews) {
        root.innerHTML = skeletonRows(4);
        return;
    }
    const titles = new Map(data.products.map((p) => [String(p.id), p.title]));
    root.innerHTML = data.reviews.length
        ? data.reviews
              .map(
                  (r) => `<article class="r-row">
                <div>
                    <div class="r-top"><strong>${esc(r.customer_name || 'অজানা')}</strong>${stars(Number(r.rating) || 0)}<span class="r-prod">${esc(titles.get(String(r.product_id)) || `পণ্য #${r.product_id}`)}</span></div>
                    <p>${esc(r.comment || '—')}</p>
                    <small>${esc(formatDateTime(r.created_at))}</small>
                </div>
                <button type="button" class="icon-btn icon-btn-sm" data-action="delete-review" data-id="${esc(r.id)}" aria-label="রিভিউ ডিলিট করুন" style="color:var(--danger)">${icon('trash-2')}</button>
            </article>`
              )
              .join('')
        : emptyBlock('star', 'এখনো কোনো রিভিউ নেই');
}

async function deleteReview(id) {
    const ok = await confirmAction({ title: 'রিভিউটি ডিলিট করবেন?', text: 'এটি স্থায়ীভাবে মুছে যাবে।', okLabel: 'ডিলিট করুন' });
    if (!ok) return;
    const { error } = await supabase.from('reviews').delete().eq('id', id);
    if (error) {
        console.error(error);
        return Toast.error('ডিলিট করা যায়নি');
    }
    Toast.success('রিভিউ ডিলিট হয়েছে');
    await load('reviews', { force: true });
}

// ───────────────────────── Navigation ─────────────────────────

const RENDERERS = { overview: renderOverview, orders: renderOrders, products: renderProducts, reviews: renderReviews };
const renderActive = () => {
    if (!el.dashboard.hidden) RENDERERS[ui.tab]();
};

function switchTab(tab) {
    ui.tab = tab;
    $$('.side-link').forEach((b) => {
        const active = b.dataset.tab === tab;
        b.classList.toggle('is-active', active);
        if (active) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
    });
    $$('.view').forEach((v) => (v.hidden = v.id !== `view-${tab}`));
    $('#viewTitle').textContent = TITLES[tab];
    if (tab === 'orders') setUnseen(0);
    renderActive();
    const needs = { overview: ['orders', 'products'], orders: ['orders'], products: ['products'], reviews: ['reviews', 'products'] }[tab];
    needs.forEach((k) => load(k));
    window.scrollTo({ top: 0 });
}

// ───────────────────────── Init ─────────────────────────

function init() {
    ['loginView', 'loginForm', 'loginBtn', 'loginError', 'dashboard', 'lastUpdated', 'newOrdersBadge'].forEach(
        (id) => (el[id] = document.getElementById(id))
    );
    Object.assign(dlg, { product: $('#productDialog'), confirm: $('#confirmDialog') });
    Object.values(dlg).forEach(bindDialog);

    el.loginForm.addEventListener('submit', login);
    $('#togglePw').addEventListener('click', (e) => {
        const input = $('#loginPass');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        e.currentTarget.setAttribute('aria-pressed', show);
        e.currentTarget.setAttribute('aria-label', show ? 'পাসওয়ার্ড লুকান' : 'পাসওয়ার্ড দেখান');
        $('use', e.currentTarget).setAttribute('href', `/icons.svg#i-${show ? 'eye-off' : 'eye'}`);
    });
    $('#logoutBtn').addEventListener('click', logout);
    $('#logoutBtnMobile').addEventListener('click', logout);
    $('#refreshBtn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        await loadAll({ force: true });
        btn.disabled = false;
        Toast.success('ডেটা রিফ্রেশ হয়েছে');
    });

    $$('.side-link').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

    // Orders
    $('#orderSearch').addEventListener('input', (e) => {
        ui.orderQuery = e.target.value.trim();
        ui.orderVisible = PAGE;
        renderOrders();
    });
    $('#orderFilters').addEventListener('click', (e) => {
        const chip = e.target.closest('[data-filter]');
        if (!chip) return;
        ui.orderFilter = chip.dataset.filter;
        ui.orderVisible = PAGE;
        renderOrders();
    });
    $('#orderMore').addEventListener('click', () => {
        ui.orderVisible += PAGE;
        renderOrders();
    });
    $('#orderList').addEventListener('change', (e) => {
        const select = e.target.closest('.status-select');
        if (select) changeStatus(select);
    });

    // Products
    $('#productSearch').addEventListener('input', (e) => {
        ui.productQuery = e.target.value.trim();
        renderProducts();
    });
    $('#newProductBtn').addEventListener('click', () => openProductEditor());
    $('#productList').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'edit-product') openProductEditor(data.products.find((p) => String(p.id) === btn.dataset.id));
        if (btn.dataset.action === 'delete-product') deleteProduct(btn.dataset.id);
    });
    $('#productForm').addEventListener('submit', saveProduct);
    $('#addVariant').addEventListener('click', () => {
        const list = $('#variantList');
        list.insertAdjacentHTML('beforeend', variantRow({}, $$('.var-row', list).length));
        $('.v-label', list.lastElementChild).focus();
    });
    $('#variantList').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="remove-variant"]');
        if (!btn) return;
        btn.closest('.var-row').remove();
        $$('.var-row .var-n', $('#variantList')).forEach((n, i) => (n.textContent = formatNumber(i + 1)));
    });
    $('#variantList').addEventListener('input', () => setVariantsError(''));
    $('#fImage').addEventListener('input', updateImagePreview);
    $('#fTitle').addEventListener('input', () => {
        setErr('fTitle', '');
        if (!ui.editingId && !$('#fCategory').dataset.touched) $('#fCategory').value = guessCategory($('#fTitle').value);
    });
    $('#fCategory').addEventListener('input', (e) => (e.target.dataset.touched = '1'));
    ['fCategory', 'fPrice', 'fOldPrice', 'fImage', 'fStock'].forEach((id) => $(`#${id}`).addEventListener('input', () => setErr(id, '')));

    // Reviews
    $('#reviewList').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="delete-review"]');
        if (btn) deleteReview(btn.dataset.id);
    });

    if (storage.get(SESSION_KEY, false)) showDashboard();
    else $('#loginUser').focus();
}

init();
