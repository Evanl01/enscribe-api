/**
 * Patient Encounters Controller
 * Handles all patient encounter CRUD operations, batch operations, and completion
 * Validation is handled in routes using Zod schemas
 */
import { getSupabaseClient } from '../../utils/supabase.js';
import * as encryptionUtils from '../../utils/encryptionUtils.js';
import { getPatientEncounterWithDecryptedKey } from '../../utils/patientEncounterUtils.js';

const patientEncounterTable = 'patientEncounters';
const recordingTable = 'recordings';
const transcriptTable = 'transcripts';

/**
 * Helper: Validates bigint ID format
 */
function isValidBigInt(id) {
  if (!id) return false;
  try {
    const parsed = BigInt(id);
    return parsed > 0n;
  } catch (error) {
    return false;
  }
}

/**
 * Get all patient encounters for the authenticated user
 * GET /api/patient-encounters
 */
export async function getAllPatientEncounters(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Get query parameters for pagination/filtering
    const limit = parseInt(request.query.limit) || 50;
    const offset = parseInt(request.query.offset) || 0;

    const { data, error } = await supabase
      .from(patientEncounterTable)
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return reply.status(500).send({ error: error.message });
    }

    // Decrypt sensitive fields and remove encryption keys
    for (let encounter of data) {
      if (!encounter.encrypted_aes_key || !encounter.iv) {
        console.error(`Missing encryption keys for encounter ${encounter.id}`);
        continue;
      }

      const aes_key = encryptionUtils.decryptAESKey(encounter.encrypted_aes_key);
      if (encounter.encrypted_name) {
        encounter.name = encryptionUtils.decryptText(
          encounter.encrypted_name,
          aes_key,
          encounter.iv
        );
        delete encounter.encrypted_name;
      }
      
      // Remove encryption fields from response (not relevant to frontend)
      delete encounter.encrypted_aes_key;
      delete encounter.iv;
    }

    return reply.status(200).send(data);
  } catch (error) {
    console.error('Error fetching patient encounters:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Get a specific patient encounter by ID
 * GET /api/patient-encounters/:id
 */
export async function getPatientEncounter(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params;

    // Validate bigint ID format
    if (!isValidBigInt(id)) {
      return reply.status(400).send({ error: 'Invalid ID format - must be a numeric ID' });
    }

    const { data: encounter, error } = await supabase
      .from(patientEncounterTable)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return reply.status(404).send({ error: 'Encounter not found' });
      }
      return reply.status(500).send({ error: error.message });
    }

    // Decrypt sensitive fields and remove encryption keys
    if (encounter.encrypted_aes_key && encounter.iv && encounter.encrypted_name) {
      const aes_key = encryptionUtils.decryptAESKey(encounter.encrypted_aes_key);
      encounter.name = encryptionUtils.decryptText(
        encounter.encrypted_name,
        aes_key,
        encounter.iv
      );
      delete encounter.encrypted_name;
    }
    
    // Remove encryption fields from response (not relevant to frontend)
    delete encounter.encrypted_aes_key;
    delete encounter.iv;

    return reply.status(200).send(encounter);
  } catch (error) {
    console.error('Error fetching patient encounter:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Create a new patient encounter
 * POST /api/patient-encounters
 */
export async function createPatientEncounter(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Request body is already validated by route
    const encounter = request.body;

    // Set user_id to authenticated user
    encounter.user_id = user.id;

    // Generate AES key and IV for patient encounter
    const { aesKey, iv } = encryptionUtils.generateAESKeyAndIV();
    encounter.iv = iv;
    encounter.encrypted_aes_key = encryptionUtils.encryptAESKey(aesKey);

    // Encrypt patient name
    if (encounter.name) {
      encounter.encrypted_name = encryptionUtils.encryptText(encounter.name, aesKey, iv);
      delete encounter.name; // Remove plain field before insert
    }

    const { data, error } = await supabase
      .from(patientEncounterTable)
      .insert([encounter])
      .select()
      .single();

    if (error) {
      return reply.status(500).send({ error: error.message });
    }

    // Decrypt name for response and clean up encryption fields
    if (data.encrypted_name) {
      data.name = encryptionUtils.decryptText(data.encrypted_name, aesKey, data.iv);
      delete data.encrypted_name;
    }
    delete data.encrypted_aes_key;
    delete data.iv;

    return reply.status(201).send(data);
  } catch (error) {
    console.error('Error creating patient encounter:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Update a patient encounter
 * PATCH /api/patient-encounters/:id
 * 
 * Frontend schema: { name?, reason?, appointmentDate?, duration?, ... }
 * Database schema: { encrypted_name?, encrypted_aes_key?, iv?, reason?, ... }
 * 
 * If name is provided, it will be encrypted using AES-256 with existing encryption key
 */
export async function updatePatientEncounter(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params;

    // Validate bigint ID format
    if (!isValidBigInt(id)) {
      return reply.status(400).send({ error: 'Invalid ID format - must be a numeric ID' });
    }

    // Request body is already validated by route
    const updates = request.body;

    // Step 1: Fetch existing encounter to verify it exists and get encryption key
    const { data: encounter, error: fetchError } = await supabase
      .from(patientEncounterTable)
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return reply.status(404).send({ error: 'Encounter not found' });
      }
      return reply.status(500).send({ error: fetchError.message });
    }

    // Step 2: Prepare update object
    const dbUpdates = {};

    // If name is being updated, encrypt it using the existing encryption key and IV
    if (updates.name !== undefined) {
      // Decrypt the existing AES key from the database
      const aes_key = encryptionUtils.decryptAESKey(encounter.encrypted_aes_key);
      
      // Encrypt the new name using the existing key and IV
      const encrypted_name = encryptionUtils.encryptText(updates.name, aes_key, encounter.iv);
      
      dbUpdates.encrypted_name = encrypted_name;
      // Keep the same IV and encrypted_aes_key (no need to update them)
    }

    // Copy other fields as-is (they're not encrypted)
    for (const key of Object.keys(updates)) {
      if (key !== 'name') {
        dbUpdates[key] = updates[key];
      }
    }

    // Set updated_at timestamp
    dbUpdates.updated_at = new Date().toISOString();

    // Step 3: Update in database
    const { data: updatedData, error: updateError } = await supabase
      .from(patientEncounterTable)
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      if (updateError.code === 'PGRST116') {
        return reply.status(404).send({ error: 'Encounter not found' });
      }
      return reply.status(500).send({ error: updateError.message });
    }

    // Step 4: Decrypt response for client
    if (updatedData.encrypted_aes_key && updatedData.iv && updatedData.encrypted_name) {
      const aes_key = encryptionUtils.decryptAESKey(updatedData.encrypted_aes_key);
      updatedData.name = encryptionUtils.decryptText(
        updatedData.encrypted_name,
        aes_key,
        updatedData.iv
      );
      delete updatedData.encrypted_name;
    }

    return reply.status(200).send(updatedData);
  } catch (error) {
    console.error('Error updating patient encounter:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Delete a patient encounter
 * DELETE /api/patient-encounters/:id
 */
export async function deletePatientEncounter(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params;

    // Validate bigint ID format
    if (!isValidBigInt(id)) {
      return reply.status(400).send({ error: 'Invalid ID format - must be a numeric ID' });
    }

    const { data, error } = await supabase
      .from(patientEncounterTable)
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return reply.status(404).send({ error: 'Encounter not found' });
      }
      return reply.status(500).send({ error: error.message });
    }

    return reply.status(200).send({ success: true, data });
  } catch (error) {
    console.error('Error deleting patient encounter:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Get a complete patient encounter bundle
 * GET /api/patient-encounters/complete/:id
 * 
 * Retrieves a patient encounter with all linked data:
 * - Patient encounter details
 * - Associated recording
 * - Transcript for that recording
 * - All SOAP notes for the encounter
 * 
 * All encrypted fields are decrypted before returning
 */
export async function getCompletePatientEncounter(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params;

    // Validate ID format
    if (!isValidBigInt(id)) {
      return reply.status(400).send({ error: 'Invalid ID format - must be a numeric ID' });
    }

    const encounterId = parseInt(id);

    // Step 0: Fetch patient encounter
    const { data: encounterData, error: encounterError } = await supabase
      .from(patientEncounterTable)
      .select('*')
      .eq('id', encounterId)
      .eq('user_id', user.id)
      .single();

    if (encounterError) {
      if (encounterError.code === 'PGRST116') {
        return reply.status(404).send({ error: 'Encounter not found' });
      }
      return reply.status(500).send({ error: encounterError.message });
    }

    // Decrypt AES key for this encounter
    const aes_key = encryptionUtils.decryptAESKey(encounterData.encrypted_aes_key);

    // Decrypt encounter name
    if (encounterData.encrypted_name) {
      encounterData.name = encryptionUtils.decryptText(
        encounterData.encrypted_name,
        aes_key,
        encounterData.iv
      );
      delete encounterData.encrypted_name;
    }
    delete encounterData.encrypted_aes_key;
    delete encounterData.iv;

    // Step 1: Fetch recording linked to encounter
    console.log('Step 1: Fetching recording linked to encounterId:', encounterId);
    const { data: recordingData, error: recordingError } = await supabase
      .from('recordings')
      .select('*')
      .eq('patientEncounter_id', encounterId)
      .single();

    let recording = null;
    if (recordingError && recordingError.code !== 'PGRST116') {
      console.error('Recording query error:', recordingError);
      return reply.status(500).send({ error: recordingError.message });
    } else if (recordingData) {
      recording = recordingData;
      delete recording.iv;
    } else if (recordingError?.code === 'PGRST116') {
      console.warn('No recording found for encounterId:', encounterId, 'RLS may have filtered the result or no recording linked');
    }

    // Step 1.5: Generate/refresh signed URL if needed
    if (recording && recording.recording_file_path) {
      const needNewSignedUrl = !recording.recording_file_signed_url || 
                               new Date(recording.recording_file_signed_url_expiry) < new Date();
      
      if (needNewSignedUrl) {
        console.log('Step 1.5: Generating signed URL for recording file');
        
        // Normalize path: strip optional bucket prefix and any leading slash
        let normalizedPath = recording.recording_file_path;
        if (normalizedPath.startsWith('audio-files/')) {
          normalizedPath = normalizedPath.replace(/^audio-files\//, '');
        }
        if (normalizedPath.startsWith('/')) normalizedPath = normalizedPath.slice(1);
        
        console.log('Creating signed URL for recording file:', normalizedPath);
        const expirySeconds = 60 * 60; // 1 hour
        
        const { data: signedUrlData, error: signedError } = await supabase.storage
          .from('audio-files')
          .createSignedUrl(normalizedPath, expirySeconds);
        
        if (signedError) {
          console.error('Signed URL error:', signedError);
          return reply.status(500).send({ error: 'Failed to create signed URL: ' + signedError.message });
        }
        
        const now = new Date();
        const expiresAt = new Date(now.getTime() + expirySeconds * 1000).toISOString();
        
        recording.recording_file_signed_url = signedUrlData.signedUrl;
        recording.recording_file_signed_url_expiry = expiresAt;
        
        // Update recording row in database
        const { data: updateData, error: updateError } = await supabase
          .from('recordings')
          .update({
            recording_file_signed_url: recording.recording_file_signed_url,
            recording_file_signed_url_expiry: recording.recording_file_signed_url_expiry
          })
          .eq('id', recording.id)
          .select()
          .single();
        
        if (updateError) {
          console.error('Error updating recording\'s file signed URL:', updateError.message);
          return reply.status(500).send({ error: updateError.message });
        }
      }
    }

    // Step 2: Fetch transcript for recording
    let transcript = null;
    if (recording) {
      console.log('Step 2: Fetching transcript for recording_id:', recording.id);
      const { data: transcriptData, error: transcriptError } = await supabase
        .from('transcripts')
        .select('*')
        .eq('recording_id', recording.id)
        .single();

      if (transcriptError && transcriptError.code !== 'PGRST116') {
        return reply.status(500).send({ error: transcriptError.message });
      } else if (transcriptData) {
        // Decrypt transcript text
        if (transcriptData.encrypted_transcript_text) {
          transcriptData.transcript_text = encryptionUtils.decryptText(
            transcriptData.encrypted_transcript_text,
            aes_key,
            transcriptData.iv
          );
          delete transcriptData.encrypted_transcript_text;
        }
        delete transcriptData.iv;
        transcript = transcriptData;
      }
    }

    // Step 3: Fetch SOAP notes for encounter
    console.log('Step 3: Fetching SOAP notes for encounterId:', encounterId);
    const { data: soapNotes, error: soapError } = await supabase
      .from('soapNotes')
      .select('*')
      .eq('patientEncounter_id', encounterId);

    let notes = [];
    if (soapError && soapError.code !== 'PGRST116') {
      return reply.status(500).send({ error: soapError.message });
    } else if (soapNotes && Array.isArray(soapNotes)) {
      // Decrypt SOAP note texts
      for (const note of soapNotes) {
        if (note.encrypted_soapNote_text) {
          note.soapNote_text = encryptionUtils.decryptText(
            note.encrypted_soapNote_text,
            aes_key,
            note.iv
          );
          delete note.encrypted_soapNote_text;
        }
        delete note.iv;
        notes.push(note);
      }
    }

    // Return complete bundle
    return reply.status(200).send({
      patientEncounter: encounterData,
      recording: recording || null,
      transcript: transcript || null,
      soapNotes: notes,
    });
  } catch (error) {
    console.error('Error fetching complete patient encounter:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Create a complete patient encounter bundle
 * POST /api/patient-encounters/complete
 * 
 * Creates a patient encounter with linked recording, transcript, and SOAP notes
 * Handles encryption, validation, and atomic transaction with rollback on failure
 * 
 * Request body: {
 *   patientEncounter: { name, recording_file_path, ... },
 *   recording: { recording_file_path, ... },
 *   transcript: { transcript_text, ... },
 *   soapNote_text: { soapNote: { subjective, objective, assessment, plan }, billingSuggestion }
 * }
 */
export async function completePatientEncounter(request, reply) {
  let patientEncounterData = null;
  let recordingData = null;
  let transcriptData = null;
  let soapNoteData = null;

  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { patientEncounter, recording, transcript, soapNote_text } = request.body;

    // Step 1: Validate all required objects are present
    if (!patientEncounter || !recording || !transcript || !soapNote_text) {
      return reply.status(400).send({
        error: 'Missing required fields: patientEncounter, recording, transcript, soapNote_text',
      });
    }

    // Step 2: Generate encryption keys for patient encounter
    const { aesKey, iv: encounterIV } = encryptionUtils.generateAESKeyAndIV();

    // Step 3: Prepare patient encounter for insertion
    // Note: recording_file_path is stored in the recordings table, not here
    // Signed URL fields are NOT stored - they're generated on demand via getRecording()
    const patientEncounterObj = {
      name: patientEncounter.name,
      user_id: user.id,
      iv: encounterIV,
      encrypted_aes_key: encryptionUtils.encryptAESKey(aesKey),
    };

    // Encrypt patient name
    if (patientEncounter.name) {
      patientEncounterObj.encrypted_name = encryptionUtils.encryptText(
        patientEncounter.name,
        aesKey,
        encounterIV
      );
      delete patientEncounterObj.name; // Remove plain field before insert
    }

    // Step 4: Insert patient encounter
    console.log('Inserting patient encounter:', patientEncounterObj);
    const { data: createdEncounter, error: encounterError } = await supabase
      .from(patientEncounterTable)
      .insert([patientEncounterObj])
      .select()
      .single();

    if (encounterError) {
      throw new Error(`Failed to create Patient Encounter: ${encounterError.message}`);
    }

    patientEncounterData = createdEncounter;
    const encounterId = patientEncounterData.id;

    // Step 5: Insert recording
    const recordingIV = encryptionUtils.generateRandomIVBase64();
    const recordingObj = {
      patientEncounter_id: encounterId,
      recording_file_path: recording.recording_file_path,
      user_id: user.id,
      iv: recordingIV,
    };

    console.log('Inserting recording:', recordingObj);
    const { data: createdRecording, error: recordingError } = await supabase
      .from('recordings')
      .insert([recordingObj])
      .select()
      .single();

    if (recordingError) {
      throw new Error(`Failed to create Recording: ${recordingError.message}`);
    }

    recordingData = createdRecording;
    const recordingId = recordingData.id;

    // Step 6: Insert transcript
    const transcriptIV = encryptionUtils.generateRandomIVBase64();
    const transcriptObj = {
      recording_id: recordingId,
      encrypted_transcript_text: transcript.transcript_text
        ? encryptionUtils.encryptText(transcript.transcript_text, aesKey, transcriptIV)
        : null,
      user_id: user.id,
      iv: transcriptIV,
    };

    console.log('Inserting transcript with encrypted text');
    const { data: createdTranscript, error: transcriptError } = await supabase
      .from('transcripts')
      .insert([transcriptObj])
      .select()
      .single();

    if (transcriptError) {
      throw new Error(`Failed to create Transcript: ${transcriptError.message}`);
    }

    transcriptData = createdTranscript;

    // Step 7: Insert SOAP note
    const soapNoteIV = encryptionUtils.generateRandomIVBase64();
    
    // soapNote_text is validated as strict object by route middleware
    const soapNoteObj = {
      patientEncounter_id: encounterId,
      encrypted_soapNote_text: soapNote_text
        ? encryptionUtils.encryptText(JSON.stringify(soapNote_text), aesKey, soapNoteIV)
        : null,
      user_id: user.id,
      iv: soapNoteIV,
    };

    console.log('Inserting SOAP note with encrypted text');
    const { data: createdSoapNote, error: soapNoteError } = await supabase
      .from('soapNotes')
      .insert([soapNoteObj])
      .select()
      .single();

    if (soapNoteError) {
      throw new Error(`Failed to create SOAP Note: ${soapNoteError.message}`);
    }

    soapNoteData = createdSoapNote;

    // Step 8: Decrypt all data before returning (to match GET response format)
    // Get the AES key for decryption
    const aes_key = encryptionUtils.decryptAESKey(patientEncounterData.encrypted_aes_key);
    
    // Decrypt patient encounter name
    if (patientEncounterData.encrypted_name) {
      patientEncounterData.name = encryptionUtils.decryptText(
        patientEncounterData.encrypted_name,
        aes_key,
        patientEncounterData.iv
      );
      delete patientEncounterData.encrypted_name;
    }
    delete patientEncounterData.encrypted_aes_key;
    delete patientEncounterData.iv;

    // Decrypt transcript text
    if (transcriptData.encrypted_transcript_text) {
      transcriptData.transcript_text = encryptionUtils.decryptText(
        transcriptData.encrypted_transcript_text,
        aes_key,
        transcriptData.iv
      );
      delete transcriptData.encrypted_transcript_text;
    }
    delete transcriptData.iv;

    // Decrypt SOAP note text
    if (soapNoteData.encrypted_soapNote_text) {
      soapNoteData.soapNote_text = JSON.parse(encryptionUtils.decryptText(
        soapNoteData.encrypted_soapNote_text,
        aes_key,
        soapNoteData.iv
      ));
      delete soapNoteData.encrypted_soapNote_text;
    }
    delete soapNoteData.iv;

    // Remove encryption key and IV from recording if present
    delete recordingData.iv;

    // Success: Return the created bundle
    return reply.status(201).send({
      patientEncounter: patientEncounterData,
      recording: recordingData,
      transcript: transcriptData,
      soapNote: soapNoteData,
    });
  } catch (error) {
    // ACID rollback: Delete all created records in reverse order
    console.error('Error in completePatientEncounter, rolling back:', error.message);

    const supabase = getSupabaseClient(request.headers.authorization);

    // Delete SOAP note first
    if (soapNoteData && soapNoteData.id) {
      console.log('Rolling back SOAP note:', soapNoteData.id);
      await supabase.from('soapNotes').delete().eq('id', soapNoteData.id);
    }

    // Delete transcript
    if (transcriptData && transcriptData.id) {
      console.log('Rolling back transcript:', transcriptData.id);
      await supabase.from('transcripts').delete().eq('id', transcriptData.id);
    }

    // Delete recording
    if (recordingData && recordingData.id) {
      console.log('Rolling back recording:', recordingData.id);
      await supabase.from('recordings').delete().eq('id', recordingData.id);
    }

    // Delete patient encounter (cascade should delete linked records, but this is a safety measure)
    if (patientEncounterData && patientEncounterData.id) {
      console.log('Rolling back patient encounter:', patientEncounterData.id);
      await supabase.from(patientEncounterTable).delete().eq('id', patientEncounterData.id);
    }

    console.error('Rollback complete');

    // Return error response
    const errorMessage = error.message || 'Failed to create complete patient encounter';
    if (errorMessage.includes('unique')) {
      return reply.status(400).send({
        error: 'Patient Encounter with this name already exists. Please use a different name.',
      });
    }

    return reply.status(500).send({ error: errorMessage });
  }
}

/**
 * Update transcript for a patient encounter
 * PATCH /api/patient-encounters/:id/transcript
 * Requires: transcript_text
 */
export async function updatePatientEncounterTranscript(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id: patientEncounterId } = request.params;

    if (!patientEncounterId || isNaN(patientEncounterId)) {
      return reply.status(400).send({ error: 'Valid Patient Encounter ID is required' });
    }

    const { transcript_text } = request.body;

    // Step 1: Fetch patient encounter with decrypted AES key
    const encounterResult = await getPatientEncounterWithDecryptedKey(supabase, patientEncounterId);
    if (!encounterResult.success) {
      return reply.status(encounterResult.statusCode).send({ error: encounterResult.error });
    }

    const { data: patientEncounter } = encounterResult;
    console.log('[fastify/controllers/patientEncountersController.js] Fetched patient encounter for transcript update:', patientEncounter);

    // Step 2: Fetch recording linked to this patient encounter
    const { data: recording, error: recordingError } = await supabase
      .from(recordingTable)
      .select('id')
      .eq('patientEncounter_id', patientEncounterId)
      .single();

    if (recordingError) {
      if (recordingError.code === 'PGRST116') {
        return reply.status(400).send({ error: 'Patient encounter has no associated recording' });
      }
      return reply.status(500).send({ error: 'Failed to fetch recording: ' + recordingError.message });
    }

    // Step 3: Prepare transcript object for encryption with new IV
    const transcript = {
      transcript_text: transcript_text,
    };

    // Encrypt transcript_text (generates new IV)
    const encryptionResult = encryptionUtils.encryptField(transcript, 'transcript_text', patientEncounter.encrypted_aes_key);
    if (!encryptionResult.success) {
      return reply.status(500).send({ error: 'Failed to encrypt transcript: ' + encryptionResult.error });
    }

    // Step 4: Check if transcript exists for this recording
    const { data: existingTranscript, error: fetchTranscriptError } = await supabase
      .from(transcriptTable)
      .select('id')
      .eq('recording_id', recording.id)
      .single();

    if (fetchTranscriptError) {
      if (fetchTranscriptError.code === 'PGRST116') {
        return reply.status(404).send({ error: 'No transcript to update. Create a transcript first.' });
      }
      return reply.status(500).send({ error: 'Failed to query transcript: ' + fetchTranscriptError.message });
    }

    // Step 5: Update existing transcript with new encrypted text and IV
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
      return reply.status(500).send({ error: 'Failed to update transcript: ' + updateError.message });
    }

    return reply.status(200).send(updateResult);
  } catch (error) {
    console.error('Error updating patient encounter transcript:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Update patient encounter and transcript together (compound update with rollback)
 * PATCH /api/patient-encounters/:id/update-with-transcript
 * Requires: name AND transcript_text
 */
export async function updatePatientEncounterWithTranscript(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id: patientEncounterId } = request.params;

    if (!patientEncounterId || isNaN(patientEncounterId)) {
      return reply.status(400).send({ error: 'Valid Patient Encounter ID is required' });
    }

    const { name, transcript_text } = request.body;

    // Step 1: Fetch patient encounter with decrypted AES key
    const encounterResult = await getPatientEncounterWithDecryptedKey(supabase, patientEncounterId);
    if (!encounterResult.success) {
      return reply.status(encounterResult.statusCode).send({ error: encounterResult.error });
    }

    const { data: patientEncounter } = encounterResult;

    // Store original encrypted name for rollback
    const originalEncryptedName = patientEncounter.encrypted_name;
    const originalIv = patientEncounter.iv;

    // Step 2: Fetch recording linked to this patient encounter
    const { data: recording, error: recordingError } = await supabase
      .from(recordingTable)
      .select('id')
      .eq('patientEncounter_id', patientEncounterId)
      .single();

    if (recordingError) {
      return reply.status(400).send({ error: 'No recording found for this patient encounter' });
    }

    // Step 3: Prepare patient encounter update (encrypt name)
    const encounterObj = { name };
    const encryptionResult = encryptionUtils.encryptField(encounterObj, 'name', patientEncounter.encrypted_aes_key);
    if (!encryptionResult.success) {
      return reply.status(500).send({ error: 'Failed to encrypt patient encounter name: ' + encryptionResult.error });
    }

    const encounterUpdate = {
      encrypted_name: encounterObj.encrypted_name,
      iv: encounterObj.iv,
      updated_at: new Date().toISOString(),
    };

    // Step 4: Prepare transcript update (encrypt transcript_text)
    const transcript = { transcript_text };
    const transcriptEncryptionResult = encryptionUtils.encryptField(transcript, 'transcript_text', patientEncounter.encrypted_aes_key);
    if (!transcriptEncryptionResult.success) {
      return reply.status(500).send({ error: 'Failed to encrypt transcript: ' + transcriptEncryptionResult.error });
    }

    // Check if transcript exists
    const { data: existingTranscript, error: fetchTranscriptError } = await supabase
      .from(transcriptTable)
      .select('id')
      .eq('recording_id', recording.id)
      .single();

    // PGRST116 = no rows found (ok)
    if (fetchTranscriptError && fetchTranscriptError.code !== 'PGRST116') {
      return reply.status(500).send({ error: 'Failed to query transcript: ' + fetchTranscriptError.message });
    }

    const transcriptUpdate = {
      encrypted_transcript_text: transcript.encrypted_transcript_text,
      iv: transcript.iv,
      updated_at: new Date().toISOString(),
    };

    // Step 5: Execute updates with rollback on failure
    try {
      // Update patient encounter
      const { error: updateEncounterError } = await supabase
        .from(patientEncounterTable)
        .update(encounterUpdate)
        .eq('id', patientEncounterId);

      if (updateEncounterError) {
        throw new Error('Failed to update patient encounter: ' + updateEncounterError.message);
      }

      // Update or create transcript
      try {
        if (existingTranscript) {
          const { error: updateTranscriptError } = await supabase
            .from(transcriptTable)
            .update(transcriptUpdate)
            .eq('id', existingTranscript.id);

          if (updateTranscriptError) {
            throw new Error('Failed to update transcript: ' + updateTranscriptError.message);
          }
        } else {
          const { error: createTranscriptError } = await supabase
            .from(transcriptTable)
            .insert({
              recording_id: recording.id,
              user_id: user.id,
              ...transcriptUpdate,
            });

          if (createTranscriptError) {
            throw new Error('Failed to create transcript: ' + createTranscriptError.message);
          }
        }
      } catch (transcriptError) {
        // ROLLBACK: Revert patient encounter update
        console.error('Transcript operation failed, rolling back patient encounter update:', transcriptError);
        const rollbackData = {
          encrypted_name: originalEncryptedName,
          iv: originalIv,
        };
        await supabase
          .from(patientEncounterTable)
          .update(rollbackData)
          .eq('id', patientEncounterId);
        throw transcriptError;
      }

      // Step 6: Fetch and return updated data
      const { data: updatedEncounter, error: fetchEncounterError } = await supabase
        .from(patientEncounterTable)
        .select('*')
        .eq('id', patientEncounterId)
        .single();

      if (fetchEncounterError) {
        throw new Error('Failed to fetch updated encounter: ' + fetchEncounterError.message);
      }

      let updatedTranscript = null;
      const { data: fetchedTranscript, error: fetchTranscriptError2 } = await supabase
        .from(transcriptTable)
        .select('*')
        .eq('recording_id', recording.id)
        .single();

      if (fetchTranscriptError2 && fetchTranscriptError2.code !== 'PGRST116') {
        throw new Error('Failed to fetch updated transcript: ' + fetchTranscriptError2.message);
      }
      updatedTranscript = fetchedTranscript;

      return reply.status(200).send({
        success: true,
        data: {
          patientEncounter: updatedEncounter,
          transcript: updatedTranscript,
        },
      });
    } catch (transactionError) {
      console.error('Transaction error during compound update:', transactionError);
      return reply.status(500).send({ error: transactionError.message });
    }
  } catch (error) {
    console.error('Error updating patient encounter with transcript:', error);
    return reply.status(500).send({ error: error.message });
  }
}
