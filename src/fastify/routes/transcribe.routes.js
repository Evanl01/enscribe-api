/**
 * GCP Transcription Routes
 * 
 * Defines Fastify routes for transcription pipeline operations
 */

import { handler, expandHandler } from '../controllers/transcribeController.js';
import {
  transcribeRequestSchema,
  transcribeResponseSchema,
} from '../schemas/transcribe.schema.js';

/**
 * Register transcription routes
 * 
 * @param {Object} fastify - Fastify instance
 */
export async function registerTranscribeRoutes(fastify) {
  // POST /gcp/transcribe/complete (prefix /api applied in server.js)
  fastify.post('/gcp/transcribe/complete', {
    onRequest: [fastify.authenticate],
    schema: {
      description: 'Complete transcription pipeline: transcribe audio, expand dot phrases, mask PHI',
      tags: ['GCP', 'Transcription'],
      body: transcribeRequestSchema,
      response: {
        200: {
          description: 'Successful transcription, expansion, and masking',
          type: 'object',
          required: ['ok', 'cloudRunData', 'maskResult'],
          additionalProperties: true,
          properties: {
            ok: {
              type: 'boolean',
              enum: [true],
            },
            cloudRunData: {
              type: 'object',
              additionalProperties: true,
            },
            maskResult: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
        400: {
          description: 'Bad request (invalid URL, missing parameters, etc.)',
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string' },
            cloudRunData: { type: 'object' },
            details: { type: 'object' },
          },
        },
        401: {
          description: 'Unauthorized (authentication failed)',
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
        408: {
          description: 'Request timeout (Cloud Run took too long)',
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
        500: {
          description: 'Internal server error',
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string' },
            cloudRunData: { type: 'object' },
            details: { type: 'object' },
          },
        },
      },
    },
    handler,
  });

  // POST /gcp/expand (prefix /api applied in server.js)
  // Unit test endpoint for dot phrase expansion without transcription
  fastify.post('/gcp/expand', {
    onRequest: [fastify.authenticate],
    schema: {
      description: 'Test dot phrase expansion with provided transcript and dot phrases (no transcription)',
      tags: ['GCP', 'Expansion'],
      body: {
        type: 'object',
        required: ['transcript'],
        properties: {
          transcript: {
            type: 'string',
            description: 'The transcript text to expand dot phrases in',
          },
          dotPhrases: {
            type: 'array',
            description: 'Array of dot phrase objects with trigger and expansion properties',
            items: {
              type: 'object',
              properties: {
                trigger: { type: 'string' },
                expansion: { type: 'string' },
              },
            },
          },
          enableDotPhraseExpansion: {
            type: 'boolean',
            default: true,
            description: 'Whether to perform dot phrase expansion',
          },
        },
      },
      response: {
        200: {
          description: 'Successful expansion',
          type: 'object',
          required: ['ok', 'expanded', 'llm_notated'],
          properties: {
            ok: {
              type: 'boolean',
              enum: [true],
            },
            expanded: {
              type: 'string',
              description: 'Transcript with clean expansions',
            },
            llm_notated: {
              type: 'string',
              description: 'Transcript with expansions marked for LLM processing',
            },
            dotPhrasesApplied: {
              type: 'integer',
              description: 'Number of dot phrases available',
            },
          },
        },
        400: {
          description: 'Bad request (missing or invalid parameters)',
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
        401: {
          description: 'Unauthorized (authentication failed)',
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
      },
    },
    handler: expandHandler,
  });
}

export default registerTranscribeRoutes;
