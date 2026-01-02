import { z } from 'zod';
import { uuidRegex, isoDatetimeRegex } from './regex.js';

export const transcriptSchema = z.object({
  id: z.number().int().optional(),
  created_at: z.string().regex(isoDatetimeRegex, 'Invalid ISO datetime').optional(),
  updated_at: z.string().regex(isoDatetimeRegex, 'Invalid ISO datetime').default(() => new Date().toISOString()).optional(),
  user_id: z.string().regex(uuidRegex, 'Invalid UUID').optional(),
  recording_id: z.number().int().optional(),
  encrypted_transcript_text: z.string().nullable(),
  iv: z.string().nullable().optional(),
});
