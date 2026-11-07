// ========== SUPABASE CONFIG ==========
// Replace these with your own Supabase project credentials
// Get them from: https://app.supabase.com → Project Settings → API

const SUPABASE_URL = 'https://ihbsxjgzrhnssluqooqh.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_hHyHJI5JkxgLNrXAwZrGWQ_vbD3kdrj';

// Check if configured
const isConfigured = () => {
  return SUPABASE_URL !== 'https://YOUR_PROJECT_REF.supabase.co' && 
         SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';
};

// For demo without Supabase (localStorage fallback)
const DEMO_MODE = !isConfigured();

console.log(DEMO_MODE ? '⚠️ DEMO MODE (localStorage) - Configure Supabase for full multiplayer' : '✅ Supabase configured');
