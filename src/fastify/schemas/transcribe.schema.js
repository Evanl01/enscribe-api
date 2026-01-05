/**
 * Transcription Endpoint Schemas
 * 
 * Zod schemas for request/response validation
 */

import { z } from 'zod';

/**
 * Cloud Run transcription response schema
 */
const CloudRunDataSchema = z.object({
  transcript: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  duration: z.number().optional(),
}).passthrough();

/**
 * Dot phrase object schema
 */
const DotPhraseSchema = z.object({
  id: z.string().optional(),
  trigger: z.string(),
  expansion: z.string(),
  userId: z.string().optional(),
});

/**
 * PHI masking result schema (from AWS)
 */
const MaskResultSchema = z.object({
  maskedText: z.string(),
  entities: z.array(z.object({
    Type: z.string(),
    Text: z.string(),
    BeginOffset: z.number(),
    EndOffset: z.number(),
    Score: z.number(),
    Id: z.union([z.number(), z.string()]),
  })),
  tokens: z.record(z.string(), z.any()),
}).passthrough();

/**
 * Request body for transcribe/complete endpoint
 */
const TranscribeRequestBodySchema = z.object({
  recording_file_signed_url: z.string()
    .url('recording_file_signed_url must be a valid URL')
    .describe('Signed URL to the recording file in Supabase'),
  enableDotPhraseExpansion: z.boolean()
    .optional()
    .default(true)
    .describe('Whether to enable dot phrase expansion (default: true)'),
});

/**
 * Response body for transcribe/complete endpoint - success case
 */
const TranscribeResponseBodySchema = z.object({
  ok: z.literal(true),
  cloudRunData: CloudRunDataSchema,
  maskResult: MaskResultSchema,
}).passthrough();

/**
 * Error response schema
 */
const ErrorResponseSchema = z.object({
  error: z.string(),
  cloudRunData: CloudRunDataSchema.optional(),
  details: z.any().optional(),
});

/**
 * JSON Schema format for Fastify validation
 */
const transcribeRequestSchema = {
  type: 'object',
  required: ['recording_file_signed_url'],
  properties: {
    recording_file_signed_url: {
      type: 'string',
      description: 'Signed URL to the recording file in Supabase',
    },
    enableDotPhraseExpansion: {
      type: 'boolean',
      default: true,
      description: 'Whether to enable dot phrase expansion',
    },
  },
};

const transcribeResponseSchema = {
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
      required: ['transcript'],
      additionalProperties: true,
      properties: {
        transcript: {
          type: 'string',
          description: 'Transcribed text from Cloud Run',
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Confidence score for transcription',
        },
        duration: {
          type: 'number',
          description: 'Duration of audio in seconds',
        },
      },
    },
    maskResult: {
      type: 'object',
      required: ['maskedText', 'entities', 'tokens'],
      additionalProperties: true,
      properties: {
        maskedText: {
          type: 'string',
          description: 'Transcript with PHI replaced by {{TYPE_ID}} tokens',
        },
        entities: {
          type: 'array',
          description: 'Array of detected PHI entities',
          items: {
            type: 'object',
            required: ['Type', 'Text', 'BeginOffset', 'EndOffset', 'Score', 'Id'],
            properties: {
              Type: {
                type: 'string',
                description: 'PHI type (NAME, DATE, ID, PHONE_OR_FAX, etc.)',
              },
              Text: {
                type: 'string',
                description: 'Original PHI text',
              },
              BeginOffset: {
                type: 'number',
                description: 'Start position in transcript',
              },
              EndOffset: {
                type: 'number',
                description: 'End position in transcript',
              },
              Score: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'Confidence score',
              },
              Id: {
                description: 'Entity ID',
              },
            },
          },
        },
        tokens: {
          type: 'object',
          description: 'Token mapping for unmasking (TYPE_ID -> original text)',
          additionalProperties: true,
        },
      },
    },
  },
};

export {
  CloudRunDataSchema,
  DotPhraseSchema,
  MaskResultSchema,
  TranscribeRequestBodySchema,
  TranscribeResponseBodySchema,
  ErrorResponseSchema,
  transcribeRequestSchema,
  transcribeResponseSchema,
};
