import { getSupabaseClient } from '@/src/utils/supabase';
import { authenticateRequest } from '@/src/utils/authenticateRequest';
import * as encryptionUtils from '@/src/utils/encryptionUtils';

const patientEncounterTable = 'patientEncounters';

export default async function handler(req, res) {
    // Authenticate user for all methods
    const supabase = getSupabaseClient(req.headers.authorization);
    const { user, error: authError } = await authenticateRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    // GET: ------------------------------------------------------------------------------
    // GET: List all audio files for this user
    if (req.method === 'GET') {
        // console.log('Fetched patientEncounters for user:', user.id, "with JWT:", req.headers.authorization);
        const { data, error } = await supabase //Only fetch SOAP notes for the authenticated user
            .from(patientEncounterTable)
            .select('*')// Select all fields
            .eq('user_id', user.id)
            .order('updated_at', { ascending: false });
        // console.log('Fetched patientEncounters:', data);
        if (error) return res.status(500).json({ error: error.message });

        for (let patientEncounter of data) {
            if (!patientEncounter.encrypted_aes_key || !patientEncounter.iv) {
                console.error('Missing encrypted AES key or IV for patient encounter:', patientEncounter.id, ". Failed to decrypt data");
                console.error('Patient Encounter Data:', patientEncounter);
                continue;
                // return res.status(400).json({ error: 'Missing encrypted AES key or IV' });
            }
            const aes_key = encryptionUtils.decryptAESKey(patientEncounter.encrypted_aes_key);
            if (patientEncounter.encrypted_name) {
                patientEncounter.name = encryptionUtils.decryptText(patientEncounter.encrypted_name, aes_key, patientEncounter.iv);
                delete patientEncounter.encrypted_name;
            }
        }
        return res.status(200).json(data);
    }

    res.status(405).json({ error: 'Method not allowed' });
}