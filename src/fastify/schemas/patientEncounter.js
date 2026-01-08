import { z } from 'zod';
import { uuidRegex, isoDatetimeRegex } from './regex.js';

export const patientEncounterSchema = z.object({
  id: z.number().int().optional(),
  created_at: z.string().regex(isoDatetimeRegex, 'Invalid ISO datetime').optional(),
  updated_at: z.string().regex(isoDatetimeRegex, 'Invalid ISO datetime').nullable().optional(),
  user_id: z.string().regex(uuidRegex, 'Invalid UUID').nullable().optional(),
  encrypted_name: z.string().nullable().optional(),
  encrypted_aes_key: z.string().nullable().optional(),
  iv: z.string().nullable().optional(),
});
