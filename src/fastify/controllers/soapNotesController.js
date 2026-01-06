/**
 * SOAP Notes Controller
 * Handles all SOAP note CRUD operations with encryption/decryption
 */
import { getSupabaseClient } from '../../utils/supabase.js';
import { soapNoteCreateRequestSchema, soapNoteUpdateRequestSchema } from '../schemas/requests.js';
import * as encryptionUtils from '../../utils/encryptionUtils.js';
import parseSoapNotes from '../../utils/parseSoapNotes.js';

const soapNoteTable = 'soapNotes';
const BATCH_SIZE = 10; // Decrypt SOAP notes in batches for performance

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
 * Helper: Decrypts soapNote_text for a SOAP note object
 * Expects soapNote to have patientEncounter.encrypted_aes_key joined
 * Returns { success, error, soapNote }
 */
async function decryptSoapNoteText(soapNote) {
  const encryptedAESKey = soapNote.patientEncounter?.encrypted_aes_key || null;
  const decryptFieldResult = await encryptionUtils.decryptField(
    soapNote,
    'soapNote_text',
    encryptedAESKey
  );

  if (!decryptFieldResult.success) {
    console.error('Failed to decrypt SOAP note:', soapNote.id, '. Error:', decryptFieldResult.error);
    return { success: false, error: decryptFieldResult.error };
  }

  // Parse the soapNote_text JSON
  try {
    soapNote.soapNote_text = parseSoapNotes(soapNote.soapNote_text);
  } catch (e) {
    console.error('Failed to parse soapNote_text for SOAP note:', soapNote.id, '. Error:', e);
    return { success: false, error: 'Failed to parse soapNote_text' };
  }

  // Clean up joined fields
  delete soapNote.patientEncounter;
  return { success: true, soapNote };
}

/**
 * Get all SOAP notes for the authenticated user (with pagination and batched decryption)
 * GET /api/soap-notes
 * Query params: limit (default 100), offset (default 0), sortBy (default 'created_at'), order (default 'desc')
 */
