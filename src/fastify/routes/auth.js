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
            // User is logged in
            const setCookie = authController.makeRefreshCookie(result.session.refresh_token);
            if (isJsonClient(request)) {
              reply.header('set-cookie', setCookie);
              return reply.status(201).send({
                message: result.message,
                user: result.user,
                token: result.session,
              });
            } else {
              reply.header('set-cookie', setCookie);
              return reply.status(201).send({
                user: result.user,
                token: result.session,
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

          const setCookie = authController.makeRefreshCookie(result.session.refresh_token);
          
          // Create safe session without refresh_token (matches legacy backend behavior)
          const safeSession = { ...result.session };
          delete safeSession.refresh_token;
          
          console.log('[sign-in] safeSession keys:', Object.keys(safeSession));
          console.log('[sign-in] safeSession.access_token:', safeSession.access_token ? `${String(safeSession.access_token).slice(0, 50)}...` : 'MISSING');
          
          if (isJsonClient(request)) {
            reply.header('set-cookie', setCookie);
            return reply.status(200).send({
              message: 'Signed in successfully',
              user: result.user,
              token: safeSession,
              tid: result.tid,
            });
          } else {
            reply.header('set-cookie', setCookie);
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
}

export default fp(authRoutes);
