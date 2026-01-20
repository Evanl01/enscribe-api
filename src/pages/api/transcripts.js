import { getSupabaseClient } from '@/src/utils/supabase';
import { authenticateRequest } from '@/src/utils/authenticateRequest';
import { transcriptSchema } from '@/src/app/schemas';
import * as encryptionUtils from '@/src/utils/encryptionUtils';
import { record } from 'zod';

const transcriptTable = 'transcripts';

/**
 * Encrypts transcript_text for a transcript object by:
 * 1. Fetching the encrypted AES key via recording_id (using Supabase join).
 * 2. Encrypting transcript_text and updating the transcript object.
 * Returns { success, error, transcript }.
 * @param {object} transcript - Transcript object containing transcript_text and recording_id.
 */
async function encryptTranscriptText(supabase, transcript) {
    // 1. Get encrypted_aes_key by joining recording -> patientEncounter
    const { data, error } = await supabase
        .from('recordings')
        .select(`
            id,
            patientEncounter:patientEncounter_id (
                encrypted_aes_key
            )
        `)
        .eq('id', transcript.recording_id)
        .single();
    // console.log('Fetched recording and patientEncounter for encryption:', data, error);
    
    if (error || !data || !data.patientEncounter?.encrypted_aes_key) {
        return { success: false, error: 'Could not find recording or patient encounter for provided recording_id', transcript: null };
    }
    const encryptedAESKey = data.patientEncounter.encrypted_aes_key;

    // 2. Encrypt transcript_text
    const encryptionFieldResult = encryptionUtils.encryptField(transcript, 'transcript_text', encryptedAESKey);
    if (!encryptionFieldResult.success) {
        console.error('Failed to encrypt transcript_text:', encryptionFieldResult.error);
        return { success: false, error: 'Failed to encrypt transcript_text', transcript: null };
    }

    return { success: true, error: null, transcript };
}

// Helper function to decrypt transcript_text
async function decryptTranscriptText(transcript) {
    const encryptedAESKey = transcript.recording?.patientEncounter?.encrypted_aes_key || null;
    const decryptFieldResult = await encryptionUtils.decryptField(transcript, 'transcript_text', encryptedAESKey);

    if (!decryptFieldResult.success) {
        console.error('Failed to decrypt transcript:', transcript.id, '. Error:', decryptFieldResult.error);
        return { success: false, error: decryptFieldResult.error };
    }

    // Clean up joined fields
    delete transcript.recording;
    return { success: true, transcript };
}

export default async function handler(req, res) {
    const supabase = getSupabaseClient(req.headers.authorization);
    // Authenticate user for all methods
    const { user, error: authError } = await authenticateRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    // GET ---------------------------------------------------------
    if (req.method === 'GET') {
        const id = req.query.id;
        
        if (!id) {
            // Batch mode: Get all transcripts for this user
            const { data, error } = await supabase
                .from(transcriptTable)
                .select(`
                    *,
                    recording:recording_id (
                        id,
                        patientEncounter:patientEncounter_id (
                            encrypted_aes_key
                        )
                    )
                `)
                .eq('user_id', user.id)
                .order('updated_at', { ascending: false });

            if (error) return res.status(500).json({ error: error.message });

            // Decrypt transcript_text for each transcript
            for (let transcript of data) {
                const decryptionResult = await decryptTranscriptText(transcript);
                if (!decryptionResult.success) {
                    return res.status(400).json({ error: decryptionResult.error });
                }
            }

            return res.status(200).json(data);
        }
        
        // Single transcript mode: Get specific transcript by ID
        const { data, error } = await supabase
            .from(transcriptTable)
            .select(`
                *,
                recording:recording_id (
                    id,
                    patientEncounter:patientEncounter_id (
                        encrypted_aes_key
                    )
                )
            `)
            .eq('id', id)
            .eq('user_id', user.id)
            .single(); // Get a single record
        if (error) return res.status(500).json({ error: error.message });

        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'Transcript not found' });
        }

        const decryptionResult = await decryptTranscriptText(data);
        if (!decryptionResult.success) {
            return res.status(400).json({ error: decryptionResult.error });
        }

        return res.status(200).json(data);
    }




    // POST -------------------------------------------------------
    if (req.method === 'POST') {
        const parseResult = transcriptSchema.partial().safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: parseResult.error });
        }
        const transcript = parseResult.data;
        // console.log('Creating transcript:', transcript);
        transcript.user_id = user.id; // Ensure user_id is set to the authenticated user's ID
        transcript.transcript_text = req.body.transcript_text;
        if (!(req.body.transcript_text && transcript.recording_id)) {
            return res.status(400).json({ error: 'transcript_text and recording_id are required' });
        }

        // 1. Encrypt transcript_text
        const encryptionResult = await encryptTranscriptText(supabase, transcript);
        if (!encryptionResult.success) {
            return res.status(400).json({ error: encryptionResult.error });
        }
        
        console.log('Encrypted transcript:', transcript);
        console.log('encryptionResult:', encryptionResult);

        // 4. Insert encrypted transcript
        const { data: insertData, error: insertError } = await supabase
            .from(transcriptTable)
            .insert([transcript])
            .select()
            .single();
        if (insertError) return res.status(500).json({ error: insertError.message });
        return res.status(201).json(insertData);
    }





    // PATCH -----------------------------------------------------------------------------------------
    if (req.method === 'PATCH') {
        const parseResult = transcriptSchema.partial().safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: parseResult.error });
        }

        const transcript = parseResult.data;
        transcript.transcript_text = req.body.transcript_text; // Ensure transcript_text is set
        if (!(transcript.id && transcript.transcript_text)) {
            return res.status(400).json({ error: 'id and transcript_text are required for update' });
        }
        const { data, error } = await supabase
            .from(transcriptTable) // Only update based on transcript.id given, and if the user_id matches
            .select('recording_id')
            .eq('id', transcript.id)
            .single();
        if (error) return res.status(500).json({ error: error.message });
        
        console.log('Decrypting: Fetched transcript to get recording_id:', data, error);
        transcript.recording_id = data.recording_id;
        const encryptionResult = await encryptTranscriptText(supabase, transcript);
        if (!encryptionResult.success) {
            return res.status(400).json({ error: encryptionResult.error });
        }
        delete transcript.recording_id; // No need to update recording_id
        console.log('Encrypted transcript for update:', transcript);
        console.log('encryptionResult for update:', encryptionResult);

        const { data: updateData, error: updateError } = await supabase
            .from(transcriptTable)
            .update(transcript)
            .eq('id', transcript.id)
            .eq('user_id', user.id) // Ensure only the owner can update
            .select()
            .single();
        if (updateError) return res.status(500).json({ error: updateError.message });
        return res.status(200).json(updateData);
    }


    // DELETE ------------------------------------------------------------------------
    if (req.method === 'DELETE') {
        const id = req.query.id;
        if (!id) return res.status(400).json({ error: 'Transcript ID is required' });

        const { data, error } = await supabase
            .from(transcriptTable)
            .delete()
            .eq('id', id)
            .select()
            .single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true, data });
    }
    res.status(405).json({ error: 'Method not allowed' });
}