export async function getAllSoapNotes(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Parse and validate query parameters
    const { limit = 100, offset = 0, sortBy = 'created_at', order = 'desc' } = request.query;
    
    // Validate limit is numeric and positive
    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum <= 0) {
      return reply.status(400).send({ error: 'Invalid limit parameter: must be a positive number' });
    }
    
    // Validate offset is numeric and non-negative
    const offsetNum = parseInt(offset);
    if (isNaN(offsetNum) || offsetNum < 0) {
      return reply.status(400).send({ error: 'Invalid offset parameter: must be a non-negative number' });
    }

    // Fetch SOAP notes with patientEncounter join for encryption key
    const { data, error } = await supabase
      .from(soapNoteTable)
      .select(`
        *,
        patientEncounter:patientEncounter_id (
          encrypted_aes_key
        )
      `)
      .eq('user_id', user.id)
      .order(sortBy, { ascending: order === 'asc' })
      .range(offsetNum, offsetNum + limitNum - 1);

    if (error) {
      console.error('Error fetching SOAP notes:', error);
      return reply.status(500).send({ error: error.message });
    }

    // Decrypt soapNote_text in batches for performance
    for (let i = 0; i < data.length; i += BATCH_SIZE) {
      const batch = data.slice(i, i + BATCH_SIZE);
      const decryptPromises = batch.map((soapNote) => decryptSoapNoteText(soapNote));
      const results = await Promise.all(decryptPromises);

      for (let j = 0; j < results.length; j++) {
        if (!results[j].success) {
          return reply.status(400).send({ error: results[j].error });
        }
        // Update original array with decrypted data
        batch[j] = results[j].soapNote;
      }
    }

    return reply.status(200).send(data);
  } catch (error) {
    console.error('Error fetching SOAP notes:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Get a single SOAP note by ID
 * GET /api/soap-notes/:id
 */
export async function getSoapNote(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params;

    // Validate bigint ID format
    if (!isValidBigInt(id)) {
      return reply.status(400).send({ error: 'Invalid SOAP note ID format' });
    }

    // Fetch single SOAP note with patientEncounter join
    const { data: soapNote, error } = await supabase
      .from(soapNoteTable)
      .select(`
        *,
        patientEncounter:patientEncounter_id (
          encrypted_aes_key
        )
      `)
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !soapNote) {
      return reply.status(404).send({ error: 'SOAP note not found' });
    }

    // Decrypt soapNote_text
    const decryptResult = await decryptSoapNoteText(soapNote);
    if (!decryptResult.success) {
      return reply.status(400).send({ error: decryptResult.error });
    }

    return reply.status(200).send(decryptResult.soapNote);
  } catch (error) {
    console.error('Error fetching SOAP note:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Create a new SOAP note
 * POST /api/soap-notes
 * Body: { patientEncounter_id, soapNote_text }
 */
export async function createSoapNote(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Validate request body
    const validationResult = soapNoteCreateRequestSchema.safeParse(request.body);
    if (!validationResult.success) {
      return reply.status(400).send({ error: validationResult.error.errors });
    }

    const { patientEncounter_id, soapNote_text } = validationResult.data;

    // Verify user owns the patientEncounter
    const { data: encounter, error: encounterError } = await supabase
      .from('patientEncounters')
      .select('encrypted_aes_key')
      .eq('id', patientEncounter_id)
      .eq('user_id', user.id)
      .single();

    if (encounterError || !encounter) {
      return reply.status(404).send({ error: 'Patient encounter not found' });
    }

    // Encrypt soapNote_text using patientEncounter's AES key
    // Convert object to JSON string for encryption
    const encryptedAESKey = encounter.encrypted_aes_key;
    
    let encryptedText;
    let iv;
    try {
      const encryptResult = encryptionUtils.encryptField(
        { soapNote_text: JSON.stringify(validationResult.data.soapNote_text) },
        'soapNote_text',
        encryptedAESKey
      );
      if (!encryptResult.success) {
        return reply.status(500).send({ error: 'Failed to encrypt SOAP note text' });
      }
      encryptedText = encryptResult.value;
      iv = encryptResult.iv;
    } catch (encryptError) {
      console.error('Encryption error:', encryptError);
      return reply.status(500).send({ error: 'Failed to encrypt SOAP note text' });
    }

    // Insert SOAP note into database
    const { data: newSoapNote, error: insertError } = await supabase
      .from(soapNoteTable)
      .insert({
        user_id: user.id,
        patientEncounter_id,
        encrypted_soapNote_text: encryptedText,
        iv,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return reply.status(500).send({ error: insertError.message });
    }

    // Return decrypted SOAP note in response
    newSoapNote.soapNote_text = soapNote_text;
    return reply.status(201).send(newSoapNote);
  } catch (error) {
    console.error('Error creating SOAP note:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Update a SOAP note
 * PATCH /api/soap-notes/:id
 * Body: { soapNote_text }
 */
export async function updateSoapNote(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params;

    // Validate bigint ID format
    if (!isValidBigInt(id)) {
      return reply.status(400).send({ error: 'Invalid SOAP note ID format' });
    }

    // Validate request body
    const validationResult = soapNoteUpdateRequestSchema.safeParse(request.body);
    if (!validationResult.success) {
      return reply.status(400).send({ error: validationResult.error.errors });
    }

    const { soapNote_text } = validationResult.data;

    // Fetch SOAP note with patientEncounter to get AES key
    const { data: soapNote, error: fetchError } = await supabase
      .from(soapNoteTable)
      .select(`
        *,
        patientEncounter:patientEncounter_id (
          encrypted_aes_key
        )
      `)
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !soapNote) {
      return reply.status(404).send({ error: 'SOAP note not found' });
    }

    // Encrypt the updated soapNote_text
    // Convert object to JSON string for encryption
    const encryptedAESKey = soapNote.patientEncounter?.encrypted_aes_key;
    let encryptedText;
    let iv;
    try {
      const encryptResult = encryptionUtils.encryptField(
        { soapNote_text: JSON.stringify(soapNote_text) },
        'soapNote_text',
        encryptedAESKey
      );
      if (!encryptResult.success) {
        return reply.status(500).send({ error: 'Failed to encrypt SOAP note text' });
      }
      encryptedText = encryptResult.value;
      iv = encryptResult.iv;
    } catch (encryptError) {
      console.error('Encryption error:', encryptError);
      return reply.status(500).send({ error: 'Failed to encrypt SOAP note text' });
    }

    // Update SOAP note in database
    const { data: updatedSoapNote, error: updateError } = await supabase
      .from(soapNoteTable)
      .update({
        encrypted_soapNote_text: encryptedText,
        iv,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('Update error:', updateError);
      return reply.status(500).send({ error: updateError.message });
    }

    // Return decrypted SOAP note in response
    updatedSoapNote.soapNote_text = soapNote_text;
    return reply.status(200).send(updatedSoapNote);
  } catch (error) {
    console.error('Error updating SOAP note:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Delete a SOAP note
 * DELETE /api/soap-notes/:id
 */
export async function deleteSoapNote(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params;

    // Validate bigint ID format
    if (!isValidBigInt(id)) {
      return reply.status(400).send({ error: 'Invalid SOAP note ID format' });
    }

    // Delete SOAP note and return the deleted data (RLS policy ensures user can only delete their own)
    const { data, error: deleteError } = await supabase
      .from(soapNoteTable)
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (deleteError) {
      if (deleteError.code === 'PGRST116') {
        return reply.status(404).send({ error: 'SOAP note not found' });
      }
      console.error('Delete error:', deleteError);
      return reply.status(500).send({ error: deleteError.message });
    }

    return reply.status(200).send({ success: true, data });
  } catch (error) {
    console.error('Error deleting SOAP note:', error);
    return reply.status(500).send({ error: error.message });
  }
}
