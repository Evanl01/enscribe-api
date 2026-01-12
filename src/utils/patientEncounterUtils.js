import * as encryptionUtils from './encryptionUtils.js';

const patientEncounterTable = 'patientEncounters';

/**
 * Fetches a patient encounter and decrypts its AES key
 * Used across multiple endpoints to reduce code duplication
 * 
 * @param {object} supabase - Supabase client
 * @param {number} patientEncounterId - ID of the patient encounter
 * @returns {object} { success, data (encounter), aes_key, iv, error }
 */
export async function getPatientEncounterWithDecryptedKey(supabase, patientEncounterId) {
    try {
        const { data: patientEncounter, error } = await supabase
            .from(patientEncounterTable)
            .select('*')
            .eq('id', patientEncounterId)
            .single();
        
        if (error) {
            console.error('Patient encounter query error:', error);
            return { 
                success: false, 
                error: 'Patient encounter not found',
                statusCode: 404
            };
        }
        
        if (!patientEncounter.encrypted_aes_key || !patientEncounter.iv) {
            console.error('Missing encryption keys for patient encounter:', patientEncounterId);
            return { 
                success: false, 
                error: 'Missing encryption keys for patient encounter',
                statusCode: 400
            };
        }
        
        const aes_key = encryptionUtils.decryptAESKey(patientEncounter.encrypted_aes_key);
        const iv = patientEncounter.iv;
        
        return { 
            success: true, 
            data: patientEncounter,
            aes_key,
            iv
        };
    } catch (err) {
        console.error('Error fetching patient encounter with decrypted key:', err);
        return { 
            success: false, 
            error: err.message,
            statusCode: 500
        };
    }
}

/**
 * Fetches a patient encounter and a related transcript with decryption
 * Useful when you need both encounter and transcript data
 * 
 * @param {object} supabase - Supabase client
 * @param {number} patientEncounterId - ID of the patient encounter
 * @returns {object} { success, encounter, transcript, aes_key, iv, error, statusCode }
 */
export async function getPatientEncounterWithTranscript(supabase, patientEncounterId) {
    try {
        // Step 1: Get encounter with decrypted key
        const encounterResult = await getPatientEncounterWithDecryptedKey(supabase, patientEncounterId);
        if (!encounterResult.success) {
            return encounterResult;
        }
        
        const { data: patientEncounter, aes_key, iv } = encounterResult;
        console.log('[src/utils/patientEncounterUtils.js] Fetched patient encounter:', patientEncounter);
        
        // Step 2: Fetch recording linked to this patient encounter
        const { data: recording, error: recordingError } = await supabase
            .from('recordings')
            .select('id')
            .eq('patientEncounter_id', patientEncounterId)
            .single();
        
        if (recordingError) {
            if (recordingError.code === 'PGRST116') {
                return { 
                    success: false, 
                    error: 'Patient encounter has no associated recording',
                    statusCode: 400
                };
            }
            return { 
                success: false, 
                error: 'Failed to fetch recording: ' + recordingError.message,
                statusCode: 500
            };
        }
        
        // Step 3: Fetch transcript
        const { data: transcript, error: transcriptError } = await supabase
            .from('transcripts')
            .select('*')
            .eq('recording_id', recording.id)
            .single();
        
        if (transcriptError && transcriptError.code !== 'PGRST116') {
            // PGRST116 = no rows found
            console.error('Transcript query error:', transcriptError);
            return { 
                success: false, 
                error: 'Failed to query transcript: ' + transcriptError.message,
                statusCode: 500
            };
        }
        
        return { 
            success: true, 
            encounter: patientEncounter,
            transcript: transcript || null,
            aes_key,
            iv
        };
    } catch (err) {
        console.error('Error fetching patient encounter with transcript:', err);
        return { 
            success: false, 
            error: err.message,
            statusCode: 500
        };
    }
}
