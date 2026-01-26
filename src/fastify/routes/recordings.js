/**
 * Recordings Routes
 * Handles all recording-related endpoints
 * Validation is handled in routes using Zod schemas
 */
import { getRecordingsAttachments, createRecording, getRecordings, deleteRecording, uploadRecordingUrl, createSignedUrl, deleteRecordingsStorage } from '../controllers/recordingsController.js';
import { recordingsAttachmentsQuerySchema, recordingCreateRequestSchema, recordingUploadRequestSchema, recordingCreateSignedUrlRequestSchema, deleteRecordingsStorageRequestSchema } from '../schemas/requests.js';
import { getSupabaseClient } from '../../utils/supabase.js';

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
   * POST /api/recordings/create-signed-upload-url
   * Generate signed URL for direct file upload to Supabase
   * Frontend sends filename with extension, backend validates and checks collisions
   */
  fastify.post('/recordings/create-signed-upload-url', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        // Validate request body
        const parseResult = recordingUploadRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          return reply.status(400).send({ error: parseResult.error });
        }

        // Set validated body on request for controller
        request.body = parseResult.data;

        return uploadRecordingUrl(request, reply);
      } catch (error) {
        console.error('Error in recordings upload route:', error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  });

  /**
   * POST /api/recordings/create-signed-url
   * Generate signed URL for downloading a recording file from storage
   * Body: { path: "userid/filename.mp4" }
   */
  fastify.post('/recordings/create-signed-url', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        // Validate request body
        const parseResult = recordingCreateSignedUrlRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          request.log.warn('[POST /create-signed-url] Zod validation failed', {
            errors: parseResult.error.errors?.map(e => ({
              field: e.path?.join('.') || 'unknown',
              message: e.message,
              code: e.code,
            })),
            receivedBody: request.body,
            userId: request.user?.id,
          });
          return reply.status(400).send({ error: parseResult.error });
        }

        // Set validated body on request for controller
        request.body = parseResult.data;

        return createSignedUrl(request, reply);
      } catch (error) {
        console.error('Error in recordings create-signed-url route:', error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  });

  /**
   * DELETE /api/recordings/complete/:id
   * Delete a recording and its associated file (complete removal from DB + storage)
   */
  fastify.delete('/recordings/complete/:id', {
    preHandler: [fastify.authenticate],
    handler: deleteRecording,
  });

  /**
   * DELETE /api/recordings/storage
   * Bulk delete storage files only (no DB records deleted)
   * Body: { prefixes: string[] } (format: userid/filename)
   */
  fastify.delete('/recordings/storage', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        // Validate request body
        const parseResult = deleteRecordingsStorageRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          return reply.status(400).send({ error: parseResult.error });
        }

        // Set validated body on request for controller
        request.body = parseResult.data;

        return deleteRecordingsStorage(request, reply);
      } catch (error) {
        console.error('Error in recordings delete-storage route:', error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  });
}
