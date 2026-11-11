// Reads a supplier export (JSON / JSONL / CSV) and turns every row into one validated, canonical record.
// Nothing is invented: a field the file does not contain stays null / empty, and a row that cannot be
// trusted (no id, no price, no usable image …) is rejected with a reason instead of being half-imported.

import { createHash } from 'node:crypto';

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const asciiDigits = (v) => String(v ?? '').replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const nullable = (v) => text(v) || null;

/** "৳ 1,290.50", "১২৯০", 1290 → number; anything else → null */
export function parseMoney(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const cleaned = asciiDigits(value).replace(/[^\d.]/g, '');
    if (!cleaned || cleaned === '.') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

export function httpUrl(value) {
    try {
        const u = new URL(text(value));
        return /^https?:$/.test(u.protocol) ? u.toString() : null;
    } catch {
        return null;
    }
}

/** Stable identity for a product page: lower-case host, no #hash, no tracking params, no trailing slash. */
export function canonicalUrl(value) {
    const href = httpUrl(value);
    if (!href) return null;
    const u = new URL(href);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(key)) u.searchParams.delete(key);
    u.hostname = u.hostname.toLowerCase();
    u.pathname = u.pathname.replace(/\/+$/, '') || '/'; // "/p/1/" and "/p/1" are the same page
    return u.toString().replace(/\/$/, '');
}

export function stockStatus(status, quantity) {
    const s = text(status).toLowerCase().replace(/[\s_-]+/g, '');
    if (['instock', 'available', 'true', '1', 'yes', 'active'].includes(s)) return 'in_stock';
    if (['outofstock', 'soldout', 'unavailable', 'false', '0', 'no', 'inactive', 'stockout'].includes(s)) return 'out_of_stock';
    if (quantity !== null && quantity !== undefined) return quantity > 0 ? 'in_stock' : 'out_of_stock';
    return 'unknown';
}

