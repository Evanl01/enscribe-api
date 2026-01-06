import { createClient } from '@supabase/supabase-js';

export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !serviceKey) {
    console.error('supabaseAdmin: Missing env vars');
    console.error('  NEXT_PUBLIC_SUPABASE_URL:', url ? '✓' : '✗');
    console.error('  SUPABASE_SERVICE_ROLE_KEY:', serviceKey ? '✓' : '✗');
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL');
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export default supabaseAdmin;
