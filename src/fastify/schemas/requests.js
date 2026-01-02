import { z } from 'zod';
import { isoDatetimeRegex, uuidRegex } from '../../app/schemas/regex.js';

// Request schemas - what the API client sends
// These are separate from database schemas to decouple API contracts from DB schema

export const patientEncounterCreateRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  recording_file_path: z.string().min(1, 'Recording file path is required').optional(),
  recording_file_signed_url: z.string().nullable().optional(),
  recording_file_signed_url_expiry: z.string().regex(isoDatetimeRegex, 'Invalid ISO datetime').nullable().optional(),
});

/**
 * PATCH request for patient encounter - only updates the encounter itself (e.g., name)
 * Use PATCH /api/patient-encounters/{id}/update-with-transcript for compound updates
 */
export const patientEncounterUpdateRequestSchema = z.object({
  id: z.number().int('ID must be an integer'),
  name: z.string().min(1, 'Name is required').optional(),
});

/**
 * Schema for the transformed data before database operations
 * This is what gets validated before saving to DB
 */
export const patientEncounterForDatabaseSchema = z.object({
  id: z.number().int().optional(),
  encrypted_name: z.string().nullable().optional(),
  recording_file_path: z.string().nullable().optional(),
  recording_file_signed_url: z.string().nullable().optional(),
  recording_file_signed_url_expiry: z.string().regex(isoDatetimeRegex, 'Invalid ISO datetime').nullable().optional(),
  encrypted_aes_key: z.string().nullable().optional(),
  iv: z.string().nullable().optional(),
  user_id: z.string().regex(uuidRegex, 'Invalid UUID').nullable().optional(),
});

/**
 * Query parameters for GET /api/recordings/attachments
 */
export const recordingsAttachmentsQuerySchema = z.object({
  attached: z.enum(['true', 'false'], 'attached parameter must be "true" or "false"'),
  limit: z.coerce.number().int().positive().default(100).optional(),
  offset: z.coerce.number().int().nonnegative().default(0).optional(),
  sortBy: z.enum(['name', 'created_at', 'updated_at'], 'sortBy must be one of: name, created_at, updated_at').default('name').optional(),
  order: z.enum(['asc', 'desc'], 'order must be one of: asc, desc').default('asc').optional(),
});

/**
 * POST request for creating a transcript
 * Endpoint: POST /api/transcripts
 */
export const transcriptCreateRequestSchema = z.object({
  transcript_text: z.string().min(1, 'Transcript text is required'),
  recording_id: z.number().int('Recording ID must be an integer'),
});

/**
 * PATCH request for updating a transcript
 * Endpoint: PATCH /api/transcripts/:id
 */
export const transcriptUpdateRequestSchema = z.object({
  transcript_text: z.string().min(1, 'Transcript text is required'),
});

