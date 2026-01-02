/**
 * Transcripts Routes
 * Defines all transcript API endpoints
 */
import {
  getAllTranscripts,
  getTranscript,
  createTranscript,
  // updateTranscript, // DISABLED: Transcripts are immutable (see controller for details)
  deleteTranscript,
} from '../controllers/transcriptsController.js';

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
    handler: createTranscript,
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
