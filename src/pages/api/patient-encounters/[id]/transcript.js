import { getSupabaseClient } from '@/src/utils/supabase';
import { authenticateRequest } from '@/src/utils/authenticateRequest';
import { transcriptUpdateRequestSchema } from '@/src/app/schemas/requests';
import { getPatientEncounterWithDecryptedKey } from '@/src/utils/patientEncounterUtils';
import * as encryptionUtils from '@/src/utils/encryptionUtils';

const patientEncounterTable = 'patientEncounters';
const recordingTable = 'recordings';
const transcriptTable = 'transcripts';

export default async function handler(req, res) {
    const supabase = getSupabaseClient(req.headers.authorization);
    const { user, error: authError } = await authenticateRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    const { id: patientEncounterId } = req.query;

    if (!patientEncounterId || isNaN(patientEncounterId)) {
        return res.status(400).json({ error: 'Valid Patient Encounter ID is required' });
    }

    // PATCH /api/patient-encounters/{id}/transcript
    if (req.method === 'PATCH') {
        try {
            console.log('Received PATCH /patient-encounters/:id/transcript request with body:', req.body);
            
            // Validate the request shape
            const parseResult = transcriptUpdateRequestSchema.safeParse(req.body);
            if (!parseResult.success) {
                return res.status(400).json({ error: parseResult.error });
            }
            console.log('Parsed transcript update request:', parseResult.data);
            
            const { transcript_text } = parseResult.data;
            
            // Step 1: Fetch patient encounter with decrypted AES key
            const encounterResult = await getPatientEncounterWithDecryptedKey(supabase, patientEncounterId);
            if (!encounterResult.success) {
                return res.status(encounterResult.statusCode).json({ error: encounterResult.error });
            }
            
            const { data: patientEncounter } = encounterResult;
            
            if (!patientEncounter.recording_id) {
                return res.status(400).json({ error: 'Patient encounter has no associated recording' });
            }
            
            // Step 2: Fetch recording to get the encrypted AES key
            const { data: recording, error: recordingError } = await supabase
                .from(recordingTable)
                .select('id')
                .eq('patientEncounter_id', patientEncounterId)
                .single();
            
            if (recordingError) {
                return res.status(500).json({ error: 'Failed to fetch recording: ' + recordingError.message });
            }
            
            // Step 3: Prepare transcript object for encryption with new IV
            const transcript = {
                transcript_text: transcript_text,
            };
            
            // Encrypt transcript_text (generates new IV)
            const encryptionResult = await encryptionUtils.encryptField(transcript, 'transcript_text', patientEncounter.encrypted_aes_key);
            if (!encryptionResult.success) {
                return res.status(500).json({ error: 'Failed to encrypt transcript: ' + encryptionResult.error });
            }
            
            // Step 4: Check if transcript exists for this recording
            const { data: existingTranscript, error: fetchTranscriptError } = await supabase
                .from(transcriptTable)
                .select('id')
                .eq('recording_id', patientEncounter.recording_id)
                .single();
            
            if (fetchTranscriptError) {
                if (fetchTranscriptError.code === 'PGRST116') {
                    // PGRST116 means no rows found
                    return res.status(404).json({ error: 'No transcript to update. Create a transcript first.' });
                }
                return res.status(500).json({ error: 'Failed to query transcript: ' + fetchTranscriptError.message });
            }
            
            // Step 5: Update existing transcript with new encrypted text and IV
            console.log('Updating existing transcript with id:', existingTranscript.id);
            const { data: updateResult, error: updateError } = await supabase
                .from(transcriptTable)
                .update({
                    encrypted_transcript_text: transcript.encrypted_transcript_text,
                    iv: transcript.iv,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', existingTranscript.id)
                .select()
                .single();
            
            if (updateError) {
                return res.status(500).json({ error: 'Failed to update transcript: ' + updateError.message });
            }
            
            console.log('Transcript update successful:', updateResult);
            return res.status(200).json({ success: true, data: updateResult });
        }
        catch (err) {
            console.error('PATCH /patient-encounters/:id/transcript error:', err);
            return res.status(500).json({ error: err.message });
        }
    }

    // GET /api/patient-encounters/{id}/transcript
    else if (req.method === 'GET') {
        try {
            console.log('Received GET /patient-encounters/:id/transcript request');
            
            // Step 1: Fetch patient encounter with decrypted AES key
            const encounterResult = await getPatientEncounterWithDecryptedKey(supabase, patientEncounterId);
            if (!encounterResult.success) {
                return res.status(encounterResult.statusCode).json({ error: encounterResult.error });
            }
            
            const { data: patientEncounter, aes_key } = encounterResult;
            
            if (!patientEncounter.recording_id) {
                return res.status(400).json({ error: 'Patient encounter has no associated recording' });
            }
            
            // Step 2: Fetch transcript for this recording
            const { data: transcript, error: fetchTranscriptError } = await supabase
                .from(transcriptTable)
                .select('*')
                .eq('recording_id', patientEncounter.recording_id)
                .single();
            
            if (fetchTranscriptError) {
                if (fetchTranscriptError.code === 'PGRST116') {
                    return res.status(404).json({ error: 'Transcript not found' });
                }
                return res.status(500).json({ error: fetchTranscriptError.message });
            }
            
            // Step 3: Decrypt transcript_text
            const decryptResult = await encryptionUtils.decryptField(transcript, 'transcript_text', aes_key);
            
            if (!decryptResult.success) {
                return res.status(500).json({ error: decryptResult.error });
            }
            
            return res.status(200).json({ success: true, data: transcript });
        }
        catch (err) {
            console.error('GET /patient-encounters/:id/transcript error:', err);
            return res.status(500).json({ error: err.message });
        }
    }

    else {
        return res.status(405).json({ error: 'Method not allowed' });
    }
}
