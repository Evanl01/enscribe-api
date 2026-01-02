import fp from 'fastify-plugin';
import { getSupabaseClient } from '../../utils/supabase.js';
import {
  getOneDotPhrase,
  getAllDotPhrasesForUser,
  createDotPhrase,
  updateDotPhrase,
  deleteDotPhrase,
} from '../controllers/dotPhrasesController.js';

/**
 * Fastify plugin for dot phrases routes
 * Handles CRUD operations for user's dot phrases
 */
export default fp(async function dotPhrasesRoutes(fastify, options) {
  /**
   * GET /dotphrases/:id
   * Get a single dot phrase by ID (requires authentication)
   */
  fastify.get(
    '/dotphrases/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const supabase = getSupabaseClient(request.headers.authorization);

        const result = await getOneDotPhrase(request.user.id, id, supabase);

        if (!result.success) {
          return reply.status(404).send({ error: result.error });
        }

        return reply.status(200).send(result.data);
      } catch (err) {
        fastify.log.error('Error in GET /dotphrases/:id:', err);
        return reply.status(500).send({ error: 'Failed to fetch dot phrase' });
      }
    }
  );

  console.log('dotPhrases plugin: registering GET /dotphrases (all)');
  fastify.get(
    '/dotphrases',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        console.log('dotPhrases: GET /dotphrases called');
        const supabase = getSupabaseClient(request.headers.authorization);

        const result = await getAllDotPhrasesForUser(request.user.id, supabase);

        if (!result.success) {
          return reply.status(500).send({ error: result.error });
        }

        return reply.status(200).send(result.data);
      } catch (err) {
        fastify.log.error('Error in GET /dotphrases:', err);
        return reply.status(500).send({ error: 'Failed to fetch dot phrases' });
      }
    }
  );

  /**
   * POST /dotphrases
   * Create a new dot phrase (requires authentication)
   */
  fastify.post(
    '/dotphrases',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const { trigger, expansion } = request.body;

        if (!trigger || !expansion) {
          return reply.status(400).send({ error: 'trigger and expansion are required' });
        }

        const supabase = getSupabaseClient(request.headers.authorization);

        const result = await createDotPhrase(request.user.id, trigger, expansion, supabase);

        if (!result.success) {
          return reply.status(400).send({ error: result.error });
        }

        return reply.status(201).send(result.data);
      } catch (err) {
        fastify.log.error('Error in POST /dotphrases:', err);
        return reply.status(500).send({ error: 'Failed to create dot phrase' });
      }
    }
  );

  /**
   * PATCH /dotphrases/:id
   * Update an existing dot phrase (requires authentication)
   */
  fastify.patch(
    '/dotphrases/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const supabase = getSupabaseClient(request.headers.authorization);

        const result = await updateDotPhrase(request.user.id, id, request.body, supabase);

        if (!result.success) {
          return reply.status(400).send({ error: result.error });
        }

        return reply.status(200).send(result.data);
      } catch (err) {
        fastify.log.error('Error in PATCH /dotphrases/:id:', err);
        return reply.status(500).send({ error: 'Failed to update dot phrase' });
      }
    }
  );

  /**
   * DELETE /dotphrases/:id
   * Delete a dot phrase (requires authentication)
   */
  fastify.delete(
    '/dotphrases/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const supabase = getSupabaseClient(request.headers.authorization);

        const result = await deleteDotPhrase(request.user.id, id, supabase);

        if (!result.success) {
          return reply.status(404).send({ error: result.error });
        }

        return reply.status(200).send({ success: true, data: result.data });
      } catch (err) {
        fastify.log.error('Error in DELETE /dotphrases/:id:', err);
        return reply.status(500).send({ error: 'Failed to delete dot phrase' });
      }
    }
  );
}, { name: 'dotPhrasesRoutes' });
