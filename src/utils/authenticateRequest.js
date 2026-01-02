import { getSupabaseClient } from './supabase.js';
/**
 * Extracts and verifies the JWT token from the request headers.
 * @param {object} req - The Next.js API request object.
 * @returns {Promise<{ user: object|null, error: string|null }>} - Returns a promise that resolves to an object containing the user and any error message.
 */
export async function authenticateRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  // const dbg = (...args) => {
  //   if (process.env.DEBUG_REFRESH === 'true' || process.env.NODE_ENV !== 'production') console.log('[authn debug]', ...args);
  // };
  // dbg('authenticateRequest header present', !!authHeader);
  if (!token) {
    return { user: null, error: 'JWT Token is required' };
  }

  // Pass the full Authorization header into getSupabaseClient so the
  // client sees the 'Bearer ' prefix as expected by supabase-js global headers.
  const supabase = getSupabaseClient(authHeader);
  // dbg('calling supabase.auth.getUser with masked token', token ? `${token.slice(0,6)}...${token.slice(-6)}` : '<none>');
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    // dbg('Token verification error', error || null, data || null);
    return { user: null, error: 'Invalid or expired token' };
  }
  // console.log('Token verified successfully:', data.user);

  return { user: data.user, error: null };
}