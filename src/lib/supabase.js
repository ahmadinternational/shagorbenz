import { createClient } from '@supabase/supabase-js';

// The anon key is a public, browser-safe key — access is governed by Row Level
// Security in Supabase. Override per environment with VITE_SUPABASE_* variables.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://jivoyxizkmqcbetlszzi.supabase.co';
const SUPABASE_ANON_KEY =
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imppdm95eGl6a21xY2JldGxzenppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4NTUzMTYsImV4cCI6MjEwMDQzMTMxNn0.eDS6N1AE_vZABU3BPtjWBcYXUMwHwko3F_9v2V93IVo';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

/** Contact details shown across the site (single source of truth). */
export const SITE = {
    name: 'SHAGORBENZ',
    whatsappNumber: '8801851149230',
    whatsappDisplay: '০১৮৫১-১৪৯২৩০'
};

export const whatsappLink = (text = '') =>
    `https://wa.me/${SITE.whatsappNumber}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