const asList = (value, separators = /[\n|]/) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        const t = value.trim();
        if (t.startsWith('[')) {
            try {
                return JSON.parse(t);
            } catch {
                /* fall through to splitting */
            }
        }
        return t ? t.split(separators) : [];
    }
    return [];
};
const asJson = (value, fallback) => {
    if (typeof value !== 'string') return value ?? fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

function normalizeVariants(raw) {
    const list = asJson(raw, []);
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list
        .map((v, i) => {
            const label = text(v?.label ?? v?.name ?? v?.title);
            if (!label) return null;
            let id = text(v?.id ?? v?.sku) || label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || `v${i}`;
            if (seen.has(id)) id = `${id}-${i}`;
            seen.add(id);
            const quantity = v?.stock ?? v?.stock_quantity ?? v?.quantity;
            return {
                id,
                label,
                image: httpUrl(v?.image) || '',
                price: parseMoney(v?.price),
                regularPrice: parseMoney(v?.regular_price ?? v?.old_price),
                stock: quantity === null || quantity === undefined || quantity === '' ? null : Math.max(0, Math.floor(Number(quantity)) || 0)
            };
        })
        .filter(Boolean);
}

function normalizeSpecs(raw) {
    const data = asJson(raw, []);
    const rows = Array.isArray(data)
        ? data.map((x) => [x?.label ?? x?.name ?? x?.key, x?.value])
        : data && typeof data === 'object'
          ? Object.entries(data)
          : String(raw || '')
                .split(/\n|\|/)
                .map((line) => {
                    const i = line.indexOf(':');
                    return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : [];
                });
    return rows.map(([label, value]) => ({ label: text(label), value: text(value) })).filter((r) => r.label && r.value);
}

/** Canonical record, or { error } explaining why the row was refused. */
export function normalizeProduct(raw, { supplier }) {
    const id = text(raw?.supplier_product_id ?? raw?.id ?? raw?.product_id);
    const fail = (error) => ({ ok: false, error, supplier_product_id: id || null, title: text(raw?.title ?? raw?.name) || null });
    if (!id) return fail('missing supplier_product_id');

    const title = text(raw.title ?? raw.name ?? raw.title_en ?? raw.title_bn);
    if (!title) return fail('missing title');

    const price = parseMoney(raw.price ?? raw.selling_price);
    if (price === null || price <= 0) return fail(`invalid price: ${JSON.stringify(raw.price)}`);

    const images = [...new Set(asList(raw.images ?? raw.image).map(httpUrl).filter(Boolean))];
    if (!images.length) return fail('no valid image URL');

    const url = raw.url ?? raw.product_url ?? raw.link;
    if (url && !httpUrl(url)) return fail(`invalid product URL: ${JSON.stringify(url)}`);

    const categoryPath = Array.isArray(raw.category) ? raw.category.map(text).filter(Boolean) : [text(raw.category)].filter(Boolean);
    const quantityRaw = raw.stock_quantity ?? raw.quantity ?? raw.stock;
    const quantity = quantityRaw === null || quantityRaw === undefined || quantityRaw === '' || Number.isNaN(Number(quantityRaw))
        ? null
        : Math.max(0, Math.floor(Number(quantityRaw)));
    const regular = parseMoney(raw.regular_price ?? raw.old_price ?? raw.compare_at_price);

    const record = {
        supplier,
        supplierProductId: id,
        url: httpUrl(url),
        canonicalUrl: canonicalUrl(url),
        title,
        description: text(raw.description),
        category: categoryPath.at(-1) || '',
        supplierCategory: categoryPath.join(' / ') || null,
        brand: nullable(raw.brand),
        sku: nullable(raw.sku),
        price,
        regularPrice: regular !== null && regular > price ? regular : null,
        images,
        variants: normalizeVariants(raw.variants),
        specifications: normalizeSpecs(raw.specifications ?? raw.specs),
        stockStatus: stockStatus(raw.stock_status ?? raw.availability, quantity),
        stockQuantity: quantity
    };
    record.hash = contentHash(record);
    return { ok: true, record };
}

export function contentHash(r) {
    const body = {
        title: r.title, description: r.description, category: r.category, brand: r.brand, sku: r.sku, price: r.price,
        regularPrice: r.regularPrice, images: r.images, variants: r.variants, specifications: r.specifications,
        stockStatus: r.stockStatus, stockQuantity: r.stockQuantity
    };
    return createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32);
}

// ── file readers ──

/** Small RFC-4180 CSV reader (quotes, escaped quotes, commas/newlines inside quotes). */
export function parseCsv(input) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    const src = input.replace(/^﻿/, '');
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (quoted) {
            if (ch === '"' && src[i + 1] === '"') (cell += '"', i++);
            else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') (row.push(cell), (cell = ''));
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && src[i + 1] === '\n') i++;
            row.push(cell);
            cell = '';
            if (row.some((c) => c !== '')) rows.push(row);
            row = [];
        } else cell += ch;
    }
    row.push(cell);
    if (row.some((c) => c !== '')) rows.push(row);
    const [header, ...body] = rows;
    if (!header) return [];
    const keys = header.map((h) => h.trim());
    return body.map((cells) => Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? ''])));
}

/** `.json` (array, or { products: [...] }), `.jsonl` / `.ndjson`, `.csv` → array of raw rows. */
export function parseFeed(content, filename = '') {
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'csv') return parseCsv(content);
    if (ext === 'jsonl' || ext === 'ndjson')
        return content.split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
            try {
                return JSON.parse(l);
            } catch (err) {
                throw new Error(`line ${i + 1}: invalid JSON (${err.message})`);
            }
        });
    const data = JSON.parse(content);
    const list = Array.isArray(data) ? data : data?.products ?? data?.items;
    if (!Array.isArray(list)) throw new Error('JSON feed must be an array, or an object with a "products" array');
    return list;
}
