/**
 * Transcripts Controller
 * Handles all transcript CRUD operations with encryption/decryption
 */
import { getSupabaseClient } from '../../utils/supabase.js';
import * as encryptionUtils from '../../utils/encryptionUtils.js';

const transcriptTable = 'transcripts';
const BATCH_SIZE = 10; // Decrypt transcripts in batches of 10

/**
 * Helper: Encrypts transcript_text for a transcript object
 * Fetches the encrypted AES key via recording_id -> patientEncounter
 * Returns { success, error, transcript }
 */
async function encryptTranscriptText(supabase, transcript) {
  // Get encrypted_aes_key by joining recording -> patientEncounter
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

  if (error || !data || !data.patientEncounter?.encrypted_aes_key) {
    return {
      success: false,
      error: 'Could not find recording or patient encounter for provided recording_id',
      transcript: null,
    };
  }

  const encryptedAESKey = data.patientEncounter.encrypted_aes_key;

  // Encrypt transcript_text
  const encryptionFieldResult = encryptionUtils.encryptField(
    transcript,
    'transcript_text',
    encryptedAESKey
  );

  if (!encryptionFieldResult.success) {
    console.error('Failed to encrypt transcript_text:', encryptionFieldResult.error);
    return {
      success: false,
      error: 'Failed to encrypt transcript_text',
      transcript: null,
    };
  }

  return { success: true, error: null, transcript };
}

/**
 * Helper: Decrypts transcript_text for a transcript object
 * Expects transcript to have recording.patientEncounter.encrypted_aes_key joined
 * Returns { success, error, transcript }
 */
async function decryptTranscriptText(transcript) {
  const encryptedAESKey = transcript.recording?.patientEncounter?.encrypted_aes_key || null;
  const decryptFieldResult = await encryptionUtils.decryptField(
    transcript,
    'transcript_text',
    encryptedAESKey
  );

  if (!decryptFieldResult.success) {
    console.error('Failed to decrypt transcript:', transcript.id, '. Error:', decryptFieldResult.error);
    return { success: false, error: decryptFieldResult.error };
  }

  // Clean up joined fields
  delete transcript.recording;
  return { success: true, transcript };
}

/**
 * Get all transcripts for authenticated user (with batched decryption)
 * GET /api/transcripts
 */
export async function getAllTranscripts(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Fetch all transcripts with recording + patientEncounter joins
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
      .order('updated_at', { ascending: false });

    if (error) {
      return reply.status(500).send({ error: error.message });
    }

    // Decrypt transcript_text in batches for performance
    for (let i = 0; i < data.length; i += BATCH_SIZE) {
      const batch = data.slice(i, i + BATCH_SIZE);
      const decryptPromises = batch.map((transcript) => decryptTranscriptText(transcript));
      const results = await Promise.all(decryptPromises);

      for (let j = 0; j < results.length; j++) {
        if (!results[j].success) {
          return reply.status(400).send({ error: results[j].error });
        }
        // Update original array with decrypted data
        batch[j] = results[j].transcript;
      }
    }

    return reply.status(200).send(data);
  } catch (error) {
    console.error('Error fetching transcripts:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Get a single transcript by ID
 * GET /api/transcripts/:id
 */
export async function getTranscript(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params;

    if (!id || isNaN(id)) {
      return reply.status(400).send({ error: 'Valid transcript ID is required' });
    }

    // Fetch single transcript with joins
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
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return reply.status(404).send({ error: 'Transcript not found' });
      }
      return reply.status(500).send({ error: error.message });
    }

    // Decrypt transcript_text
    const decryptionResult = await decryptTranscriptText(data);
    if (!decryptionResult.success) {
      return reply.status(400).send({ error: decryptionResult.error });
    }

    return reply.status(200).send(decryptionResult.transcript);
  } catch (error) {
    console.error('Error fetching transcript:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Create a new transcript
 * POST /api/transcripts
 */
export async function createTranscript(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const transcript = request.body;
    transcript.user_id = user.id;

    if (!transcript.transcript_text || !transcript.recording_id) {
      return reply.status(400).send({ error: 'transcript_text and recording_id are required' });
    }

    // Encrypt transcript_text
    const encryptionResult = await encryptTranscriptText(supabase, transcript);
    if (!encryptionResult.success) {
      return reply.status(400).send({ error: encryptionResult.error });
    }

    // Insert encrypted transcript
    const { data: insertData, error: insertError } = await supabase
      .from(transcriptTable)
      .insert([transcript])
      .select()
      .single();

    if (insertError) {
      return reply.status(500).send({ error: insertError.message });
    }

    return reply.status(201).send(insertData);
  } catch (error) {
    console.error('Error creating transcript:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Update a transcript - DISABLED
 * PATCH /api/transcripts/:id
 * 
 * Reason: Transcripts are immutable after creation.
 * Database trigger (prevent_transcript_fk_updates) prevents updating:
 * - recording_id (foreign key cannot be changed)
 * - user_id (ownership cannot be changed)
 * 
 * The only updateable field (transcript_text) is not practically useful.
 * If corrections are needed, delete and recreate the transcript.
 */
/*
export async function updateTranscript(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params;

    if (!id || isNaN(id)) {
      return reply.status(400).send({ error: 'Valid transcript ID is required' });
    }

    // Validate request body
    const parseResult = transcriptUpdateRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error });
    }

    const { transcript_text } = parseResult.data;

    if (!transcript_text) {
      return reply.status(400).send({ error: 'transcript_text is required for update' });
    }

    // Fetch existing transcript to get recording_id
    const { data: existingTranscript, error: fetchError } = await supabase
      .from(transcriptTable)
      .select('recording_id')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return reply.status(404).send({ error: 'Transcript not found' });
      }
      return reply.status(500).send({ error: fetchError.message });
    }

    // Prepare transcript object for encryption
    const transcriptToEncrypt = {
      transcript_text,
      recording_id: existingTranscript.recording_id,
    };

    // Encrypt transcript_text
    const encryptionResult = await encryptTranscriptText(supabase, transcriptToEncrypt);
    if (!encryptionResult.success) {
      return reply.status(400).send({ error: encryptionResult.error });
    }

    // Prepare update object
    const updateData = {
      encrypted_transcript_text: transcriptToEncrypt.encrypted_transcript_text,
      iv: transcriptToEncrypt.iv,
      updated_at: new Date().toISOString(),
    };

    // Update transcript
    const { data: updatedData, error: updateError } = await supabase
      .from(transcriptTable)
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      if (updateError.code === 'PGRST116') {
        return reply.status(404).send({ error: 'Transcript not found' });
      }
      return reply.status(500).send({ error: updateError.message });
    }

    return reply.status(200).send(updatedData);
  } catch (error) {
    console.error('Error updating transcript:', error);
    return reply.status(500).send({ error: error.message });
  }
}
*/

/**
 * Delete a transcript
 * DELETE /api/transcripts/:id
 */
export async function deleteTranscript(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params;

    if (!id || isNaN(id)) {
      return reply.status(400).send({ error: 'Valid transcript ID is required' });
    }

    const { data, error } = await supabase
      .from(transcriptTable)
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return reply.status(404).send({ error: 'Transcript not found' });
      }
      return reply.status(500).send({ error: error.message });
    }

    return reply.status(200).send({ success: true, data });
  } catch (error) {
    console.error('Error deleting transcript:', error);
    return reply.status(500).send({ error: error.message });
  }
}
