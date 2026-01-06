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
 * POST request for creating a complete patient encounter bundle
 * Endpoint: POST /api/patient-encounters/complete
 * Requires patientEncounter, recording, transcript, and soapNote_text objects
 */
export const patientEncounterCompleteCreateRequestSchema = z.object({
  patientEncounter: z.object({
    name: z.string().min(1, 'Patient encounter name is required'),
  }),
  recording: z.object({
    recording_file_path: z.string().min(1, 'Recording file path is required'),
  }),
  transcript: z.object({
    transcript_text: z.string().min(1, 'Transcript text is required'),
  }),
  soapNote_text: z.object({
    soapNote: z.object({
      subjective: z.string().optional().default(''),
      objective: z.string().optional().default(''),
      assessment: z.string().optional().default(''),
      plan: z.string().optional().default(''),
    }).optional(),
    billingSuggestion: z.string().optional().default(''),
  }),
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

/**
 * POST request for creating a SOAP note
 * Endpoint: POST /api/soap-notes
 */
export const soapNoteCreateRequestSchema = z.object({
  patientEncounter_id: z.number().int('Patient Encounter ID must be an integer'),
  soapNote_text: z.object({
    soapNote: z.object({
      subjective: z.string().optional().default(''),
      objective: z.string().optional().default(''),
      assessment: z.string().optional().default(''),
      plan: z.string().optional().default(''),
    }).optional(),
    billingSuggestion: z.string().optional().default(''),
  }),
});

/**
 * PATCH request for updating a SOAP note
 * Endpoint: PATCH /api/soap-notes/:id
 * Note: ID is in URL path, not in request body
 */
export const soapNoteUpdateRequestSchema = z.object({
  soapNote_text: z.object({
    soapNote: z.object({
      subjective: z.string().optional().default(''),
      objective: z.string().optional().default(''),
      assessment: z.string().optional().default(''),
      plan: z.string().optional().default(''),
    }).optional(),
    billingSuggestion: z.string().optional().default(''),
  }),
});

