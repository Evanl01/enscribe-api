import { getSupabaseClient } from '../../utils/supabase.js';
import { supabaseAdmin } from '../../utils/supabaseAdmin.js';
import crypto from 'crypto';
import * as encryptionUtils from '../../utils/encryptionUtils.js';

// Refresh token storage settings
const REFRESH_MAX_AGE_SECONDS = Number(process.env.REFRESH_MAX_AGE_SECONDS || 3 * 24 * 3600);
const refreshTokensTable = 'refreshTokens';

// Cookie options configurable via env
const REFRESH_COOKIE_SAMESITE = (process.env.REFRESH_COOKIE_SAMESITE || 'lax').toLowerCase();
const REFRESH_COOKIE_DOMAIN = process.env.REFRESH_COOKIE_DOMAIN || undefined;
const REFRESH_COOKIE_SECURE = process.env.REFRESH_COOKIE_SECURE
  ? process.env.REFRESH_COOKIE_SECURE === 'true'
  : process.env.NODE_ENV === 'production';

/**
 * Create refresh token cookie with secure settings
 */
export function makeRefreshCookie(wrapper, opts = {}) {
  const maxAge = opts.maxAge ?? REFRESH_MAX_AGE_SECONDS;
  const cookieValue = wrapper || '';
  
  const parts = [
    'refresh_token=' + encodeURIComponent(cookieValue),
    'HttpOnly',
    REFRESH_COOKIE_SECURE ? 'Secure' : '',
    `SameSite=${REFRESH_COOKIE_SAMESITE}`,
    'Path=/',
  ];
  
  if (maxAge) {
    parts.push(`Max-Age=${maxAge}`);
  }
  
  if (REFRESH_COOKIE_DOMAIN) {
    parts.push(`Domain=${REFRESH_COOKIE_DOMAIN}`);
  }
  
  return parts.filter(Boolean).join('; ');
}

/**
 * Sign up a new user
 */
export async function signUp(email, password) {
  try {
    // Route validates email format and password requirements - trust the data
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      return { success: false, error: error.message };
    }

    console.log('[signUp] sign-up result', { hasSession: !!data?.session, hasUser: !!data?.user });

    if (data?.session) {
      // Email confirmation disabled - user is immediately signed in
      return {
        success: true,
        error: null,
        session: data.session,
        user: data.user,
        message: 'signed up and logged in',
      };
    } else if (data?.user) {
      // Email confirmation enabled
      return {
        success: true,
        error: null,
        session: null,
        user: data.user,
        message: 'Email confirmation required',
      };
    }

    return { success: false, error: 'Unknown sign-up result' };
  } catch (err) {
    console.error('[signUp] Error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Sign in an existing user
 */
export async function signIn(email, password) {
  try {
    // Route validates email format and password requirements - trust the data
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      console.log('[signIn] Sign-in failed:', error.message);
      return { success: false, error: error.message };
    }

    console.log('[signIn] Sign-in successful for user:', data.user.id);

    // Persist refresh token server-side
    try {
      const admin = supabaseAdmin();
      const refreshToken = data?.session?.refresh_token;

      if (refreshToken) {
        const tid = crypto.randomUUID();
        const hashed = encryptionUtils.hashToken(refreshToken);
        const enc = encryptionUtils.encryptRefreshToken(refreshToken);

        const { data: insertData, error: insertErr } = await admin
          .from(refreshTokensTable)
          .insert([
            {
              id: tid,
              user_id: data.user.id,
              token_hash: hashed,
              token_enc: enc,
              issued_at: new Date().toISOString(),
              last_activity_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + REFRESH_MAX_AGE_SECONDS * 1000).toISOString(),
              revoked: false,
            },
          ]);

        if (insertErr) {
          console.error('[signIn] Failed to store refresh token:', insertErr);
        } else {
          console.log('[signIn] Refresh token stored with id:', tid);
        }

        return {
          success: true,
          error: null,
          session: data.session,
          user: data.user,
          tid: tid,
        };
      }
    } catch (err) {
      console.error('[signIn] Error storing refresh token:', err);
      // Still return successful sign-in even if refresh token storage fails
    }

    return {
      success: true,
      error: null,
      session: data.session,
      user: data.user,
      tid: null,
    };
  } catch (err) {
    console.error('[signIn] Error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Sign out a user (requires authentication)
 */
export async function signOut(userId, refreshTokenFromCookie = null) {
  try {
    // Revoke server-side refresh token
    if (refreshTokenFromCookie) {
      try {
        const admin = supabaseAdmin();
        const parts = refreshTokenFromCookie.split('.');

        if (parts.length === 3) {
          const [h64, p64, sig] = parts;
          const unsigned = `${h64}.${p64}`;
          const secret = process.env.REFRESH_TOKEN_SIGNING_KEY_HEX;

          if (secret) {
            const expected = crypto
              .createHmac('sha256', secret)
              .update(unsigned)
              .digest('base64url');

            if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
              const payload = JSON.parse(Buffer.from(p64, 'base64url').toString('utf8'));
              const tid = payload.tid;

              if (tid) {
                await admin
                  .from(refreshTokensTable)
                  .update({
                    revoked: true,
                    last_activity_at: new Date().toISOString(),
                  })
                  .eq('id', tid);

                console.log('[signOut] Refresh token revoked:', tid);
              }
            }
          }
        }
      } catch (err) {
        console.error('[signOut] Error revoking refresh token:', err);
      }
    }

    // Sign out from Supabase
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (err) {
    console.error('[signOut] Error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Resend confirmation email
 */
export async function resendConfirmationEmail(email, emailRedirectTo = null) {
  try {
    if (!email) {
      return { success: false, error: 'Email is required' };
    }

    if (!email.includes('@')) {
      return { success: false, error: `Invalid email format: ${email}` };
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: emailRedirectTo ? { emailRedirectTo } : undefined,
    });

    if (error) {
      console.log('[resendConfirmationEmail] Error:', error.message);
      return { success: false, error: error.message };
    }

    console.log('[resendConfirmationEmail] Email sent to:', email);
    return { success: true, error: null };
  } catch (err) {
    console.error('[resendConfirmationEmail] Error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Check if a token is valid (verify authentication)
 */
export async function checkTokenValidity(authHeader) {
  try {
    if (!authHeader) {
      return { success: false, error: 'Authorization header required', user: null };
    }

    const supabase = getSupabaseClient(authHeader);
    const token = authHeader.replace(/^Bearer\s+/i, '');

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return { success: false, error: 'Invalid or expired token', user: null };
    }

    return { success: true, error: null, user: data.user };
  } catch (err) {
    console.error('[checkTokenValidity] Error:', err);
    return { success: false, error: err.message, user: null };
  }
}
