import { getSupabaseClient } from '@/src/utils/supabase';
import { authenticateRequest } from '@/src/utils/authenticateRequest';
import { recordingSchema, transcriptSchema, soapNoteSchema, patientEncounterSchema } from '@/src/app/schemas';
import formidable from 'formidable';
import fs from 'fs';
import th from 'zod/v4/locales/th.cjs';
import { json, record } from 'zod';
import * as encryptionUtils from '@/src/utils/encryptionUtils';
import * as format from '@/public/scripts/format';
import parseSoapNotes from '@/src/utils/parseSoapNotes';

const patientEncounterTable = 'patientEncounters';
const soapNoteTable = 'soapNotes';
const recordingTable = 'recordings';
const transcriptTable = 'transcripts';

async function decryptJsonResponse(jsonResponse, encryptedAESKey) {
    const encryptionConfig = {
        patientEncounter: ['name'],
        transcript: ['transcript_text'],
        soapNote: ['soapNote_text'],
    };
    // Check if the jsonResponse has the expected structure
    if (!jsonResponse || typeof jsonResponse !== 'object') {
        throw new Error('Invalid JSON response structure');
    }

    if (!(jsonResponse.patientEncounter && jsonResponse.transcript && Array.isArray(jsonResponse.soapNotes))) {
        throw new Error('Missing required fields in JSON response: patientEncounter, transcript, and soapNotes (Array)');
    }

    for (const key of Object.keys(encryptionConfig)) {
        const target = jsonResponse[key];
        let result = null;
        if (Array.isArray(target)) {
            // For arrays (e.g., soapNotes)
            for (const item of target) {
                for (const field of encryptionConfig[key]) {
                    result = await encryptionUtils.decryptField(
                        item,
                        field,
                        encryptedAESKey,
                    );
                }
            }
        } else if (target) {
            // For single objects
            for (const field of encryptionConfig[key]) {
                result = await encryptionUtils.decryptField(
                    target,
                    field,
                    encryptedAESKey,
                );
            }
        }

        if (!result.success) {
            throw new Error(`Decryption failed for field ${field} in ${key}: ${result.error}`);
        }
    }
}


