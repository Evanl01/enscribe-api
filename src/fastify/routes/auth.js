import fp from 'fastify-plugin';
import * as authController from '../controllers/authController.js';
import { serializeZodError } from '../utils/serializeZodError.js';
import {
  authSignUpRequestSchema,
  authSignInRequestSchema,
  authSignOutRequestSchema,
  authCheckValidityRequestSchema,
  authResendRequestSchema,
} from '../schemas/requests.js';

/**
 * Fastify plugin for authentication routes
 * Handles: sign-up, sign-in, sign-out, check-validity, resend
 */
async function authRoutes(fastify, opts) {
  // Extract auth header from request
  const getAuthHeader = (request) => {
    return request.headers.authorization || null;
  };

  // Check if client prefers JSON (mobile) or HTML (browser)
  const isJsonClient = (request) => {
    const accept = request.headers['accept'] || '';
    return accept.includes('application/json');
  };

  /**
   * POST /auth
   * Handles: sign-up, sign-in, sign-out, check-validity, resend
   * 
   * Body:
   * {
   *   action: 'sign-up' | 'sign-in' | 'sign-out' | 'check-validity' | 'resend',
   *   email?: string,
   *   password?: string,
   *   emailRedirectTo?: string
   * }
   */
  fastify.post('/auth', async (request, reply) => {
    const { action, email, password, emailRedirectTo } = request.body || {};

    console.log(`[POST /auth] action=${action}, email=${email}`);

    try {
      // Validate action field first
      if (!action || typeof action !== 'string') {
        return reply.status(400).send({
          error: serializeZodError({
            issues: [{
              code: 'invalid_type',
              path: ['action'],
              message: 'Action is required and must be a string',
            }],
          }),
        });
      }

      // Validate request based on action
      let validation;
      switch (action) {
        case 'sign-up': {
          validation = authSignUpRequestSchema.safeParse(request.body);
          if (!validation.success) {
            return reply.status(400).send({ error: serializeZodError(validation.error) });
          }
          const result = await authController.signUp(email, password);
          
          if (!result.success) {
            return reply.status(400).send({ error: result.error });
          }

          if (result.session) {
            // User is logged in - create wrapper JWT with tid
            let wrapper = null;
            if (result.tid) {
              try {
                wrapper = authController.createRefreshWrapper(result.user.id, result.tid);
                console.log('[sign-up] Wrapper JWT created for tid:', result.tid);
              } catch (err) {
                console.error('[sign-up] Failed to create wrapper JWT:', err);
              }
            }
            
            const setCookie = wrapper ? authController.makeRefreshCookie(wrapper) : '';
            
            // Create safe session without refresh_token
            const safeSession = { ...result.session };
            delete safeSession.refresh_token;
            
            if (isJsonClient(request)) {
              if (setCookie) reply.header('set-cookie', setCookie);
              return reply.status(201).send({
                message: result.message,
                user: result.user,
                token: safeSession,
              });
            } else {
              if (setCookie) reply.header('set-cookie', setCookie);
              return reply.status(201).send({
                user: result.user,
                token: safeSession,
              });
            }
          } else {
            // Email confirmation required
            return reply.status(201).send({
              message: result.message,
              user: result.user,
              session: null,
            });
          }
        }

        case 'sign-in': {
          validation = authSignInRequestSchema.safeParse(request.body);
          if (!validation.success) {
            return reply.status(400).send({ error: serializeZodError(validation.error) });
          }
          const result = await authController.signIn(email, password);
          
          if (!result.success) {
            return reply.status(401).send({ error: result.error });
          }

          // Create wrapper JWT with tid for cookie
          let wrapper = null;
          if (result.tid) {
            try {
              wrapper = authController.createRefreshWrapper(result.user.id, result.tid);
              console.log('[sign-in] Wrapper JWT created for tid:', result.tid);
            } catch (err) {
              console.error('[sign-in] Failed to create wrapper JWT:', err);
            }
          }
          
          const setCookie = wrapper ? authController.makeRefreshCookie(wrapper) : '';
          
          // Create safe session without refresh_token (matches legacy backend behavior)
          const safeSession = { ...result.session };
          delete safeSession.refresh_token;
          
          console.log('[sign-in] safeSession keys:', Object.keys(safeSession));
          console.log('[sign-in] safeSession.access_token:', safeSession.access_token ? `${String(safeSession.access_token).slice(0, 50)}...` : 'MISSING');
          
          if (isJsonClient(request)) {
            if (setCookie) reply.header('set-cookie', setCookie);
            return reply.status(200).send({
              message: 'Signed in successfully',
              user: result.user,
              token: safeSession,
              tid: result.tid,
            });
          } else {
            if (setCookie) reply.header('set-cookie', setCookie);
            return reply.status(200).send({
              user: result.user,
              token: safeSession,
              tid: result.tid,
            });
          }
        }

        case 'sign-out': {
          validation = authSignOutRequestSchema.safeParse(request.body);
          if (!validation.success) {
            return reply.status(400).send({ error: serializeZodError(validation.error) });
          }
          // Get user from auth header
          const authHeader = getAuthHeader(request);
          const tokenCheck = await authController.checkTokenValidity(authHeader);

          if (!tokenCheck.success) {
            return reply.status(401).send({ error: 'Not authenticated' });
          }

          // Get refresh token from cookie
          const refreshTokenFromCookie = request.cookies.refresh_token || null;
          const result = await authController.signOut(tokenCheck.user.id, refreshTokenFromCookie);

          if (!result.success) {
            return reply.status(500).send({ error: result.error });
          }

          // Clear cookie
          const clearCookie = authController.makeRefreshCookie('', { maxAge: 0 });
          reply.header('set-cookie', clearCookie);
          return reply.status(200).send({ message: 'Signed out successfully' });
        }

        case 'check-validity': {
          validation = authCheckValidityRequestSchema.safeParse(request.body);
          if (!validation.success) {
            return reply.status(400).send({ error: serializeZodError(validation.error) });
          }
          const authHeader = getAuthHeader(request);
          const result = await authController.checkTokenValidity(authHeader);

          if (!result.success) {
            return reply.status(401).send({ error: result.error });
          }

          return reply.status(200).send({
            valid: true,
            message: 'Token is valid',
            user: result.user,
          });
        }

        case 'resend': {
          validation = authResendRequestSchema.safeParse(request.body);
          if (!validation.success) {
            return reply.status(400).send({ error: serializeZodError(validation.error) });
          }
          const result = await authController.resendConfirmationEmail(
            email,
            emailRedirectTo
          );

          if (!result.success) {
            return reply.status(400).send({ error: result.error });
          }

          return reply.status(200).send({
            message: 'Confirmation email sent',
          });
        }

        default: {
          return reply.status(400).send({
            error: `Unknown action: ${action}. Must be one of: sign-up, sign-in, sign-out, check-validity, resend`,
          });
        }
      }
    } catch (err) {
      console.error('[POST /auth] Error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /auth/refresh
   * Refreshes access token using refresh token from cookie
   * Returns new access token with new wrapper JWT (token rotation)
   */
  fastify.post('/auth/refresh', async (request, reply) => {
    try {
      fastify.log.info({
        event: 'auth_refresh',
        step: 'request_received',
        availableCookies: Object.keys(request.cookies),
        cookieCount: Object.keys(request.cookies).length,
        rawCookieHeader: request.headers.cookie || 'NO_HEADER',
      });

      const wrapper = request.cookies.refresh_token || null;
      
      if (!wrapper) {
        fastify.log.error({
          event: 'auth_refresh',
          step: 'no_cookie',
          error: 'No refresh token cookie found',
          availableCookies: Object.keys(request.cookies),
          allCookies: request.cookies,
          cookieHeader: request.headers.cookie,
        });
        return reply.status(401).send({ error: 'No refresh token cookie found' });
      }

      // Extract tid from wrapper for logging
      let wrapperTid = null;
      try {
        const parts = wrapper.split('.');
        if (parts.length === 3) {
          const p64 = parts[1];
          const payload = JSON.parse(Buffer.from(p64, 'base64url').toString('utf8'));
          wrapperTid = payload.tid;
        }
      } catch (e) {
        // ignore
      }

      fastify.log.info({
        event: 'auth_refresh',
        step: 'start',
        wrapperTid,
        wrapperLength: wrapper?.length || 0,
        wrapperPreview: wrapper ? wrapper.substring(0, 50) + '...' : 'null',
      });

      const result = await authController.refreshRefreshToken(wrapper, fastify.log);

      if (!result.success) {
        fastify.log.error({
          event: 'auth_refresh',
          step: 'failed',
          error: result.error,
          wrapperTid,
          userId: result.debugUserId || 'unknown',
          oldTokenId: result.debugOldTokenId || 'unknown',
        });
        
        // Clear invalid cookie
        const clearCookie = authController.makeRefreshCookie('', { maxAge: 0 });
        reply.header('set-cookie', clearCookie);
        
        return reply.status(401).send({ error: result.error });
      }

      // Success - create new wrapper JWT with new tid and return new access token
      fastify.log.info({
        event: 'auth_refresh',
        step: 'success',
        newTokenId: result.newTokenId,
      });
      // Extract user ID from access token for new wrapper JWT
      let userId = null;
      try {
        const parts = result.accessToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
          userId = payload.sub || null;
        }
      } catch (e) {
        fastify.log.warn({
          event: 'auth_refresh',
          step: 'warning',
          message: 'Could not extract user ID from access token',
        });
      }

      // Create new wrapper JWT with new tid
      const newWrapper = authController.createRefreshWrapper(userId, result.newTokenId);
      const cookie = authController.makeRefreshCookie(newWrapper);
      reply.header('set-cookie', cookie);

      return reply.status(200).send({
        accessToken: result.accessToken,
      });
    } catch (err) {
      fastify.log.error({
        event: 'auth_refresh',
        step: 'error',
        error: err.message,
      });
      return reply.status(500).send({ error: 'Failed to refresh token' });
    }
  });

  /**
   * GET /auth/cookie-status
   * Checks if refresh token cookie is valid and present
   * Used for detecting incognito/private browsing mode
   */
  fastify.get('/auth/cookie-status', async (request, reply) => {
    try {
      const wrapper = request.cookies.refresh_token || null;
      
      if (!wrapper) {
        return reply.status(200).send({ cookiePresent: false });
      }

      console.log('[GET /auth/cookie-status] Checking cookie validity');
      const result = await authController.checkRefreshCookieStatus(wrapper);

      return reply.status(200).send({
        cookiePresent: result.cookiePresent,
      });
    } catch (err) {
      console.error('[GET /auth/cookie-status] Error:', err);
      return reply.status(200).send({ cookiePresent: false });
    }
  });
}

export default fp(authRoutes);
