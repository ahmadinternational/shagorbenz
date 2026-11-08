// Small, dependency-free helpers shared by the storefront and the admin panel.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
/** Converts Bengali digits to ASCII so "০১৭১২…" works in numeric checks. */
export const toEnglishDigits = (value) =>
    String(value ?? '').replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

/** "+8801712-345678", "8801712345678", "০১৭১২৩৪৫৬৭৮" → "01712345678" */
export function normalizePhone(raw) {
    let digits = toEnglishDigits(raw).replace(/\D/g, '');
    if (digits.startsWith('880') && digits.length >= 13) digits = digits.slice(2);
    return digits;
}
export const PHONE_REGEX = /^01[3-9]\d{8}$/;
export const isValidPhone = (raw) => PHONE_REGEX.test(normalizePhone(raw));

const numberFormat = new Intl.NumberFormat('bn-BD', { maximumFractionDigits: 2 });
export const formatNumber = (n) => numberFormat.format(Number(n) || 0);
/** "১,২৯০ ৳" — a no-break space keeps the sign on the same line as the number. */
export const formatPrice = (n) => `${formatNumber(n)}\u00A0৳`;

const dateTimeFormat = new Intl.DateTimeFormat('bn-BD', { dateStyle: 'medium', timeStyle: 'short' });
export function formatDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : dateTimeFormat.format(d);
}

/** Inline SVG icon pulled from /icons.svg (see public/icons.svg). */
export function icon(name, className = '') {
    const base = import.meta.env.BASE_URL || '/';
    return `<svg class="icon ${className}" aria-hidden="true" focusable="false"><use href="${base}icons.svg#i-${name}"></use></svg>`;
}

export function debounce(fn, wait = 200) {
    let timer;
    const debounced = (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
    debounced.cancel = () => clearTimeout(timer);
    return debounced;
}

/** localStorage wrapper that never throws (private mode, quota, disabled storage). */
export const storage = {
    get(key, fallback = null) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return fallback;
            const parsed = JSON.parse(raw);
            return parsed ?? fallback;
        } catch {
            return fallback;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch {
            return false;
        }
    },
    remove(key) {
        try {
            localStorage.removeItem(key);
        } catch {
            /* ignore */
        }
    }
};

export const prefersReducedMotion = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Promise-friendly clipboard copy with a textarea fallback for older browsers. */
export async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(area);
        area.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch {
            ok = false;
        }
        area.remove();
        return ok;
    }
}
