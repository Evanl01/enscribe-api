/**
 * SOAP Notes Routes
 * Registers all SOAP note endpoints with authentication
 * Validation is handled in routes using Zod schemas
 */
import {
  getAllSoapNotes,
  getSoapNote,
  createSoapNote,
  updateSoapNote,
  deleteSoapNote,
} from '../controllers/soapNotesController.js';
import { soapNoteCreateRequestSchema, soapNoteUpdateRequestSchema } from '../schemas/requests.js';

export async function registerSoapNotesRoutes(fastify) {
  // GET /api/soap-notes - Get all SOAP notes with pagination
  fastify.get('/soap-notes', {
    preHandler: [fastify.authenticate],
    handler: getAllSoapNotes,
  });

  // GET /api/soap-notes/:id - Get single SOAP note by ID
  fastify.get('/soap-notes/:id', {
    preHandler: [fastify.authenticate],
    handler: getSoapNote,
  });

  // POST /api/soap-notes - Create new SOAP note
  fastify.post('/soap-notes', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        // Validate request body
        const parseResult = soapNoteCreateRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          return reply.status(400).send({ error: parseResult.error });
        }

        // Set validated body on request for controller
        request.body = parseResult.data;

        return createSoapNote(request, reply);
      } catch (error) {
        console.error('Error in SOAP notes create route:', error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  });

  // PATCH /api/soap-notes/:id - Update SOAP note
  fastify.patch('/soap-notes/:id', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        // Validate request body
        const parseResult = soapNoteUpdateRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          return reply.status(400).send({ error: parseResult.error });
        }

        // Set validated body on request for controller
        request.body = parseResult.data;

        return updateSoapNote(request, reply);
      } catch (error) {
        console.error('Error in SOAP notes update route:', error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  });

  // DELETE /api/soap-notes/:id - Delete SOAP note
  fastify.delete('/soap-notes/:id', {
    preHandler: [fastify.authenticate],
    handler: deleteSoapNote,
  });
}

export default registerSoapNotesRoutes;
