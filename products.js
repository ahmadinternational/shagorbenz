import { createClient } from '@supabase/supabase-js';

// ============================================================
// SUPABASE CLIENT INITIALIZATION
// ============================================================
const SUPABASE_URL = 'https://jivoyxizkmqcbetlszzi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imppdm95eGl6a21xY2JldGxzenppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4NTUzMTYsImV4cCI6MjEwMDQzMTMxNn0.eDS6N1AE_vZABU3BPtjWBcYXUMwHwko3F_9v2V93IVo';
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CACHE_KEY = 'shagorbenzProductCache';
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

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
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ products, savedAt: Date.now() })); } catch { /* storage full/unavailable */ }
}

export async function fetchProducts() {
    const cached = readCache();
    const isFresh = cached && (Date.now() - cached.savedAt) < CACHE_TTL_MS;
    if (isFresh) {
        refreshInBackground();
        return cached.products;
    }
    try {
        // ✅ এখানে priority অনুযায়ী সাজানো হয়েছে (ছোট সংখ্যা আগে দেখাবে)
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('priority', { ascending: true }) 
            .order('id', { ascending: false });
            
        if (error) throw error;
        if (!data) return [];

        // ✅ snake_case → camelCase mapping
        const mapped = data.map(p => ({
            id: p.id,
            title: p.title,
            price: p.price,
            oldPrice: p.old_price,
            category: p.category,
            image: p.image,
            stock: p.stock,
            description: p.description,
            priority: p.priority, // ✅ প্রায়োরিটি ম্যাপ করা
            created_at: p.created_at
        }));

        writeCache(mapped);
        return mapped;
    } catch (e) {
        console.error('Supabase fetch error:', e);
        if (cached?.products?.length) return cached.products;
        return [];
    }
}

async function refreshInBackground() {
    try {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('priority', { ascending: true })
            .order('id', { ascending: false });
        if (error || !data) return;
        const mapped = data.map(p => ({
            id: p.id,
            title: p.title,
            price: p.price,
            oldPrice: p.old_price,
            category: p.category,
            image: p.image,
            stock: p.stock,
            description: p.description,
            priority: p.priority,
            created_at: p.created_at
        }));
        writeCache(mapped);
    } catch { /* silent background refresh */ }
}