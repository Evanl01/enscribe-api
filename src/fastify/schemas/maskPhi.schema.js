/**
 * Zod schemas for AWS PHI masking endpoints
 */

import { z } from 'zod';

/**
 * PHI Entity schema - represents a single masked entity
 */
const PhiEntitySchema = z.object({
  Type: z.string().describe('PHI type (NAME, AGE, DATE, ADDRESS, etc.)'),
  Text: z.string().describe('Original PHI text before masking'),
  BeginOffset: z.number().int().describe('Start position in original text'),
  EndOffset: z.number().int().describe('End position in original text'),
  Score: z.number().min(0).max(1).describe('Confidence score (0-1)'),
  Id: z.union([z.number().int(), z.string()]).describe('Unique entity ID'),
});

/**
 * Request body for mask-phi endpoint
 */
const MaskPhiRequestBodySchema = z.object({
  text: z.string()
    .min(1, 'Text is required')
    .describe('Medical transcript to mask'),
  maskThreshold: z.number()
    .min(0)
    .max(1)
    .optional()
    .default(0.15)
    .describe('Confidence threshold for masking (0-1, default 0.15)'),
});

/**
 * Response body for mask-phi endpoint
 */
const MaskPhiResponseBodySchema = z.object({
  maskedText: z.string()
    .describe('Transcript with PHI replaced by {{TYPE_ID}} tokens'),
  entities: z.array(PhiEntitySchema)
    .describe('Array of detected and masked PHI entities'),
  tokens: z.record(z.any())
    .describe('Token mapping for unmasking'),
});

/**
 * Request body for unmask-phi endpoint
 */
const UnmaskPhiRequestBodySchema = z.object({
  text: z.string()
    .min(1, 'Text is required')
    .describe('Transcript with {{TYPE_ID}} tokens'),
  tokens: z.record(z.any())
    .optional()
    .default({})
    .describe('Token mapping for unmasking'),
});

/**
 * Response body for unmask-phi endpoint
 */
const UnmaskPhiResponseBodySchema = z.object({
  unmaskedText: z.string()
    .describe('Transcript with PHI tokens replaced with original text'),
});

/**
 * JSON Schema format for Fastify validation
 */
const maskPhiRequestSchema = {
  type: 'object',
  required: ['text'],
  properties: {
    text: {
      type: 'string',
      minLength: 1,
      description: 'Medical transcript to mask',
    },
    maskThreshold: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      default: 0.15,
      description: 'Confidence threshold for masking (0-1, default 0.15)',
    },
  },
};

const maskPhiResponseSchema = {
  type: 'object',
  required: ['maskedText', 'entities', 'tokens'],
  properties: {
    maskedText: {
      type: 'string',
      description: 'Transcript with PHI replaced by tokens',
    },
    entities: {
      type: 'array',
      description: 'Array of detected PHI entities',
    },
    tokens: {
      type: 'object',
      description: 'Token mapping for unmasking',
      additionalProperties: true,
    },
  },
};

const unmaskPhiRequestSchema = {
  type: 'object',
  required: ['text'],
  properties: {
    text: {
      type: 'string',
      description: 'Transcript with {{TYPE_ID}} tokens',
    },
    tokens: {
      type: 'object',
      description: 'Token mapping for unmasking',
      additionalProperties: true,
    },
  },
};

const unmaskPhiResponseSchema = {
  type: 'object',
  properties: {
    unmaskedText: {
      type: 'string',
      description: 'Transcript with PHI tokens replaced with original text',
    },
  },
};

export {
  MaskPhiRequestBodySchema,
  MaskPhiResponseBodySchema,
  UnmaskPhiRequestBodySchema,
  UnmaskPhiResponseBodySchema,
  maskPhiRequestSchema,
  maskPhiResponseSchema,
  unmaskPhiRequestSchema,
  unmaskPhiResponseSchema,
};
