/**
 * Patient Encounters Routes
 * Registers all patient encounter endpoints with Fastify
 */
import {
  getAllPatientEncounters,
  getPatientEncounter,
  createPatientEncounter,
  updatePatientEncounter,
  deletePatientEncounter,
  batchPatientEncounters,
  completePatientEncounter,
} from '../controllers/patientEncountersController.js';

/**
 * Register patient encounters routes
 * @param {FastifyInstance} fastify - Fastify instance
 */
export async function registerPatientEncountersRoutes(fastify) {
  // GET /patient-encounters (prefix /api added by server.js)
  // Get all patient encounters for authenticated user
  fastify.get('/patient-encounters', {
    preHandler: [fastify.authenticate],
    handler: getAllPatientEncounters,
  });

  // POST /patient-encounters
  // Create a new patient encounter
  fastify.post('/patient-encounters', {
    preHandler: [fastify.authenticate],
    handler: createPatientEncounter,
  });

  // GET /patient-encounters/:id
  // Get a specific patient encounter
  fastify.get('/patient-encounters/:id', {
    preHandler: [fastify.authenticate],
    handler: getPatientEncounter,
  });

  // PATCH /patient-encounters/:id
  // Update a patient encounter
  fastify.patch('/patient-encounters/:id', {
    preHandler: [fastify.authenticate],
    handler: updatePatientEncounter,
  });

  // DELETE /patient-encounters/:id
  // Delete a patient encounter
  fastify.delete('/patient-encounters/:id', {
    preHandler: [fastify.authenticate],
    handler: deletePatientEncounter,
  });

  // POST /patient-encounters/batch
  // Batch operations on patient encounters
  fastify.post('/patient-encounters/batch', {
    preHandler: [fastify.authenticate],
    handler: batchPatientEncounters,
  });

  // POST /patient-encounters/complete
  // Create a complete patient encounter bundle with recording, transcript, and SOAP notes
  fastify.post('/patient-encounters/complete', {
    preHandler: [fastify.authenticate],
    handler: completePatientEncounter,
  });
}

export default registerPatientEncountersRoutes;
