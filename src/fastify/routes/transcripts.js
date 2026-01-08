/**
 * Transcripts Routes
 * Defines all transcript API endpoints
 * Validation is handled in routes using Zod schemas
 */
import {
  getAllTranscripts,
  getTranscript,
  createTranscript,
  // updateTranscript, // DISABLED: Transcripts are immutable (see controller for details)
  deleteTranscript,
} from '../controllers/transcriptsController.js';
import { transcriptCreateRequestSchema } from '../schemas/requests.js';

export async function registerTranscriptsRoutes(fastify) {
  // GET all transcripts
  fastify.get('/transcripts', {
    preHandler: [fastify.authenticate],
    handler: getAllTranscripts,
  });

  // GET single transcript by ID
  fastify.get('/transcripts/:id', {
    preHandler: [fastify.authenticate],
    handler: getTranscript,
  });

  // POST create transcript
  fastify.post('/transcripts', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        // Validate request body
        const parseResult = transcriptCreateRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          return reply.status(400).send({ error: parseResult.error });
        }

        // Set validated body on request for controller
        request.body = parseResult.data;

        return createTranscript(request, reply);
      } catch (error) {
        console.error('Error in transcripts create route:', error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  });

  // PATCH update transcript - DISABLED
  // Transcripts are immutable after creation due to database trigger constraint.
  // To fix a transcript, delete and recreate it.
  /*
  fastify.patch('/transcripts/:id', {
    preHandler: [fastify.authenticate],
    handler: updateTranscript,
  });
  */

  // DELETE transcript
  fastify.delete('/transcripts/:id', {
    preHandler: [fastify.authenticate],
    handler: deleteTranscript,
  });
}
