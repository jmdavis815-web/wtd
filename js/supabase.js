const SUPABASE_URL = "https://sxkhubtdvxswiqpplbth.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_nWT_fFHgXRiplu6r09Jm7A_AMQxCs-h";

window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ✅ IMPORTANT:
// The anon key is meant to be public. Your real security is Row Level Security (RLS).
//
// ✅ Set this to your deployed site origin (GitHub Pages / custom domain).
// Example (GitHub Pages): "https://YOURNAME.github.io/YOURREPO"
// Example (custom domain): "https://what-to-do.com"
//
// This is used for magic-link redirects because local file:// origins break auth redirects.

window.WTD_APP_ORIGIN = "https://jmdavis815-web.github.io/wtd";

