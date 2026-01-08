/**
 * OpenAI SOAP Note Generation Routes
 * 
 * Defines Fastify routes for SOAP note and billing generation
 */

import { promptLlmHandler } from '../controllers/promptLlmController.js';
import { promptLlmRequestSchema } from '../schemas/requests.js';
/**
 * Register prompt LLM routes
 * 
 * @param {Object} fastify - Fastify instance
 */
export async function registerPromptLlmRoutes(fastify) {
  // POST /api/prompt-llm (prefix /api applied in server.js)
  fastify.post('/prompt-llm', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    try {
      // Validate request body using Zod schema
      const parseResult = promptLlmRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: parseResult.error });
      }

      // Set validated request body on request
      request.body = parseResult.data;

      // Import and call handler
      const { promptLlmHandler } = await import('../controllers/promptLlmController.js');
      return promptLlmHandler(request, reply);
    } catch (error) {
      console.error('Error in prompt-llm route:', error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
