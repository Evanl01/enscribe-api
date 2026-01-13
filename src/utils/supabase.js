import { createClient } from '@supabase/supabase-js';

export function getSupabaseClient(authHeader, { persistSession = false } = {}) {
  // If you create a client without disabling session persistence,
  // supabase-js will read any stored session from localStorage and set
  // the Authorization header automatically. To avoid picking up a
  // previously-stored token (useful for tests), call this with
  // `{ persistSession: false }` or pass an explicit authHeader.

  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      auth: { persistSession },
      global: {
        headers: {
          // If you pass an explicit authHeader we set it here. When empty,
          // createClient will not apply any header unless a persisted
          // session is present — which is prevented when persistSession=false.
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