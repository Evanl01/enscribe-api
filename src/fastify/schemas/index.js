/**
 * Fastify-compatible schema exports
 * All schemas use relative imports instead of @/src alias
 */

export { dotPhraseSchema } from './dotPhrase.js';
export { patientEncounterSchema } from './patientEncounter.js';
export { recordingSchema } from './recording.js';
export { soapNoteSchema } from './soapNote.js';
export { transcriptSchema } from './transcript.js';
export { uuidRegex, isoDatetimeRegex } from './regex.js';
