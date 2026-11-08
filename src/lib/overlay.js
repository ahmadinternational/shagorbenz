// Overlay + toast manager built on the native <dialog> element.
//
//  • <dialog>.showModal() gives us a real focus trap, inert background, and top-layer
//    stacking for free — no z-index wars, no hand-rolled Tab handling.
//  • Opening an overlay pushes a history entry so the phone's Back button closes the
//    sheet instead of leaving the shop.
//  • Drawers/sheets animate via the `.is-open` class (see base.css).

import { escapeHtml, icon, prefersReducedMotion } from './utils.js';

const stack = []; // [{ dlg, onClose, resolvers: [] }]
const CLOSE_MS = 260;
let toastHost = null;

const root = document.documentElement;
const top = () => stack[stack.length - 1];
const find = (dlg) => stack.find((entry) => entry.dlg === dlg);

function syncScrollLock() {
    root.classList.toggle('modal-open', stack.length > 0);
}

function adoptToastHost() {
    if (!toastHost) return;
    const host = top()?.dlg ?? document.body;
    if (toastHost.parentElement !== host) host.appendChild(toastHost);
}

export function isOpen(dlg) {
    return !!find(dlg);
}

export function openDialog(dlg, { onClose } = {}) {
    if (!dlg) return;
    const existing = find(dlg);
    if (existing) {
        // Re-opened while a close animation is running.
        clearTimeout(dlg._closeTimer);
        dlg.classList.add('is-open');
        return;
    }
    if (!dlg.open) dlg.showModal();
    stack.push({ dlg, onClose, resolvers: [] });
    history.pushState({ overlay: dlg.id }, '');
    syncScrollLock();
    adoptToastHost();
    // Two frames so the browser paints the closed state before the transition starts.
    requestAnimationFrame(() => requestAnimationFrame(() => dlg.classList.add('is-open')));
}

function finalize(dlg) {
    const index = stack.findIndex((entry) => entry.dlg === dlg);
    if (index === -1) return;
    const [entry] = stack.splice(index, 1);
    dlg.classList.remove('is-open');
    syncScrollLock();
    adoptToastHost();

    const done = () => {
        if (!find(dlg) && dlg.open) dlg.close();
        entry.onClose?.();
        entry.resolvers.forEach((resolve) => resolve());
    };
    clearTimeout(dlg._closeTimer);
    if (prefersReducedMotion()) done();
    else dlg._closeTimer = setTimeout(done, CLOSE_MS);
}

/** Closes an overlay (animated). Resolves once it is fully closed. */
export function closeDialog(dlg) {
    const entry = find(dlg);
    if (!entry) return Promise.resolve();
    return new Promise((resolve) => {
        entry.resolvers.push(resolve);
        if (top() === entry && history.state?.overlay === dlg.id) {
            history.back(); // popstate → finalize
            // Safety net if the browser never fires popstate.
            setTimeout(() => find(dlg) && finalize(dlg), 500);
        } else {
            finalize(dlg);
        }
    });
}

export async function closeAllDialogs() {
    while (top()) await closeDialog(top().dlg);
}

/** Wire backdrop click, Esc, and [data-close] buttons for a dialog. */
export function bindDialog(dlg) {
    if (!dlg || dlg._bound) return;
    dlg._bound = true;
    dlg.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeDialog(dlg);
    });
    dlg.addEventListener('mousedown', (event) => {
        // The <dialog> itself is the full-screen scrim; its panel is a child.
        if (event.target === dlg) closeDialog(dlg);
    });
    dlg.addEventListener('click', (event) => {
        if (event.target.closest('[data-close]')) closeDialog(dlg);
    });
}

window.addEventListener('popstate', (event) => {
    const entry = top();
    if (entry && event.state?.overlay !== entry.dlg.id) finalize(entry.dlg);
});

// A reload inside an overlay leaves a stale history entry — clear it.
if (history.state?.overlay) history.replaceState(null, '');

// ───────────────────────── Toasts ─────────────────────────

const TOAST_ICONS = { success: 'circle-check', error: 'circle-alert', info: 'info' };

export function toast(message, type = 'success', duration = 2300) {
    if (!toastHost) {
        toastHost = document.createElement('div');
        toastHost.className = 'toasts';
        toastHost.setAttribute('role', 'status');
        toastHost.setAttribute('aria-live', 'polite');
        document.body.appendChild(toastHost);
    }
    adoptToastHost();

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `${icon(TOAST_ICONS[type] || 'info')}<span>${escapeHtml(message)}</span>`;
    toastHost.appendChild(el);
    // Keep the stack short on busy interactions.
    while (toastHost.children.length > 3) toastHost.firstElementChild.remove();

    setTimeout(() => {
        el.classList.add('leaving');
        setTimeout(() => el.remove(), 220);
    }, duration);
}

export const Toast = {
    success: (msg) => toast(msg, 'success'),
    error: (msg) => toast(msg, 'error', 3600),
    info: (msg) => toast(msg, 'info')
};
