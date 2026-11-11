// Turns one collected public product page (see collect-public-site.mjs) into a feed row for the importer.
// Only what the page shows is used. Anything not shown stays empty — in particular the shop publishes NO category,
// SKU or brand field, so those are never invented here (brand is read only from a "Brand:" line the supplier wrote
// in its own technical-specifications list).

const SITE = 'https://badhonsworld.com';
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const ascii = (s) => String(s ?? '').replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
/** Headings keep double spaces that innerText collapses, so every comparison goes through this. */
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const money = (s) => {
    const m = ascii(s).match(/^৳?\s*([\d,]+(?:\.\d+)?)\s*৳?$/);
    return m ? Number(m[1].replace(/,/g, '')) : null;
};

/** Next.js serves pictures through /_next/image?url=<original>&w=… — the original CloudFront address is what we keep. */
export function originalImage(src) {
    if (!src || src.startsWith('data:')) return null;
    try {
        const u = new URL(src, SITE);
        const url = u.pathname === '/_next/image' ? u.searchParams.get('url') : u.href;
        if (!url) return null;
        const abs = new URL(url, SITE).href;
        return /\/(badhon\.jpg|images\/|icons\/)|whatsapp/i.test(abs) ? null : abs;
    } catch {
        return null;
    }
}

/** "1793164299557-ec57a25….jpg" and "1793164298734-ec57a25….jpg" are the same picture uploaded twice. */
const pictureKey = (url) => url.split('/').pop().replace(/^\d+-/, '').toLowerCase();

const SPEC_HEADING = /technical\s+specifications?|specifications?|স্পেসিফিকেশন/i;
const SPEC_LINE = /^[-•*]\s*([^:\n]{1,48}):\s*(.+)$/;
const SUPPLIER_LINE = /badhon|mayons|ইনবক্স|inbox|facebook\s*group|ফেসবুক\s*গ্রুপ/i;

/** { description, specifications } — specs are moved out of the text (not rewritten) so they are not shown twice. */
export function splitDescription(raw) {
    let lines = raw.replace(/\r/g, '').split('\n');
    // boilerplate footer: warranty / return policy / group links belong to the supplier's own terms, not to this shop
    const cut = lines.findIndex((l) => /^\s*(warranty|return policy)\s*:/i.test(l));
    if (cut >= 0) lines = lines.slice(0, cut);
    lines = lines.filter((l) => !SUPPLIER_LINE.test(l));

    const specs = [];
    const h = lines.findIndex((l) => SPEC_HEADING.test(l) && !SPEC_LINE.test(l.trim()));
    if (h >= 0) {
        let end = h + 1;
        for (; end < lines.length; end++) {
            const t = lines[end].trim();
            if (!t) continue;
            const m = t.match(SPEC_LINE);
            if (!m) break;
            specs.push({ label: m[1].trim(), value: m[2].trim() });
        }
        if (specs.length) lines = [...lines.slice(0, h), ...lines.slice(end)];
    }
    const description = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { description, specifications: specs };
}

