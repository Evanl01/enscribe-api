import fp from 'fastify-plugin';
import * as authController from '../controllers/authController.js';

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
      switch (action) {
        case 'sign-up': {
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
                session: result.session,
              });
            } else {
              reply.header('set-cookie', setCookie);
              return reply.status(201).send({
                user: result.user,
                session: result.session,
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
          const result = await authController.signIn(email, password);
          
          if (!result.success) {
            return reply.status(401).send({ error: result.error });
          }

          const setCookie = authController.makeRefreshCookie(result.session.refresh_token);
          if (isJsonClient(request)) {
            reply.header('set-cookie', setCookie);
            return reply.status(200).send({
              message: 'Signed in successfully',
              user: result.user,
              session: result.session,
              tid: result.tid,
            });
          } else {
            reply.header('set-cookie', setCookie);
            return reply.status(200).send({
              user: result.user,
              session: result.session,
              tid: result.tid,
            });
          }
        }

        case 'sign-out': {
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
          const authHeader = getAuthHeader(request);
          const result = await authController.checkTokenValidity(authHeader);

          if (!result.success) {
            return reply.status(401).send({ error: result.error });
          }

          return reply.status(200).send({
            message: 'Token is valid',
            user: result.user,
          });
        }

        case 'resend': {
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
