import { getSupabaseClient } from '@/src/utils/supabase';
import { authenticateRequest } from '@/src/utils/authenticateRequest';
import { supabaseAdmin } from '@/src/utils/supabaseAdmin';
import crypto from 'crypto';
import * as encryptionUtils from '@/src/utils/encryptionUtils';
import { serialize } from 'cookie';

// Refresh token storage settings
const REFRESH_MAX_AGE_SECONDS = Number(process.env.REFRESH_MAX_AGE_SECONDS || 3 * 24 * 3600);
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
    const supabase = getSupabaseClient(req.headers.authorization);
    const acceptHeader = (req.headers.accept || '').toLowerCase();
    const wantsJson = acceptHeader.includes('application/json');
    const dbg = (...args) => {
        if (process.env.DEBUG_REFRESH === 'true' || process.env.NODE_ENV !== 'production') {
            console.log('[auth debug]', ...args);
        }
    };
    if (req.method === 'POST') {
        const { action, email, password, emailRedirectTo } = req.body;

        if (!action) {
            return res.status(400).json({ error: 'Action is required (sign-up, sign-in, sign-out, resend)' });
        }

        if ((action === 'sign-up' || action === 'sign-in') && (!email || !password)) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        if ((action === 'sign-up' || action === 'sign-in') && !email.includes('@')) {
            return res.status(400).json({ error: 'Invalid email format: ' + email });
        }

        if (action === 'sign-up') {
            // sign-up and set refresh cookie + persist hashed refresh token server-side (if session returned)
            const { data, error } = await supabase.auth.signUp({ email, password });
            dbg('sign-up attempt', { email });

            if (error) {
                // Handle actual signup errors (network, validation, etc.)
                return res.status(500).json({ error: error.message });
            }

            // Check if we got a session (email confirmation disabled) or just user (confirmation enabled)
            console.log('sign-up result', { data, error });
            if (data?.session) {
                // Email confirmation is disabled, user is immediately signed in
                dbg('sign-up with immediate session', data);
                // If client expects JSON (mobile), return raw tokens. Otherwise set cookie and return safe session
                if (wantsJson) {
                    return res.status(200).json({
                        access_token: data.session.access_token,
                        refresh_token: data.session.refresh_token,
                        expires_at: data.session.expires_at,
                        message: 'signed up and logged in',
                    });
                }
                return res.status(200).json({
                    token: data.session.access_token,
                    message: 'signed up and logged in'
                });
            } else if (data?.user) {
                // Email confirmation is enabled, or existing user (can't distinguish)
                dbg('sign-up confirmation required or existing user', data);
                return res.status(201).json({
                    token: null,
                    message: 'Email confirmation required'
                });
            }
        }

        if (action === 'check-validity') {
            const { user, error: verifyError } = await authenticateRequest(req);
            if (verifyError) return res.status(401).json({ error: verifyError });
            // Optionally return user info or just success
            return res.status(200).json({ valid: true, user });
        }

        if (action === 'sign-in') {
            dbg('sign-in attempt', { email });
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            dbg('sign-in result', { error: !!error, hasSession: !!data?.session, userId: data?.user?.id });
            console.log("Sign-in attempt:", { email });
            if (error) {
                dbg('sign-in error', error.message);
                return res.status(401).json({ error: error.message });
            }

            // persist hashed refresh token + raw token server-side and set cookie to signed wrapper (tid only)
            try {
                const admin = supabaseAdmin();
                const refreshToken = data?.session?.refresh_token;
                dbg('sign-in session contains refreshToken', !!refreshToken);
                let cookieSet = false;
                if (refreshToken) {
                    const tid = crypto.randomUUID();
                    const hashed = encryptionUtils.hashToken(refreshToken);
                    const enc = encryptionUtils.encryptRefreshToken(refreshToken);
                    dbg('inserting refresh token row for sign-in', { tid, user_id: data.user.id });
                    const { data: insertData, error: insertErr } = await admin.from(refreshTokensTable).insert([{ id: tid, user_id: data.user.id, token_hash: hashed, token_enc: enc, issued_at: new Date(), last_activity_at: new Date(), expires_at: new Date(Date.now() + REFRESH_MAX_AGE_SECONDS * 1000), revoked: false }]);
                    dbg('refreshTokens insert result', { insertData, insertErr: insertErr ? insertErr.message : null });
                    // Only create and set cookie when client expects HTML (browser). For mobile/json, return raw refresh token instead.
                    if (!wantsJson) {
                        const header = { alg: 'HS256', typ: 'JWT' };
                        const iat = Math.floor(Date.now() / 1000);
                        const exp = iat + REFRESH_MAX_AGE_SECONDS;
                        const payload = { sub: data.user.id, tid, iat, exp };
                        const toEncode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
                        const unsigned = `${toEncode(header)}.${toEncode(payload)}`;
                        const secret = process.env.REFRESH_TOKEN_SIGNING_KEY_HEX;
                        if (!secret) {
                            dbg('missing REFRESH_TOKEN_SIGNING_KEY_HEX at sign-in');
                            throw new Error('Missing REFRESH_TOKEN_SIGNING_KEY_HEX');
                        }
                        const sig = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
                        const wrapper = `${unsigned}.${sig}`;
                        const cookie = makeRefreshCookie(wrapper);
                        dbg('setting refresh cookie (wrapper trimmed)', String(wrapper).slice(0, 80));
                        res.setHeader('Set-Cookie', cookie);
                        dbg('set-cookie header (dev only)', cookie);
                        cookieSet = true;
                    }
                }
                // attach cookieSet flag to debug return path later
                req._cookieSet = cookieSet;
            } catch (err) {
                console.error('persist refresh token error', err);
                dbg('persist refresh token error', err && err.message);
            }

            // Do not return raw refresh token to client
            if (wantsJson) {
                // Mobile clients asked for JSON: return both access and refresh tokens
                return res.status(200).json({
                    access_token: data?.session?.access_token,
                    refresh_token: data?.session?.refresh_token,
                    expires_at: data?.session?.expires_at || null,
                    cookieSet: !!req._cookieSet || false,
                });
            }

            const safeSession = { ...data?.session };
            if (safeSession) delete safeSession.refresh_token;
            dbg('returning safeSession to client', { userId: data?.user?.id, expiresAt: data?.session?.expires_at });
            return res.status(200).json({ token: safeSession || null, expiresAt: data?.session?.expires_at || null, cookieSet: !!req._cookieSet });
        }

        if (action === 'sign-out') {// Only need req.body.action
            const { user, error: verifyError } = await authenticateRequest(req);
            if (verifyError) return res.status(401).json({ error: verifyError });
            // attempt to revoke server-side refresh token referenced by cookie
            try {
                // parse cookie
                const cookieHeader = req.headers.cookie || '';
                const cookies = Object.fromEntries(cookieHeader.split(';').map(c => {
                    const [k, v] = c.split('=');
                    if (!k) return [];
                    return [k.trim(), decodeURIComponent((v || '').trim())];
                }).filter(Boolean));
                const raw = cookies.refresh_token;
                const admin = supabaseAdmin();
                if (raw) {
                    // raw is wrapper JWT; decode to extract tid and revoke that row
                    try {
                        const parts = raw.split('.');
                        if (parts.length === 3) {
                            const [h64, p64, sig] = parts;
                            const unsigned = `${h64}.${p64}`;
                            const expected = crypto.createHmac('sha256', process.env.REFRESH_TOKEN_SIGNING_KEY_HEX).update(unsigned).digest('base64url');
                            if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
                                const payload = JSON.parse(Buffer.from(p64, 'base64url').toString('utf8'));
                                const tid = payload.tid;
                                if (tid) {
                                    await admin.from(refreshTokensTable).update({ revoked: true, last_activity_at: new Date() }).eq('id', tid);
                                }
                            }
                        }
                    } catch (e) {
                        console.error('error decoding refresh wrapper during sign-out', e);
                    }
                }
                // Clear cookie on sign-out using same options so it reliably clears
                const clear = makeRefreshCookie('', { maxAge: 0 });
                res.setHeader('Set-Cookie', clear);
            } catch (err) {
                console.error('sign-out revoke error', err);
            }

            const { error } = await supabase.auth.signOut();
            if (error) return res.status(500).json({ error: error.message });
            return res.status(200).json({ success: true });
        }

        if (action === 'resend') {
            if (!email) return res.status(400).json({ error: 'Email is required to resend confirmation email' });
            const { error } = await supabase.auth.resend({
                type: 'signup',
                email,
                options: emailRedirectTo ? { emailRedirectTo } : undefined
            });
            console.log('resend confirmation email', { email, error });
            if (error) return res.status(500).json({ error: error.message });
            return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: 'Invalid action' });
    }

    res.status(405).json({ error: 'Method not allowed' });
}