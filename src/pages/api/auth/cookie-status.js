import { supabaseAdmin } from '@/src/utils/supabaseAdmin';
import crypto from 'crypto';
import * as encryptionUtils from '@/src/utils/encryptionUtils';

export default async function handler(req, res) {
  try {
    const cookieHeader = req.headers.cookie || '';
    const cookies = Object.fromEntries(
      cookieHeader
        .split(';')
        .map((c) => {
          const [k, ...v] = c.split('=');
          if (!k) return [];
          return [k.trim(), decodeURIComponent((v || []).join('=').trim())];
        })
        .filter(Boolean)
    );

    const wrapper = cookies.refresh_token || cookies['refresh-token'];
    if (!wrapper) {
      // No cookie present
      return res.status(200).json({ cookiePresent: false });
    }

    // Validate signed wrapper JWT using same logic as refresh.js
    const secret = process.env.REFRESH_TOKEN_SIGNING_KEY_HEX;
    if (!secret) {
      console.error('cookie-status misconfigured: REFRESH_TOKEN_SIGNING_KEY_HEX missing');
      return res.status(500).json({ cookiePresent: false });
    }

    let payload;
    try {
      const parts = wrapper.split('.');
      if (parts.length !== 3) throw new Error('invalid_token_format');
      const [h64, p64, sig] = parts;
      const unsigned = `${h64}.${p64}`;
      const expected = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) throw new Error('invalid_sig');
      payload = JSON.parse(Buffer.from(p64, 'base64url').toString('utf8'));
    } catch (err) {
      console.error('cookie-status wrapper verify failed', err);
      return res.status(200).json({ cookiePresent: false });
    }

    const { tid: tokenId, exp } = payload || {};
    if (!tokenId) return res.status(200).json({ cookiePresent: false });
    if (exp && Date.now() > exp * 1000) return res.status(200).json({ cookiePresent: false });

    // Lookup server-side token row to ensure it's valid and not revoked/expired
    const sb = supabaseAdmin();
    const refreshTokensTable = 'refreshTokens';
    const { data: row, error: lookupErr } = await sb.from(refreshTokensTable).select('*').eq('id', tokenId).limit(1).maybeSingle();
    if (lookupErr) {
      console.error('cookie-status db lookup error', lookupErr);
      return res.status(200).json({ cookiePresent: false });
    }
    if (!row) return res.status(200).json({ cookiePresent: false });
    if (row.revoked) return res.status(200).json({ cookiePresent: false });
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return res.status(200).json({ cookiePresent: false });

    // Decrypt stored token and verify hash
    let rawStoredRefresh;
    try {
      rawStoredRefresh = encryptionUtils.decryptRefreshToken(row.token_enc);
    } catch (err) {
      console.error('cookie-status decrypt stored refresh failed', err);
      // Revoke server row for safety if decryption fails
      try { await sb.from(refreshTokensTable).update({ revoked: true }).eq('id', tokenId); } catch (e) { /* best effort */ }
      return res.status(200).json({ cookiePresent: false });
    }

    const ok = encryptionUtils.verifyTokenHash(rawStoredRefresh, row.token_hash);
    if (!ok) {
      // Revoke and return false
      try { await sb.from(refreshTokensTable).update({ revoked: true }).eq('id', tokenId); } catch (e) { /* best effort */ }
      return res.status(200).json({ cookiePresent: false });
    }

    // All checks passed
    return res.status(200).json({ cookiePresent: true });
  } catch (err) {
    console.error('cookie-status error', err);
    return res.status(500).json({ cookiePresent: false });
  }
}
