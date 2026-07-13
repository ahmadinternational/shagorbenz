// ============================================================
// products.js — SHAGORBENZ Product Data Fetcher
// ============================================================

const SHEET_ID = '1qRfg__n-9LV_lUVvfTgQ46-D2yYtEm6T1C45ehU3Lyg';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const FETCH_TIMEOUT_MS = 10000;
const FALLBACK_IMAGE = 'https://via.placeholder.com/250';

const COLUMN = {
    TITLE: 0,
    PRICE: 1,
    IMAGE: 2,
    CATEGORY: 3,
    STOCK: 5,
    DESCRIPTION: 6,
    OLD_PRICE: 7
};

function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (inQuotes) {
            if (char === '"' && next === '"') {
                field += '"';
                i++;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\r') {
            // ignore
        } else if (char === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }

    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows;
}

const Sanitize = {
    text(value, fallback = '') {
        if (value === undefined || value === null) return fallback;
        const cleaned = String(value).trim();
        return cleaned.length > 0 ? cleaned : fallback;
    },
    number(value, fallback = 0) {
        if (value === undefined || value === null) return fallback;
        const cleaned = String(value).replace(/[^\d.-]/g, '');
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    },
    integer(value, fallback = 0) {
        const parsed = Sanitize.number(value, NaN);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
    },
    category(value) {
        return Sanitize.text(value, '').toLowerCase();
    }
};

function rowToProduct(row, index) {
    const title = Sanitize.text(row[COLUMN.TITLE]);
    if (!title) return null;

    return {
        id: index.toString(),
        title,
        price: Sanitize.number(row[COLUMN.PRICE], 0),
        image: Sanitize.text(row[COLUMN.IMAGE], FALLBACK_IMAGE),
        category: Sanitize.category(row[COLUMN.CATEGORY]),
        stock: row[COLUMN.STOCK] !== undefined && row[COLUMN.STOCK] !== ''
            ? Sanitize.integer(row[COLUMN.STOCK], 999)
            : 999,
        description: Sanitize.text(row[COLUMN.DESCRIPTION], 'বিবরণ নেই।'),
        oldPrice: Sanitize.number(row[COLUMN.OLD_PRICE], 0)
    };
}

async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`Sheet fetch failed with status ${response.status}`);
        }
        return response;
    } finally {
        clearTimeout(timer);
    }
}

export async function fetchProducts() {
    try {
        const response = await fetchWithTimeout(CSV_URL, FETCH_TIMEOUT_MS);
        const csvText = await response.text();

        if (!csvText || !csvText.trim()) {
            console.warn('Product sheet returned empty content');
            return [];
        }

        const rows = parseCSV(csvText);
        const dataRows = rows.slice(1);

        return dataRows
            .map((row, idx) => rowToProduct(row, idx + 1))
            .filter(Boolean);
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('Product sheet request timed out');
        } else {
            console.error('Google Sheet error:', error);
        }
        return [];
    }
}