export function parseProductPage(raw) {
    const fail = (error) => ({ ok: false, error, id: raw.id });
    const title = norm((raw.headings || []).find((h) => h && h !== "Badhon's World" && h !== 'Description' && !/^What our customer/.test(h)));
    if (!title) return fail('no product title on the page');

    const text = raw.text || '';
    const lines = text.split('\n').map(norm);
    const at = lines.indexOf(title);
    if (at < 0) return fail('title not found in page text');

    // price block: "৳ 1280", "৳ 1400", "-120৳" right under the title
    const prices = [];
    for (let i = at + 1; i < Math.min(at + 8, lines.length) && !/^Available variant|^Delivery time|^Quantity/.test(lines[i]); i++) {
        const n = money(lines[i]);
        if (n !== null && !/^-/.test(lines[i]) && !/৳$/.test(lines[i])) prices.push(n);
        else if (/^৳/.test(lines[i]) && n !== null) prices.push(n);
    }
    const price = prices[0] ?? null;
    const regular = prices[1] ?? null;

    // variants: "Available variant:" then pairs of "<label>" / "Stock: N"
    const variants = [];
    const vStart = lines.indexOf('Available variant:');
    let stockLine = null;
    const stop = /^(In Stock|Out of Stock|Delivery time)/i;
    if (vStart >= 0) {
        let label = null;
        for (let i = vStart + 1; i < lines.length && !stop.test(lines[i]); i++) {
            const m = lines[i].match(/^Stock:\s*(\d+)/i);
            if (m && label) { variants.push({ label, stock: Number(m[1]) }); label = null; }
            else if (lines[i] && !m) label = lines[i];
        }
    }
    for (let i = Math.max(vStart, at); i < Math.min(lines.length, (vStart >= 0 ? vStart : at) + 40); i++) if (/^(In Stock|Out of Stock)$/i.test(lines[i])) { stockLine = lines[i]; break; }
    const stockStatus = /^Out of Stock$/i.test(stockLine || '') ? 'out_of_stock' : /^In Stock$/i.test(stockLine || '') ? 'in_stock' : null;
    const stockQuantity = variants.length ? variants.reduce((s, v) => s + v.stock, 0) : null;

    // description section
    const dStart = text.indexOf('\nDescription\n');
    const dEnd = text.indexOf('\nWhat our customer says about this product?');
    const rawDescription = dStart >= 0 ? text.slice(dStart + '\nDescription\n'.length, dEnd > dStart ? dEnd : undefined).trim() : '';
    const { description, specifications } = splitDescription(rawDescription);
    const brand = specifications.find((s) => /^brand$/i.test(s.label))?.value || null;

    // images: this product's own picture(s), de-duplicated; "recommended" cards (other alt texts) are ignored
    const imgs = (raw.images || []).map((i) => ({ url: originalImage(i.src), alt: i.alt })).filter((i) => i.url);
    const own = [
        ...imgs.filter((i) => norm(i.alt) === title),
        ...imgs.filter((i) => /^uploads\//.test(i.alt))
    ];
    const seen = new Set();
    const images = own.map((i) => i.url).filter((u) => (seen.has(pictureKey(u)) ? false : seen.add(pictureKey(u))));

    if (price === null) return fail('price not found on the page');
    return {
        ok: true,
        row: {
            supplier_product_id: raw.id,
            url: `${SITE}/products/${raw.id}`,
            title,
            description,
            price,
            ...(regular && regular > price ? { regular_price: regular } : {}),
            images,
            brand,
            variants: variants.map((v) => ({ label: v.label, stock: v.stock })),
            specifications,
            stock_status: stockStatus || (stockQuantity !== null ? (stockQuantity > 0 ? 'in_stock' : 'out_of_stock') : 'unknown'),
            ...(stockQuantity !== null ? { stock_quantity: stockQuantity } : {})
        }
    };
}

/**
 * Extra figures shown only when signed in to YOUR reseller account:
 *   "৳ 1209" (price shown to resellers) · "Buy rate: 699৳" (what you pay) · "Commission: 510৳" · "Minimum selling price: 749৳"
 * Returns null when the page shows no reseller block (e.g. not signed in).
 */
export function parseResellerPrices(raw) {
    const text = raw.text || '';
    const num = (re) => {
        const m = ascii(text).match(re);
        return m ? Number(m[1].replace(/,/g, '')) : null;
    };
    const buyRate = num(/Buy rate:\s*৳?\s*([\d,]+(?:\.\d+)?)/i);
    if (buyRate === null) return null;
    const title = norm((raw.headings || []).find((h) => h && h !== "Badhon's World" && h !== 'Description' && !/^What our customer/.test(h)));
    const lines = text.split('\n').map(norm);
    const at = title ? lines.indexOf(title) : -1;
    let shown = null;
    for (let i = at + 1; at >= 0 && i < Math.min(at + 6, lines.length); i++) {
        if (/^Buy rate/i.test(lines[i])) break;
        const n = money(lines[i]);
        if (n !== null && /^৳/.test(lines[i])) { shown = n; break; }
    }
    return {
        shownPrice: shown,
        buyRate,
        commission: num(/Commission:\s*৳?\s*([\d,]+(?:\.\d+)?)/i),
        minSellingPrice: num(/Minimum selling price:\s*৳?\s*([\d,]+(?:\.\d+)?)/i)
    };
}