export default async function handler(req, res) {
    const supabase = getSupabaseClient(req.headers.authorization);
    const { user, error: authError } = await authenticateRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    if (req.method == 'GET') {
        try {

            const patientEncounter_id = parseInt(req.query.id);
            // console.log('Parsed patientEncounter_id:', patientEncounter_id, 'Type:', typeof patientEncounter_id);

            if (!patientEncounter_id || isNaN(patientEncounter_id)) {
                console.error('Invalid patientEncounter ID:', req.query.id);
                return res.status(400).json({ error: 'Valid Patient Encounter ID is required' });
            }

            // Step 0: Fetching patient encounter
            console.log('Step 0: Fetching patient encounter with id:', patientEncounter_id, 'user_id:', user.id);
            const { data: patientEncounterData, error: patientEncounterError } = await supabase
                .from(patientEncounterTable)
                .select('*')
                .eq('id', patientEncounter_id)
                .single();

            if (patientEncounterError) {
                console.error('Patient Encounter query error:', patientEncounterError);
                return res.status(500).json({ error: 'Database error: ' + patientEncounterError.message });
            }
            const aes_key = encryptionUtils.decryptAESKey(patientEncounterData.encrypted_aes_key);
            const decryptPatientEncounterResult = await encryptionUtils.decryptField(patientEncounterData, 'name', patientEncounterData.encrypted_aes_key);
            if (!decryptPatientEncounterResult.success) {
                return res.status(400).json({ error: decryptPatientEncounterResult.error });
            }


            // patientEncounter.name = await encryptionUtils.decryptAES(patientEncounterData.name, encrypted_aes_key, iv);

            console.log('Step 1: Fetching recording linked to patientEncounter_id:', patientEncounter_id);
            const { data: recordingData, error: recordingError } = await supabase
                .from(recordingTable)
                .select('*')
                .eq('patientEncounter_id', patientEncounter_id)
                .single();

            if (recordingError) {
                console.error('Recording query error:', recordingError);
                return res.status(500).json({ error: 'Database error: ' + recordingError.message });
            }
            delete recordingData.iv;


            // Step 2: Fetch transcript
            console.log('Step 2: Fetching transcript for recording_id:', recordingData.id);
            const { data: transcriptData, error: transcriptError } = await supabase
                .from(transcriptTable)
                .select('*')
                .eq('recording_id', recordingData.id)
                .single();
            if (transcriptError) {
                console.error('Transcript query error:', transcriptError);
                return res.status(500).json({ error: 'Database error: ' + transcriptError.message });
            }
            let decryptedTranscriptResult = await encryptionUtils.decryptField(transcriptData, 'transcript_text', aes_key);
            if (!decryptedTranscriptResult.success) {
                return res.status(400).json({ error: decryptedTranscriptResult.error });
            }

            // Use first transcript

            // Step 3: Fetch SOAP notes
            console.log('Step 3: Fetching SOAP notes for patientEncounter_id:', patientEncounter_id);
            const { data: soapNotes, error: soapError } = await supabase
                .from('soapNotes')
                .select('*')
                .eq('patientEncounter_id', patientEncounter_id);
            if (soapError) {
                console.error('SOAP notes query error:', soapError);
                return res.status(500).json({ error: 'Database error: ' + soapError.message });
            }

            // Decrypt SOAP notes
            for (let i = 0; i < soapNotes.length; i++) {
                let soapNote = soapNotes[i];
                if (!soapNote.iv) {
                    console.error('Missing IV for SOAP note:', soapNote.id, ". Failed to decrypt data");
                    return res.status(400).json({ error: 'Missing IV for SOAP note' });
                }
                let decryptSoapNoteResult = await encryptionUtils.decryptField(soapNote, 'soapNote_text', aes_key);
                if (!decryptSoapNoteResult.success) {
                    console.error('Failed to decrypt SOAP note:', soapNote.id, ". Error:", decryptSoapNoteResult.error);
                    return res.status(400).json({ error: decryptSoapNoteResult.error });
                }
                try {
                    // Remove bad control characters except for \n, \r, \t

                    soapNote.soapNote_text = parseSoapNotes(soapNote.soapNote_text);
                    // console.log('Parsed SOAP note:', soapNote.id, "Data:", soapNote);
                    // soapNote.soapNote_text = JSON.parse(cleaned);
                } catch (e) {
                    console.error('Decryption succeeded but JSON parse of SOAP Note failed:', e);
                    return res.status(400).json({ error: 'Failed to parse soapNote_text' });
                }
            }
            //Step 4: Decrypt all encrypted fields

            // Step 4: Generate signed URL for audio file
            const needNewSignedUrl = !patientEncounterData.recording_file_signed_url || new Date(patientEncounterData.recording_file_signed_url_expiry) < new Date();
            console.log('Step 4: Generating signed URL for audio file');
            if (recordingData.recording_file_path && needNewSignedUrl) {
                // Normalize path: strip optional bucket prefix and any leading slash
                let normalizedPath = recordingData.recording_file_path;
                if (normalizedPath.startsWith('audio-files/')) {
                    normalizedPath = normalizedPath.replace(/^audio-files\//, '');
                }
                if (normalizedPath.startsWith('/')) normalizedPath = normalizedPath.slice(1);
                console.log('Creating signed URL for recording file:', normalizedPath);
                // Update signed URL and expiry in patientEncounter in supabase
                const expirySeconds = 60 * 60;

                const { data: signedUrlData, error: signedError } = await supabase.storage
                    .from('audio-files')
                    .createSignedUrl(normalizedPath, expirySeconds);
                if (signedError) {
                    console.error('Signed URL error:', signedError);
                    return res.status(500).json({ error: 'Failed to create signed URL: ' + signedError.message });
                }

                const now = new Date();
                const expiresAt = new Date(now.getTime() + expirySeconds * 1000).toISOString();

                recordingData.recording_file_signed_url = signedUrlData.signedUrl;
                recordingData.recording_file_signed_url_expiry = expiresAt;
                // Update signed URL and expiry in patientEncounter in supabase
                const { data: updateData, error: updateError } = await supabase
                    .from(recordingTable)
                    .update({
                        recording_file_signed_url: recordingData.recording_file_signed_url,
                        recording_file_signed_url_expiry: recordingData.recording_file_signed_url_expiry
                    })
                    .eq('id', recordingData.id)
                    .select()
                    .single();
                if (updateError) {
                    console.error('Error updating Recording\'s file signed URL:', updateError.message);
                    return res.status(500).json({ error: updateError.message });
                }

            }

            // Step 5: Prepare final response
            const patient_encounter = {
                patientEncounter: patientEncounterData,
                recording: recordingData,
                transcript: transcriptData,
                soapNotes: soapNotes,
            };

            console.log('=== Final Response ===');
            console.log('Patient encounter prepared:', patient_encounter);

            return res.status(200).json(patient_encounter);

        } catch (err) {
            console.error('=== CATCH BLOCK ===');
            console.error('Caught error:', err);
            console.error('Error message:', err.message);
            console.error('Error stack:', err.stack);
            return res.status(500).json({ error: 'Internal server error: ' + err.message });
        }
    }
    /*
    *
    *
    *
    *
    *
    *
    *
    *
    *
    *
    *
    */


    // POST /api/patient-encounters/complete----------------------------------------------------------------------------------------------
    else if (req.method == 'POST') {
        if (!(req.body.patientEncounter && req.body.recording && req.body.transcript && req.body.soapNote_text)) {
            console.error('Missing required fields in request body: patientEncounter, recording, transcript, soapNote_text');
            return res.status(400).json({ error: 'Missing required fields in request body: patientEncounter, recording, transcript, soapNote_text' });
        }
        // 1. Validate input
        const patientEncounterParseResult = patientEncounterSchema.safeParse(req.body.patientEncounter);
        if (!patientEncounterParseResult.success) {
            console.error('Patient Encounter validation error:', patientEncounterParseResult.error);
            return res.status(400).json({ error: patientEncounterParseResult.error });
        }
        const patientEncounter = patientEncounterParseResult.data;
        patientEncounter.user_id = user.id;

        // 2. Generate AES key and IV for patientEncounter
        const { aesKey, iv: encounterIV } = encryptionUtils.generateAESKeyAndIV();
        patientEncounter.iv = encounterIV;
        patientEncounter.encrypted_aes_key = encryptionUtils.encryptAESKey(aesKey);

        // 3. Encrypt patientEncounter fields and preprocess
        // console.log('Patient Encounter to encrypt:', patientEncounter, "And name:", req.body.patientEncounter.name);
        if (req.body.patientEncounter.name) {
            patientEncounter.encrypted_name = encryptionUtils.encryptText(req.body.patientEncounter.name, aesKey, encounterIV);
        }

        let transcriptData = null, transcriptError = null;
        let recordingData = null, recordingError = null;
        let soapNoteData = null, soapNoteError = null;
        let patientEncounterData = null, patientEncounterError = null;

        try {
            console.log('Saving Patient Encounter: ', patientEncounter);
            // 4. Save patientEncounter
            ({ data: patientEncounterData, error: patientEncounterError } = await supabase
                .from(patientEncounterTable)
                .insert([patientEncounter])
                .select()
                .single());
            if (patientEncounterError) throw new Error('Failed to create Patient Encounter: ' + patientEncounterError.message);


            // 5. Encrypt and save recording
            const recordingIV = encryptionUtils.generateRandomIVBase64();
            const recordingObj = {
                ...req.body.recording,
                iv: recordingIV,
                patientEncounter_id: patientEncounterData.id,
                user_id: user.id,
            };
            delete recordingObj.recording_text; // If you have a plaintext field
            console.log('Recording object to insert:', recordingObj);
            ({ data: recordingData, error: recordingError } = await supabase
                .from(recordingTable)
                .insert([recordingObj])
                .select()
                .single());
            if (recordingError) throw new Error('Failed to create Recording: ' + recordingError.message);


            // 6. Encrypt and save transcript
            const transcriptIV = encryptionUtils.generateRandomIVBase64();
            const transcriptObj = {
                ...req.body.transcript,
                iv: transcriptIV,
                encrypted_transcript_text: req.body.transcript.transcript_text
                    ? encryptionUtils.encryptText(req.body.transcript.transcript_text, aesKey, transcriptIV)
                    : null,
                recording_id: recordingData.id,
                user_id: user.id,
            };
            delete transcriptObj.transcript_text;

            ({ data: transcriptData, error: transcriptError } = await supabase
                .from(transcriptTable)
                .insert([transcriptObj])
                .select()
                .single());
            if (transcriptError) throw new Error('Failed to create Transcript: ' + transcriptError.message);

            // 7. Encrypt and save SOAP Note
            const soapNoteIV = encryptionUtils.generateRandomIVBase64();
            let soapNote_textObject = req.body.soapNote_text;
            if (typeof soapNote_textObject === "string") {
                try {
                    soapNote_textObject = JSON.parse(soapNote_textObject);
                } catch (e) {
                    throw new Error('Invalid JSON format for soapNote_text');
                }
            }
            // console.log('SOAP Note text object to encrypt:', soapNote_textObject);
            const soapNoteObject = {
                iv: soapNoteIV,
                encrypted_soapNote_text: soapNote_textObject
                    ? encryptionUtils.encryptText(JSON.stringify(soapNote_textObject), aesKey, soapNoteIV)
                    : null,
                patientEncounter_id: patientEncounterData.id,
                user_id: user.id,
            };
            delete soapNoteObject.soapNote_text;

            ({ data: soapNoteData, error: soapNoteError } = await supabase
                .from(soapNoteTable)
                .insert([soapNoteObject])
                .select()
                .single());
            if (soapNoteError) throw new Error('Failed to create SOAP Note: ' + soapNoteError.message);

            return res.status(200).json({
                patientEncounter: patientEncounterData,
                transcript: transcriptData,
                recording: recordingData,
                soapNote: soapNoteData
            });

        } catch (err) {
            // ACID rollback: delete patientEncounter (cascade deletes linked records), then check other tables
            if (patientEncounterData && patientEncounterData.id) {
                await supabase.from(patientEncounterTable).delete().eq('id', patientEncounterData.id);
            }
            // Double-check: delete transcript, recording, soapNote if cascade fails
            if (transcriptData && transcriptData.id) {
                await supabase.from(transcriptTable).delete().eq('id', transcriptData.id);
            }
            if (recordingData && recordingData.id) {
                await supabase.from(recordingTable).delete().eq('id', recordingData.id);
            }
            if (soapNoteData && soapNoteData.id) {
                await supabase.from(soapNoteTable).delete().eq('id', soapNoteData.id);
            }
            console.error('API error:', err);
            if (err.stack) {
                console.error('Stack trace:', err.stack);
            }
            if (err.message.includes('unique')) {
                err.message = 'Patient Encounter with this name already exists. Please use a different name.';
            }
            return res.status(500).json({ error: err.message });
        }
    }

    // if (req.method === 'PATCH') {
    //     const parseResult = patientEncounterSchema.partial().safeParse(req.body);
    //     if (!parseResult.success) {
    //         return res.status(400).json({ error: parseResult.error });
    //     }
    //     const patientEncounter = parseResult.data;
    //     if (!patientEncounter.id) {
    //         return res.status(400).json({ error: 'id is required' });
    //     }


    //     const { data, error } = await supabase
    //         .from(patientEncounterTable)
    //         .update(patientEncounter)
    //         .eq('id', patientEncounter.id)
    //         .select();
    //     if (error) return res.status(500).json({ error: error.message });
    //     return res.status(200).json(data);
    // }

    return res.status(405).json({ error: 'Method not allowed' });
}