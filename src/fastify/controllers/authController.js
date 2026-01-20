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
 * Create a signed wrapper JWT for refresh token
 * Contains tid (token ID) and user ID, signed with HMAC-SHA256
 * This is what goes in the HTTP-Only cookie
 */
export function createRefreshWrapper(userId, tid) {
  const secret = process.env.REFRESH_TOKEN_SIGNING_KEY_HEX;
  if (!secret) {
    throw new Error('REFRESH_TOKEN_SIGNING_KEY_HEX not configured');
  }

  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + REFRESH_MAX_AGE_SECONDS;
  const payload = { sub: userId, tid, iat, exp };

  const toEncode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${toEncode(header)}.${toEncode(payload)}`;
  const sig = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');

  return `${unsigned}.${sig}`;
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
      // Persist refresh token server-side (same as sign-in)
      let tid = null;
      try {
        const admin = supabaseAdmin();
        const refreshToken = data?.session?.refresh_token;

        if (refreshToken) {
          tid = crypto.randomUUID();
          const hashed = encryptionUtils.hashToken(refreshToken);
          const enc = encryptionUtils.encryptRefreshToken(refreshToken);

          const { error: insertErr } = await admin
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
            console.error('[signUp] Failed to store refresh token:', insertErr);
          } else {
            console.log('[signUp] Refresh token stored with id:', tid);
          }
        }
      } catch (err) {
        console.error('[signUp] Error storing refresh token:', err);
      }

      return {
        success: true,
        error: null,
        session: data.session,
        user: data.user,
        message: 'signed up and logged in',
        tid: tid,
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
 * Refresh a refresh token
 * Validates refresh token from cookie, checks inactivity, exchanges with Supabase
 * Updates token in DB and returns new access token
 */
export async function refreshRefreshToken(wrapper) {
  try {
    const REFRESH_INACTIVITY_LIMIT_SECONDS = Number(process.env.REFRESH_INACTIVITY_LIMIT_SECONDS || 3 * 24 * 3600);
    const secret = process.env.REFRESH_TOKEN_SIGNING_KEY_HEX;

    if (!secret) {
      console.error('[refreshRefreshToken] REFRESH_TOKEN_SIGNING_KEY_HEX missing');
      return { success: false, error: 'Server misconfigured' };
    }

    if (!wrapper) {
      return { success: false, error: 'no_refresh_token' };
    }

    // Decode and validate wrapper JWT
    let payload;
    try {
      const parts = wrapper.split('.');
      if (parts.length !== 3) throw new Error('invalid_token_format');
      
      const [h64, p64, sig] = parts;
      const unsigned = `${h64}.${p64}`;
      const expected = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
      
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
        throw new Error('invalid_sig');
      }
      
      payload = JSON.parse(Buffer.from(p64, 'base64url').toString('utf8'));
    } catch (err) {
      console.error('[refreshRefreshToken] Wrapper verification failed:', err.message);
      return { success: false, error: 'invalid_refresh' };
    }

    const { sub: userId, tid: oldTokenId, exp } = payload;
    if (!userId || !oldTokenId) {
      return { success: false, error: 'invalid_refresh_payload' };
    }

    if (exp && Date.now() > exp * 1000) {
      return { success: false, error: 'refresh_expired' };
    }

    // Lookup old token row in DB
    const admin = supabaseAdmin();
    const { data: oldRow, error: lookupErr } = await admin
      .from(refreshTokensTable)
      .select('*')
      .eq('id', oldTokenId)
      .limit(1)
      .maybeSingle();

    if (lookupErr) {
      console.error('[refreshRefreshToken] DB lookup error:', lookupErr);
      return { success: false, error: 'db_error' };
    }

    if (!oldRow) {
      return { success: false, error: 'token_revoked_or_notfound' };
    }

    if (oldRow.revoked) {
      return { success: false, error: 'token_revoked' };
    }

    if (new Date(oldRow.expires_at).getTime() < Date.now()) {
      return { success: false, error: 'refresh_expired_db' };
    }

    // Check inactivity
    if (oldRow.last_activity_at && (Date.now() - new Date(oldRow.last_activity_at).getTime()) > REFRESH_INACTIVITY_LIMIT_SECONDS * 1000) {
      await admin.from(refreshTokensTable).update({ revoked: true }).eq('id', oldTokenId);
      console.log('[refreshRefreshToken] Token revoked due to inactivity:', oldTokenId);
      return { success: false, error: 'session_inactive' };
    }

    // Decrypt stored encrypted token and verify hash
    let rawStoredRefresh;
    try {
      rawStoredRefresh = encryptionUtils.decryptRefreshToken(oldRow.token_enc);
    } catch (err) {
      console.error('[refreshRefreshToken] Decrypt failed:', err.message);
      await admin.from(refreshTokensTable).update({ revoked: true }).eq('id', oldTokenId);
      return { success: false, error: 'invalid_refresh' };
    }

    const hashOk = encryptionUtils.verifyTokenHash(rawStoredRefresh, oldRow.token_hash);
    if (!hashOk) {
      console.error('[refreshRefreshToken] Hash verification failed');
      await admin.from(refreshTokensTable).update({ revoked: true }).eq('id', oldTokenId);
      return { success: false, error: 'invalid_refresh' };
    }

    // Exchange with Supabase
    try {
      const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error('Supabase not configured');
      }

      const url = `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'apikey': supabaseServiceKey,
        },
        body: JSON.stringify({ refresh_token: rawStoredRefresh }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '<no body>');
        console.error('[refreshRefreshToken] Supabase exchange failed:', text);
        await admin.from(refreshTokensTable).update({ revoked: true }).eq('id', oldTokenId);
        return { success: false, error: 'invalid_refresh_exchange' };
      }

      const session = await resp.json();
      const accessToken = session.access_token;
      const newRefreshToken = session.refresh_token;

      if (!accessToken) {
        return { success: false, error: 'no_access_token_from_supabase' };
      }

      // Create NEW token row with new tid (token rotation with revocation of old row)
      try {
        const newTokenId = crypto.randomUUID();
        const hashed = encryptionUtils.hashToken(newRefreshToken);
        const enc = encryptionUtils.encryptRefreshToken(newRefreshToken);

        // Insert new row with new tid
        const { error: insertErr } = await admin
          .from(refreshTokensTable)
          .insert([{
            id: newTokenId,
            user_id: userId,
            token_hash: hashed,
            token_enc: enc,
            issued_at: new Date().toISOString(),
            last_activity_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + REFRESH_MAX_AGE_SECONDS * 1000).toISOString(),
            revoked: false,
          }]);

        if (insertErr) {
          console.error('[refreshRefreshToken] Failed to insert new token row:', insertErr);
          return { success: false, error: 'token_rotation_failed' };
        }

        // Revoke old row for security
        await admin.from(refreshTokensTable).update({ revoked: true }).eq('id', oldTokenId);

        console.log('[refreshRefreshToken] Token rotated: old tid revoked, new tid created', { oldTokenId, newTokenId });

        return {
          success: true,
          accessToken,
          newTokenId, // Return new tid so route can create new wrapper JWT
        };
      } catch (err) {
        console.error('[refreshRefreshToken] Failed to rotate token:', err);
        return { success: false, error: 'token_rotation_failed' };
      }
    } catch (err) {
      console.error('[refreshRefreshToken] Exchange error:', err.message);
      return { success: false, error: 'refresh_error' };
    }
  } catch (err) {
    console.error('[refreshRefreshToken] Unexpected error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Check if refresh cookie is valid and present
 */
export async function checkRefreshCookieStatus(wrapper) {
  try {
    const secret = process.env.REFRESH_TOKEN_SIGNING_KEY_HEX;

    if (!wrapper || !secret) {
      return { success: true, cookiePresent: false };
    }

    // Validate wrapper JWT
    let payload;
    try {
      const parts = wrapper.split('.');
      if (parts.length !== 3) throw new Error('invalid_token_format');
      
      const [h64, p64, sig] = parts;
      const unsigned = `${h64}.${p64}`;
      const expected = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
      
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
        throw new Error('invalid_sig');
      }
      
      payload = JSON.parse(Buffer.from(p64, 'base64url').toString('utf8'));
    } catch (err) {
      return { success: true, cookiePresent: false };
    }

    const { tid: tokenId, exp } = payload;
    if (!tokenId) return { success: true, cookiePresent: false };
    if (exp && Date.now() > exp * 1000) return { success: true, cookiePresent: false };

    // Lookup in DB
    const admin = supabaseAdmin();
    const { data: row, error } = await admin
      .from(refreshTokensTable)
      .select('*')
      .eq('id', tokenId)
      .limit(1)
      .maybeSingle();

    if (error || !row) return { success: true, cookiePresent: false };
    if (row.revoked) return { success: true, cookiePresent: false };
    if (new Date(row.expires_at).getTime() < Date.now()) return { success: true, cookiePresent: false };

    // Verify hash
    try {
      const rawStoredRefresh = encryptionUtils.decryptRefreshToken(row.token_enc);
      const ok = encryptionUtils.verifyTokenHash(rawStoredRefresh, row.token_hash);
      if (!ok) return { success: true, cookiePresent: false };
    } catch (err) {
      return { success: true, cookiePresent: false };
    }

    return { success: true, cookiePresent: true };
  } catch (err) {
    console.error('[checkRefreshCookieStatus] Error:', err);
    return { success: true, cookiePresent: false };
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
