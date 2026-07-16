// ============================================================
// products.js — SHAGORBENZ Product Data Fetcher (Google Sheets)
// ============================================================
const SHEET_ID = '1qRfg__n-9LV_lUVvfTgQ46-D2yYtEm6T1C45ehU3Lyg';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const FETCH_TIMEOUT_MS = 10000;
const FALLBACK_IMAGE = 'https://via.placeholder.com/250';
const CACHE_KEY = 'shagorbenzProductCache';
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes — fresh cache is reused instantly, stale cache is used only as an offline fallback

const COLUMN = { TITLE: 0, PRICE: 1, IMAGE: 2, CATEGORY: 3, STOCK: 5, DESCRIPTION: 6, OLD_PRICE: 7 };

function parseCSV(text) {
    const rows = []; let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i], next = text[i + 1];
        if (inQuotes) {
            if (ch === '"' && next === '"') { field += '"'; i++; }
            else if (ch === '"') inQuotes = false;
            else field += ch;
        } else {
            if (ch === '"') inQuotes = true;
            else if (ch === ',') { row.push(field); field = ''; }
            else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
            else if (ch !== '\r') field += ch;
        }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
}

const Sanitize = {
    text(v, fb = '') { return v === undefined || v === null ? fb : String(v).trim() || fb; },
    number(v, fb = 0) { if (v === undefined || v === null) return fb; const c = String(v).replace(/[^\d.-]/g, ''); const p = Number(c); return isFinite(p) && p >= 0 ? p : fb; },
    integer(v, fb = 0) { const p = Sanitize.number(v, NaN); return isFinite(p) ? Math.trunc(p) : fb; },
    category(v) { return Sanitize.text(v, '').toLowerCase(); }
};

function rowToProduct(row, idx) {
    const title = Sanitize.text(row[COLUMN.TITLE]); if (!title) return null;
    return {
        id: idx.toString(), title,
        price: Sanitize.number(row[COLUMN.PRICE], 0),
        image: Sanitize.text(row[COLUMN.IMAGE], FALLBACK_IMAGE),
        category: Sanitize.category(row[COLUMN.CATEGORY]),
        stock: row[COLUMN.STOCK] !== undefined && row[COLUMN.STOCK] !== '' ? Sanitize.integer(row[COLUMN.STOCK], 999) : 999,
        description: Sanitize.text(row[COLUMN.DESCRIPTION], 'বিবরণ নেই।'),
        oldPrice: Sanitize.number(row[COLUMN.OLD_PRICE], 0)
    };
}

async function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        return res;
    } finally { clearTimeout(timer); }
}

function readCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.products)) return null;
        return parsed;
    } catch { return null; }
}

function writeCache(products) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ products, savedAt: Date.now() })); } catch { /* storage full/unavailable — non-fatal */ }
}

export async function fetchProducts() {
    const cached = readCache();
    const isFresh = cached && (Date.now() - cached.savedAt) < CACHE_TTL_MS;
    if (isFresh) {
        // Serve instantly from a fresh cache, then silently refresh in the background.
        refreshInBackground();
        return cached.products;
    }
    try {
        const res = await fetchWithTimeout(CSV_URL, FETCH_TIMEOUT_MS);
        const text = await res.text();
        if (!text || !text.trim()) return cached?.products || [];
        const rows = parseCSV(text);
        const dataRows = rows.slice(1);
        const products = dataRows.map((r, i) => rowToProduct(r, i + 1)).filter(Boolean);
        writeCache(products);
        return products;
    } catch (e) {
        console.error(e);
        // Network failed — fall back to whatever we have cached, even if stale, so the store still works offline.
        if (cached?.products?.length) return cached.products;
        return [];
    }
}

async function refreshInBackground() {
    try {
        const res = await fetchWithTimeout(CSV_URL, FETCH_TIMEOUT_MS);
        const text = await res.text();
        if (!text || !text.trim()) return;
        const rows = parseCSV(text);
        const dataRows = rows.slice(1);
        const products = dataRows.map((r, i) => rowToProduct(r, i + 1)).filter(Boolean);
        writeCache(products);
    } catch { /* silent — user already has cached data on screen */ }
}