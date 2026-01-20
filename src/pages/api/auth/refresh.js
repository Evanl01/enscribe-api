import { supabaseAdmin } from '@/src/utils/supabaseAdmin';
import crypto from 'crypto';
import * as encryptionUtils from '@/src/utils/encryptionUtils';
import { serialize } from 'cookie';


// Config
const REFRESH_MAX_AGE_SECONDS = Number(process.env.REFRESH_MAX_AGE_SECONDS || 3 * 24 * 3600); // default 3 days
// Use seconds-based env var for readability; convert to ms for comparisons
const REFRESH_INACTIVITY_LIMIT_SECONDS = Number(process.env.REFRESH_INACTIVITY_LIMIT_SECONDS || 3 * 24 * 3600); // default 3 days
const refreshTokensTable = 'refreshTokens';

// Cookie options configurable via env. Defaults are safe for same-site deployments.
const REFRESH_COOKIE_SAMESITE = (process.env.REFRESH_COOKIE_SAMESITE || 'lax').toLowerCase();
const REFRESH_COOKIE_DOMAIN = process.env.REFRESH_COOKIE_DOMAIN || undefined;
const REFRESH_COOKIE_SECURE = process.env.REFRESH_COOKIE_SECURE
  ? process.env.REFRESH_COOKIE_SECURE === 'true'
  : process.env.NODE_ENV === 'production';

