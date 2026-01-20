import { getSupabaseClient } from '@/src/utils/supabase';
import { authenticateRequest } from '@/src/utils/authenticateRequest';
import { patientEncounterWithTranscriptUpdateRequestSchema } from '@/src/app/schemas/requests';
import { getPatientEncounterWithDecryptedKey } from '@/src/utils/patientEncounterUtils';
import * as encryptionUtils from '@/src/utils/encryptionUtils';

const patientEncounterTable = 'patientEncounters';
const recordingTable = 'recordings';
const transcriptTable = 'transcripts';

/**
 * Compound update endpoint for patient encounter with transcript
 * Updates both the patient encounter (e.g., name) and transcript in a single request
 * This maintains ACID properties and provides a clear API contract
 * 
 * PATCH /api/patient-encounters/{id}/update-with-transcript
 * Body:
 * {
 *   "name": "Updated Name",           // optional
 *   "transcript_text": "Updated..."   // optional (but at least one required)
 * }
 */
export default async function handler(req, res) {
    const supabase = getSupabaseClient(req.headers.authorization);
    const { user, error: authError } = await authenticateRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    const { id: patientEncounterId } = req.query;

    if (!patientEncounterId || isNaN(patientEncounterId)) {
        return res.status(400).json({ error: 'Valid Patient Encounter ID is required' });
    }

    // PATCH /api/patient-encounters/{id}/update-with-transcript
    if (req.method === 'PATCH') {
        try {
            console.log('Received PATCH /patient-encounters/:id/update-with-transcript request with body:', req.body);
            
            // Validate the request shape
            const parseResult = patientEncounterWithTranscriptUpdateRequestSchema.safeParse(req.body);
            if (!parseResult.success) {
                return res.status(400).json({ error: parseResult.error });
            }
            console.log('Parsed compound update request:', parseResult.data);
            
            const { name, transcript_text } = parseResult.data;
            
            // Step 1: Fetch patient encounter with decrypted AES key
            const encounterResult = await getPatientEncounterWithDecryptedKey(supabase, patientEncounterId);
            if (!encounterResult.success) {
                return res.status(encounterResult.statusCode).json({ error: encounterResult.error });
            }
            
            const { data: patientEncounter, aes_key, iv } = encounterResult;
            
            // Store original values for rollback if needed
            const originalName = patientEncounter.encrypted_name;
            
            // Step 2: Fetch recording linked to this patient encounter (needed to find transcript)
            let recordingId = null;
            if (transcript_text !== undefined) {
                const { data: recording, error: recordingError } = await supabase
                    .from(recordingTable)
                    .select('id')
                    .eq('patientEncounter_id', patientEncounterId)
                    .single();
                
                if (recordingError) {
                    return res.status(400).json({ error: 'No recording found for this patient encounter' });
                }
                recordingId = recording.id;
            }
            
            // Step 3: Prepare patient encounter update
            const patientEncounterUpdate = {};
            
            if (name !== undefined) {
                // Prepare encounter object for encryption (generates new IV)
                const encounterObj = { name: name };
                
                // Encrypt name (generates new IV and mutates object)
                const encryptionResult = await encryptionUtils.encryptField(encounterObj, 'name', patientEncounter.encrypted_aes_key);
                if (!encryptionResult.success) {
                    return res.status(500).json({ error: 'Failed to encrypt patient encounter name: ' + encryptionResult.error });
                }
                
                patientEncounterUpdate.encrypted_name = encounterObj.encrypted_name;
                patientEncounterUpdate.iv = encounterObj.iv;
                patientEncounterUpdate.updated_at = new Date().toISOString();
            }
            
            // Step 4: Prepare transcript update/create
            let transcriptUpdate = null;
            let hasTranscriptChanges = false;
            
            if (transcript_text !== undefined) {
                hasTranscriptChanges = true;
                
                // Prepare transcript object for encryption (generates new IV)
                const transcript = {
                    transcript_text: transcript_text,
                };
                
                // Encrypt transcript_text (generates new IV and mutates object)
                const encryptionResult = await encryptionUtils.encryptField(transcript, 'transcript_text', patientEncounter.encrypted_aes_key);
                if (!encryptionResult.success) {
                    return res.status(500).json({ error: 'Failed to encrypt transcript: ' + encryptionResult.error });
                }
                
                // Check if transcript exists for this recording
                const { data: existingTranscript, error: fetchTranscriptError } = await supabase
                    .from(transcriptTable)
                    .select('id')
                    .eq('recording_id', recordingId)
                    .single();
                
                // PGRST116 = no rows found (which is ok)
                if (fetchTranscriptError && fetchTranscriptError.code !== 'PGRST116') {
                    return res.status(500).json({ error: 'Failed to query transcript: ' + fetchTranscriptError.message });
                }
                
                transcriptUpdate = {
                    exists: !!existingTranscript,
                    id: existingTranscript?.id,
                    data: {
                        encrypted_transcript_text: transcript.encrypted_transcript_text,
                        iv: transcript.iv,
                        updated_at: new Date().toISOString(),
                    }
                };
                
                if (!transcriptUpdate.exists) {
                    // Will be created, not updated
                    transcriptUpdate.data.recording_id = recordingId;
                    transcriptUpdate.data.user_id = user.id;
                }
            }
            
            // Step 5: Execute updates in transaction-like manner with rollback on failure
            try {
                // Update patient encounter if there are changes
                if (Object.keys(patientEncounterUpdate).length > 0) {
                    const { error: updateEncounterError } = await supabase
                        .from(patientEncounterTable)
                        .update(patientEncounterUpdate)
                        .eq('id', patientEncounterId);
                    
                    if (updateEncounterError) {
                        throw new Error('Failed to update patient encounter: ' + updateEncounterError.message);
                    }
                }
                
                // Handle transcript update/create
                if (hasTranscriptChanges) {
                    try {
                        if (transcriptUpdate.exists) {
                            const { error: updateTranscriptError } = await supabase
                                .from(transcriptTable)
                                .update(transcriptUpdate.data)
                                .eq('id', transcriptUpdate.id);
                            
                            if (updateTranscriptError) {
                                throw new Error('Failed to update transcript: ' + updateTranscriptError.message);
                            }
                        } else {
                            const { error: createTranscriptError } = await supabase
                                .from(transcriptTable)
                                .insert(transcriptUpdate.data);
                            
                            if (createTranscriptError) {
                                throw new Error('Failed to create transcript: ' + createTranscriptError.message);
                            }
                        }
                    } catch (transcriptError) {
                        // ROLLBACK: Revert patient encounter update if it succeeded but transcript failed
                        console.error('Transcript operation failed, rolling back patient encounter update:', transcriptError);
                        if (Object.keys(patientEncounterUpdate).length > 0) {
                            const rollbackData = {};
                            // Restore original encrypted_name if it was updated
                            if (patientEncounterUpdate.encrypted_name !== undefined) {
                                rollbackData.encrypted_name = originalName;
                            }
                            await supabase
                                .from(patientEncounterTable)
                                .update(rollbackData)
                                .eq('id', patientEncounterId);
                        }
                        throw transcriptError;
                    }
                }
                
                // Step 6: Fetch and return updated data
                const { data: updatedEncounter, error: fetchUpdatedError } = await supabase
                    .from(patientEncounterTable)
                    .select('*')
                    .eq('id', patientEncounterId)
                    .single();
                
                if (fetchUpdatedError) {
                    throw new Error('Failed to fetch updated encounter: ' + fetchUpdatedError.message);
                }
                
                let updatedTranscript = null;
                if (hasTranscriptChanges) {
                    const { data: transcript, error: fetchTranscriptError } = await supabase
                        .from(transcriptTable)
                        .select('*')
                        .eq('recording_id', recordingId)
                        .single();
                    
                    if (fetchTranscriptError && fetchTranscriptError.code !== 'PGRST116') {
                        throw new Error('Failed to fetch updated transcript: ' + fetchTranscriptError.message);
                    }
                    updatedTranscript = transcript;
                }
                
                console.log('Compound update successful');
                return res.status(200).json({ 
                    success: true, 
                    data: {
                        patientEncounter: updatedEncounter,
                        ...(updatedTranscript && { transcript: updatedTranscript })
                    }
                });
            }
            catch (transactionError) {
                console.error('Transaction error during compound update:', transactionError);
                return res.status(500).json({ error: transactionError.message });
            }
        }
        catch (err) {
            console.error('PATCH /patient-encounters/:id/update-with-transcript error:', err);
            return res.status(500).json({ error: err.message });
        }
    }

    else {
        return res.status(405).json({ error: 'Method not allowed' });
    }
}
