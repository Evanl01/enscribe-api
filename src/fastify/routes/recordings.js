/**
 * Recordings Routes
 * Handles all recording-related endpoints
 * Validation is handled in routes using Zod schemas
 */
import { getRecordingsAttachments, createRecording, getRecordings, deleteRecording } from '../controllers/recordingsController.js';
import { recordingsAttachmentsQuerySchema, recordingCreateRequestSchema } from '../schemas/requests.js';

export async function registerRecordingsRoutes(fastify) {
  /**
   * GET /api/recordings/attachments
   * Get recordings with attachment status (attached to patient encounter or not)
   */
  fastify.get('/recordings/attachments', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        // Validate query parameters
        const parseResult = recordingsAttachmentsQuerySchema.safeParse(request.query);
        if (!parseResult.success) {
          return reply.status(400).send({ error: parseResult.error });
        }

        // Set validated query params on request for controller
        request.query = parseResult.data;

        return getRecordingsAttachments(request, reply);
      } catch (error) {
        console.error('Error in recordings attachments route:', error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  });

  /**
   * POST /api/recordings
   * Create a recording entry and link to patient encounter
   */
  fastify.post('/recordings', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        // Validate request body
        const parseResult = recordingCreateRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          return reply.status(400).send({ error: parseResult.error });
        }

        // Set validated body on request for controller
        request.body = parseResult.data;

        return createRecording(request, reply);
      } catch (error) {
        console.error('Error in recordings create route:', error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  });

  /**
   * GET /api/recordings
   * Get all recordings for user (batch mode)
   */
  fastify.get('/recordings', {
    preHandler: [fastify.authenticate],
    handler: getRecordings,
  });

  /**
   * GET /api/recordings/:id
   * Get single recording by ID with signed URL generation
   */
  fastify.get('/recordings/:id', {
    preHandler: [fastify.authenticate],
    handler: getRecordings,
  });

  /**
   * DELETE /api/recordings/:id
   * Delete a recording and its associated file
   */
  fastify.delete('/recordings/:id', {
    preHandler: [fastify.authenticate],
    handler: deleteRecording,
  });
}