const makeRefreshCookie = (wrapper, opts = {}) =>
  serialize('refresh_token', wrapper || '', {
    httpOnly: true,
    secure: REFRESH_COOKIE_SECURE,
    sameSite: REFRESH_COOKIE_SAMESITE,
    path: '/',
    maxAge: opts.maxAge ?? REFRESH_MAX_AGE_SECONDS,
    domain: REFRESH_COOKIE_DOMAIN,
  });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const dbg = (...args) => {
    if (process.env.DEBUG_REFRESH === 'true' || process.env.NODE_ENV !== 'production') {
      console.log('[refresh debug]', ...args);
    }
  };
  dbg('cookie config', { REFRESH_COOKIE_SAMESITE, REFRESH_COOKIE_DOMAIN, REFRESH_COOKIE_SECURE });

  dbg('handler invoked', { method: req.method, url: req.url });

  const sb = supabaseAdmin();

  // parse cookie
  const cookieHeader = req.headers.cookie || '';
  dbg('raw cookie header', cookieHeader ? cookieHeader.slice(0, 200) : '<empty>');
  const cookies = Object.fromEntries(cookieHeader.split(';').map(c => {
    const [k,v] = c.split('=');
    if (!k) return [];
    return [k.trim(), decodeURIComponent((v||'').trim())];
  }).filter(Boolean));

  dbg('parsed cookies keys', Object.keys(cookies));

  // Support multiple client types:
  // - web: httpOnly cookie named `refresh_token`
  // - mobile/native: send the same signed wrapper in the JSON body as `refresh_token`, `refreshToken`, or `token`
  // - mobile/native (alternate): send the same signed wrapper in a header `x-refresh-token` or `refresh-token`
  const wrapperFromBody = req.body && (req.body.refresh_token || req.body.refreshToken || req.body.token);
  const wrapperFromHeader = req.headers['x-refresh-token'] || req.headers['refresh-token'];
  const wrapper = wrapperFromBody || wrapperFromHeader || cookies.refresh_token;
  if (!wrapper) {
    dbg('no refresh_token provided in cookie, body, or headers');
    return res.status(401).json({ error: 'no_refresh_token' });
  }
  dbg('received refresh wrapper source', {
    fromBody: wrapperFromBody,
    fromHeader: wrapperFromHeader,
    fromCookie: cookies.refresh_token
  });
  dbg('received refresh wrapper (trimmed)', String(wrapper).slice(0, 80));

  // If the client passed a refresh token in the request body, treat it as a raw
  // Supabase refresh token from a mobile app. If it came from cookie/header,
  // treat it as a signed wrapper from web client.
  if (wrapperFromBody) {
    dbg('token came from request body, treating as raw refresh token from mobile app');
    try {
      const baseUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token`;
      const url = `${baseUrl}?grant_type=refresh_token`;
      const jsonBody = JSON.stringify({ refresh_token: wrapper });
      dbg('attempting supabase exchange for raw refresh token', { url });
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
        body: jsonBody,
      });

      if (!resp.ok) {
        let text;
        try { text = await resp.text(); } catch (e) { text = '<could not read body>'; }
        console.error('supabase token exchange failed for raw token', text);
        dbg('supabase exchange failed for raw token', { status: resp.status, bodyPreview: String(text).slice(0,200) });
        return res.status(401).json({ error: 'invalid_refresh_exchange' });
      }

      const session = await resp.json();
      const returnedRefresh = session.refresh_token;
      const accessToken = session.access_token;
      dbg('supabase session exchange result for raw token', { hasAccessToken: !!accessToken, hasRefreshToken: !!returnedRefresh });

      if (!accessToken) {
        dbg('no access token returned from supabase for raw token');
        return res.status(500).json({ error: 'no_access_token_from_supabase' });
      }

      // Persist returned refresh token as a new server-side row
      try {
        const newTid = crypto.randomUUID();
        const hashed = encryptionUtils.hashToken(returnedRefresh);
        const enc = encryptionUtils.encryptRefreshToken(returnedRefresh);
        // Determine userId from returned access token if possible
        let userIdFromAccess = null;
        try {
          const parts = accessToken.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            userIdFromAccess = payload.sub || null;
          }
        } catch (e) {
          dbg('failed to decode access token to extract user id', e && e.message);
        }

        const insertObj = { id: newTid, user_id: userIdFromAccess, token_hash: hashed, token_enc: enc, issued_at: new Date(), last_activity_at: new Date(), expires_at: new Date(Date.now() + REFRESH_MAX_AGE_SECONDS * 1000), revoked: false };
        const { error: insertErr } = await sb.from(refreshTokensTable).insert([insertObj]);
        if (insertErr) {
          console.error('insert refresh token error (raw token flow)', insertErr);
          dbg('insertErr (raw token flow)', insertErr.message || insertErr);
        }

        // set cookie wrapper for newTid
        const header = { alg: 'HS256', typ: 'JWT' };
        const iat = Math.floor(Date.now()/1000);
        const expWrapper = iat + REFRESH_MAX_AGE_SECONDS;
        const payloadWrapper = { sub: userIdFromAccess, tid: newTid, iat, exp: expWrapper };
        const toEncode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
        const unsignedWrapper = `${toEncode(header)}.${toEncode(payloadWrapper)}`;
        const sigWrapper = crypto.createHmac('sha256', process.env.REFRESH_TOKEN_SIGNING_KEY_HEX).update(unsignedWrapper).digest('base64url');
        const newWrapper = `${unsignedWrapper}.${sigWrapper}`;
        const cookie = makeRefreshCookie(newWrapper);
        dbg('setting rotated refresh cookie (raw token flow) for newTid', { newTid });
        res.setHeader('Set-Cookie', cookie);

        dbg('returning accessToken to client (raw token flow)');
        return res.status(200).json({ accessToken });
      } catch (err) {
        console.error('persist rotated refresh token error (raw token flow)', err);
        dbg('persist rotated refresh token error (raw token flow)', err && err.message);
      }
    } catch (err) {
      console.error('raw refresh token exchange error', err);
      return res.status(500).json({ error: 'refresh_error' });
    }
  }

  // unwrap signed wrapper JWT to extract tidy id (tid) and user id (sub)
  const secret = process.env.REFRESH_TOKEN_SIGNING_KEY_HEX;
  if (!secret) {
    dbg('REFRESH_TOKEN_SIGNING_KEY_HEX missing');
    return res.status(500).json({ error: 'server_misconfigured' });
  }
  dbg('REFRESH_TOKEN_SIGNING_KEY_HEX present');

  let payload;
  try {
    const parts = wrapper.split('.');
    dbg('token parts length', parts.length);
    if (parts.length !== 3) throw new Error('invalid_token_format');
    const [h64, p64, sig] = parts;
    const unsigned = `${h64}.${p64}`;
    const expected = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) throw new Error('invalid_sig');
    payload = JSON.parse(Buffer.from(p64, 'base64url').toString('utf8'));
    dbg('decoded wrapper payload', { sub: payload.sub, tid: payload.tid, iat: payload.iat, exp: payload.exp });
  } catch (err) {
    console.error('refresh wrapper verify failed', err);
    dbg('wrapper verification failed', err && err.message);
    return res.status(401).json({ error: 'invalid_refresh' });
  }

  const { sub: userId, tid: tokenId, exp } = payload;
  if (!userId || !tokenId) {
    dbg('payload missing sub or tid', { userId, tokenId });
    return res.status(401).json({ error: 'invalid_refresh_payload' });
  }
  if (exp && Date.now() > exp * 1000) {
    dbg('wrapper token expired by exp claim', { exp, now: Date.now() });
    return res.status(401).json({ error: 'refresh_expired' });
  }
  dbg('payload validated', { userId, tokenId, exp });

  // lookup token row
  const { data: rows, error: lookupErr } = await sb.from(refreshTokensTable).select('*').eq('id', tokenId).limit(1).maybeSingle();
  dbg('DB lookup performed for tokenId', tokenId);
  if (lookupErr) {
    console.error('lookup refresh token error', lookupErr);
    dbg('db lookup error', lookupErr.message || lookupErr);
    return res.status(500).json({ error: 'db_error' });
  }
  const row = rows;
  dbg('db row result', row ? { id: row.id, user_id: row.user_id, revoked: row.revoked, expires_at: row.expires_at, last_activity_at: row.last_activity_at } : null);
  if (!row) {
    dbg('no row found for tid');
    return res.status(401).json({ error: 'token_revoked_or_notfound' });
  }
  if (row.revoked) {
    dbg('row is revoked', { id: row.id });
    return res.status(401).json({ error: 'token_revoked' });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    dbg('row expired by expires_at', { expires_at: row.expires_at });
    return res.status(401).json({ error: 'refresh_expired_db' });
  }

  // inactivity check
  if (row.last_activity_at && (Date.now() - new Date(row.last_activity_at).getTime()) > REFRESH_INACTIVITY_LIMIT_SECONDS * 1000) {
    // revoke
    await sb.from(refreshTokensTable).update({ revoked: true }).eq('id', tokenId);
    return res.status(401).json({ error: 'session_inactive' });
  }

  // decrypt stored encrypted token and verify hash
  let rawStoredRefresh;
  try {
    rawStoredRefresh = encryptionUtils.decryptRefreshToken(row.token_enc);
  } catch (err) {
    console.error('failed to decrypt stored refresh token', err);
    dbg('decrypt stored token failed', err && err.message);
    // revoke for safety
    await sb.from(refreshTokensTable).update({ revoked: true }).eq('id', tokenId);
    return res.status(401).json({ error: 'invalid_refresh' });
  }
  const ok = encryptionUtils.verifyTokenHash(rawStoredRefresh, row.token_hash);
  dbg('verifyTokenHash result', ok);
  if (!ok) {
    dbg('hash verification failed, revoking row for safety', { id: tokenId });
    // revoke and fail
    await sb.from(refreshTokensTable).update({ revoked: true }).eq('id', tokenId);
    return res.status(401).json({ error: 'invalid_refresh' });
  }

  // Exchange stored refresh token with Supabase Auth for new session (keep using Supabase-issued access tokens)
  try {
    // Use JSON body with grant_type in query param to match caller's tested curl variant.
    // Example: POST /auth/v1/token?grant_type=refresh_token with { refresh_token }
    const baseUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token`;
    const url = `${baseUrl}?grant_type=refresh_token`;
    const jsonBody = JSON.stringify({ refresh_token: rawStoredRefresh });
    dbg('refresh body preview (json)', String(jsonBody).slice(0, 300));
    dbg('rawStoredRefresh length', rawStoredRefresh ? rawStoredRefresh.length : 0);
    dbg('exchanging refresh token with supabase', { url });
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY
      },
      body: jsonBody
    });

    if (!resp.ok) {
      let text;
      try {
        text = await resp.text();
      } catch (e) {
        text = '<could not read body>';
      }
      console.error('supabase token exchange failed', text);
      dbg('supabase exchange failed', { status: resp.status, bodyPreview: String(text).slice(0, 200) });
      // revoke server-side row for safety
      await sb.from(refreshTokensTable).update({ revoked: true }).eq('id', tokenId);
      return res.status(401).json({ error: 'invalid_refresh_exchange' });
    }

    const session = await resp.json();
    // session contains access_token, refresh_token, expires_in, token_type, provider_token (maybe)
    const returnedRefresh = session.refresh_token;
    const accessToken = session.access_token;
    dbg('supabase session exchange result keys', { hasAccessToken: !!accessToken, hasRefreshToken: !!returnedRefresh, expires_in: session.expires_in });

    if (!accessToken) {
      dbg('no access token returned from supabase');
      return res.status(500).json({ error: 'no_access_token_from_supabase' });
    }

    // persist server-side hashed refreshed token and revoke old row
    let newTid = null;
    try {
      newTid = crypto.randomUUID();
      dbg('persisting rotated refresh token, newTid', newTid);
      const hashed = encryptionUtils.hashToken(returnedRefresh);
      const enc = encryptionUtils.encryptRefreshToken(returnedRefresh);
      const { error: insertErr } = await sb.from(refreshTokensTable).insert([{ id: newTid, user_id: userId, token_hash: hashed, token_enc: enc, issued_at: new Date(), last_activity_at: new Date(), expires_at: new Date(Date.now() + REFRESH_MAX_AGE_SECONDS * 1000), revoked: false }]);
      if (insertErr) {
        console.error('insert refresh token error', insertErr);
        dbg('insertErr', insertErr.message || insertErr);
      }
      // mark old row last_activity_at before revoking for audit/inactivity
      await sb.from(refreshTokensTable).update({ last_activity_at: new Date(), revoked: true }).eq('id', tokenId);
      dbg('old row revoked and new row inserted (if no insertErr)', { oldTid: tokenId, newTid });
    } catch (err) {
      console.error('persist rotated refresh token error', err);
      dbg('persist rotated refresh token error', err && err.message);
    }

    // set cookie to signed wrapper with new tid
    const header = { alg: 'HS256', typ: 'JWT' };
    const iat = Math.floor(Date.now()/1000);
    const expWrapper = iat + REFRESH_MAX_AGE_SECONDS;
    const payloadWrapper = { sub: userId, tid: newTid, iat, exp: expWrapper };
    const toEncode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsignedWrapper = `${toEncode(header)}.${toEncode(payloadWrapper)}`;
    const sigWrapper = crypto.createHmac('sha256', process.env.REFRESH_TOKEN_SIGNING_KEY_HEX).update(unsignedWrapper).digest('base64url');
  const wrapper = `${unsignedWrapper}.${sigWrapper}`;
  const cookie = makeRefreshCookie(wrapper);
  dbg('setting rotated refresh cookie for newTid', { newTid });
  res.setHeader('Set-Cookie', cookie);

  dbg('returning accessToken to client (value suppressed)');
  return res.status(200).json({ accessToken });
  } catch (err) {
    console.error('refresh exchange error', err);
    return res.status(500).json({ error: 'refresh_error' });
  }
}
