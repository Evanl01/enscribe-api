/**
 * SOAP Notes Routes
 * Registers all SOAP note endpoints with authentication
 * Validation is handled in controllers using Zod schemas
 */
import {
  getAllSoapNotes,
  getSoapNote,
  createSoapNote,
  updateSoapNote,
  deleteSoapNote,
} from '../controllers/soapNotesController.js';

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
  // Validation handled in controller using Zod
  fastify.post('/soap-notes', {
    preHandler: [fastify.authenticate],
    handler: createSoapNote,
  });

  // PATCH /api/soap-notes/:id - Update SOAP note
  // Validation handled in controller using Zod
  fastify.patch('/soap-notes/:id', {
    preHandler: [fastify.authenticate],
    handler: updateSoapNote,
  });

  // DELETE /api/soap-notes/:id - Delete SOAP note
  fastify.delete('/soap-notes/:id', {
    preHandler: [fastify.authenticate],
    handler: deleteSoapNote,
  });
}

export default registerSoapNotesRoutes;
