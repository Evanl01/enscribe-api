import fp from 'fastify-plugin';
import { getSupabaseClient } from '../../utils/supabase.js';

/**
 * Fastify plugin for authentication
 * Verifies JWT token from Authorization header and attaches user to request object
 * 
 * Usage: fastify.register(authenticationPlugin)
 * Then add { onRequest: [fastify.authenticate] } to any route that needs auth
 */
export default fp(async function (fastify, options) {
  /**
   * Authenticate hook - verifies JWT token and sets request.user
   * Can be used as preHandler in route definitions:
   * 
   * fastify.get('/protected', { preHandler: [fastify.authenticate] }, handler)
   */
  fastify.decorate('authenticate', async function (request, reply) {
    try {
      const authHeader = request.headers.authorization || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');

      if (!token) {
        console.log('[authenticate] No token provided');
        return reply.status(401).send({ error: 'JWT Token is required' });
      }

      // Get Supabase client with the bearer token
      const supabase = getSupabaseClient(authHeader);

      // Verify token with Supabase
      const { data, error } = await supabase.auth.getUser(token);

      console.log('[authenticate] Token verification result:', { 
        hasUser: !!data?.user, 
        userId: data?.user?.id,
        error: error?.message 
      });

      if (error || !data?.user) {
        console.log('[authenticate] Invalid/expired token:', error?.message);
        return reply.status(401).send({ error: 'Invalid or expired token' });
      }

      // Attach authenticated user to request object for use in route handlers
      request.user = data.user;
      console.log('[authenticate] User authenticated:', data.user.id);
    } catch (err) {
      console.log('[authenticate] Exception:', err.message);
      fastify.log.error('Authentication error:', err);
      return reply.status(401).send({ error: 'Authentication failed' });
    }
  });
});
