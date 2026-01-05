/**
 * AWS PHI Masking Routes
 * 
 * Defines Fastify routes for PHI masking operations.
 */

import { maskPhiHandler, unmaskPhiHandler } from '../controllers/maskPhiController.js';
import {
  maskPhiRequestSchema,
  maskPhiResponseSchema,
  unmaskPhiRequestSchema,
  unmaskPhiResponseSchema,
} from '../schemas/maskPhi.schema.js';

/**
 * Register PHI masking routes
 * 
 * @param {Object} fastify - Fastify instance
 */
export async function registerMaskPhiRoutes(fastify) {
  // POST /aws/mask-phi
  fastify.post('/aws/mask-phi', {
    schema: {
      description: 'Mask PHI in medical transcripts using AWS Comprehend Medical',
      tags: ['AWS', 'PHI'],
      body: maskPhiRequestSchema,
      response: {
        200: maskPhiResponseSchema,
        400: {
          description: 'Invalid request body',
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string' },
          },
        },
        401: {
          description: 'Unauthorized',
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
        500: {
          description: 'Internal server error',
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
      },
    },
    handler: maskPhiHandler,
  });

  // POST /aws/unmask-phi
  fastify.post('/aws/unmask-phi', {
    schema: {
      description: 'Unmask PHI tokens using entity data',
      tags: ['AWS', 'PHI'],
      body: unmaskPhiRequestSchema,
      response: {
        200: unmaskPhiResponseSchema,
        400: {
          description: 'Invalid request body',
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string' },
          },
        },
        401: {
          description: 'Unauthorized',
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
        500: {
          description: 'Internal server error',
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
      },
    },
    handler: unmaskPhiHandler,
  });
}
