import { createClient } from '@supabase/supabase-js';

export function getSupabaseClient(authHeader, { persistSession = false } = {}) {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      auth: { 
        persistSession: false,
        detectSessionInUrl: false,  // ← Extra: don't auto-detect from URL
        autoRefreshToken: false,     // ← Extra: explicitly disable auto-refresh
        shouldExchangeCodeForSession: false,  // ← Extra: no automatic code exchange
      },
      global: {
        headers: {
          Authorization: authHeader || '',
        }
      }
    }
  );
}

// Helper to create authenticated client with JWT token
export function createAuthClient(token) {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false },
      global: { 
        headers: { 
          Authorization: `Bearer ${token}` 
        } 
      },
    }
  );
}