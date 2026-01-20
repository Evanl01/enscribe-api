import { getSupabaseClient } from '@/src/utils/supabase';
import { authenticateRequest } from '@/src/utils/authenticateRequest';
import { patientEncounterSchema } from '@/src/app/schemas/patientEncounter';
import { getPatientEncounterWithDecryptedKey } from '@/src/utils/patientEncounterUtils';
import * as encryptionUtils from '@/src/utils/encryptionUtils';

const patientEncounterTable = 'patientEncounters';

export default async function handler(req, res) {
    const supabase = getSupabaseClient(req.headers.authorization);
    const { user, error: authError } = await authenticateRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    if (req.method == 'GET') {
        try {
            const id = req.query.id;
            if (!id) return res.status(400).json({ error: 'id is required' });

            const result = await getPatientEncounterWithDecryptedKey(supabase, id);
            if (!result.success) {
                return res.status(result.statusCode).json({ error: result.error });
            }

            const { data: patientEncounterData, aes_key } = result;
            
            if (patientEncounterData.encrypted_name) {
                patientEncounterData.name = encryptionUtils.decryptText(patientEncounterData.encrypted_name, aes_key, patientEncounterData.iv);
                delete patientEncounterData.encrypted_name;
            }

            return res.status(200).json({ success: true, patientEncounterData });
        }
        catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }
    else if (req.method === 'POST') {
        const parseResult = patientEncounterSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: parseResult.error });
        }
        const patientEncounter = parseResult.data;
        if (!patientEncounter.name || !patientEncounter.recording_file_path) {
            return res.status(400).json({ error: 'name and recording_file_path are required' });
        }
        patientEncounter.user_id = user.id; // Ensure user_id is set to the authenticated user's ID

        const { data, error } = await supabase
            .from(patientEncounterTable)
            .insert([patientEncounter])
            .select()
            .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true, data });
    }


    // PATCH ------------------------------------------------------------------------
    if (req.method === 'PATCH') {
        console.log('Received PATCH request with body:', req.body);
        const parseResult = patientEncounterSchema.partial().safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: parseResult.error });
        }
        console.log('Parsed patient encounter for update:', parseResult.data); 
        const patientEncounter = parseResult.data;
        if (!patientEncounter.id) {
            return res.status(400).json({ error: 'id is required' });
        }


        const { data, error } = await supabase
            .from(patientEncounterTable)
            .update(patientEncounter)
            .eq('id', patientEncounter.id)
            .select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
    }


    // DELETE ------------------------------------------------------------------------
    if (req.method === 'DELETE') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'id is required' });
        // Validate ownership before deleting
        const { data, error } = await supabase
            .from(patientEncounterTable)
            .delete()
            .eq('id', id)
            .select()
            .single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true, data });
    }


    else {
        return res.status(405).json({ error: 'Method not allowed' });
    }
}