import { getSupabaseClient } from '@/src/utils/supabase';
import { authenticateRequest } from '@/src/utils/authenticateRequest';
import { soapNoteSchema } from '@/src/app/schemas';
import * as encryptionUtils from '@/src/utils/encryptionUtils';
import * as format from '@/public/scripts/format';
import parseSoapNotes from '@/src/utils/parseSoapNotes';
const soapNoteTable = 'soapNotes';
const patientEncounterTable = 'patientEncounters';

/**
 * Encrypts soapNote_text for a soapNote object by:
 * 1. Fetching the encrypted AES key via patientEncounter_id.
 * 2. Encrypting soapNote_text and updating the soapNote object.
 * Returns { success, error, soapNote }.
 * @param {object} supabase - Supabase client instance.
 * @param {object} soapNote - SoapNote object containing soapNote_text and patientEncounter_id.
 */
async function encryptSoapNoteText(supabase, soapNote) {
  // 1. Get encrypted_aes_key by joining patientEncounter
  const { data, error } = await supabase
    .from(patientEncounterTable)
    .select('encrypted_aes_key')
    .eq('id', soapNote.patientEncounter_id)
    .single();
  // console.log('Fetched patientEncounter for encryption:', data, error);

  if (error || !data || !data.encrypted_aes_key) {
    return { success: false, error: 'Could not find patient encounter for provided patientEncounter_id', soapNote: null };
  }
  const encryptedAESKey = data.encrypted_aes_key;

  // 2. Encrypt soapNote_text
  const encryptionFieldResult = encryptionUtils.encryptField(soapNote, 'soapNote_text', encryptedAESKey);
  if (!encryptionFieldResult.success) {
    console.error('Failed to encrypt soapNote_text:', encryptionFieldResult.error);
    return { success: false, error: 'Failed to encrypt soapNote_text', soapNote: null };
  }

  return { success: true, error: null, soapNote };
}

export default async function handler(req, res) {
  const supabase = getSupabaseClient(req.headers.authorization);
  const { user, error: authError } = await authenticateRequest(req);
  if (authError) return res.status(401).json({ error: authError });

  // GET: ------------------------------------------------------------------------------
  if (req.method === 'GET') {
    const id = req.query.id;
    if (!id) { return res.status(400).json({ error: 'id is required' }); }
    const { data, error } = await supabase
      .from(soapNoteTable)
      .select(`
        *,
        patientEncounter:patientEncounter_id (
          encrypted_aes_key
        )
      `)
      .eq('id', id)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'SOAP Note not found' });

    // Decrypt soapNote_text before sending to frontend
    const decryptResult = await encryptionUtils.decryptField(
      data,
      'soapNote_text',
      data.patientEncounter?.encrypted_aes_key,
      data.iv
    );
    if (!decryptResult.success) {
      return res.status(400).json({ error: decryptResult.error });
    }
    delete data.patientEncounter; // Clean up joined field
    console.log('Decrypted SOAP Note:', data); 
    try {
      data.soapNote_text = parseSoapNotes(data.soapNote_text);
      console.log('Parsed SOAP Note text:', data.soapNote_text);
      // data.soapNote_text = JSON.parse(data.soapNote_text);
    } catch (parseErr) {
      console.error("Decryption succeeded but JSON parse of SOAP Note failed:", parseErr);
      return res.status(400).json({ error: 'Failed to parse SOAP Note text' });
    }
    return res.status(200).json(data);
  }

  // POST --------------------------------------------------------------------------------
  if (req.method === 'POST') {
    const parseResult = soapNoteSchema.partial().safeParse(req.body);
    if (!parseResult.success) {
      console.error('Invalid SOAP Note data:', parseResult.error);
      return res.status(400).json({ error: parseResult.error });
    }
    const soapNote = parseResult.data;
    soapNote.user_id = user.id;
    soapNote.soapNote_text = req.body.soapNote_text; // Ensure soapNote_text is set

    if (!soapNote.soapNote_text || !soapNote.patientEncounter_id) {
      return res.status(400).json({ error: 'soapNote_text and patientEncounter_id are required' });
    }
    if (typeof soapNote.soapNote_text === 'object') {
      soapNote.soapNote_text = JSON.stringify(soapNote.soapNote_text);
    }

    // Encrypt soapNote_text
    const encryptionResult = await encryptSoapNoteText(supabase, soapNote);
    if (!encryptionResult.success) {
      return res.status(400).json({ error: encryptionResult.error });
    }

    const { data, error } = await supabase
      .from(soapNoteTable)
      .insert([soapNote])
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // PATCH ------------------------------------------------------------------------
  if (req.method === 'PATCH') {
    const parseResult = soapNoteSchema.partial().safeParse(req.body);
    if (!parseResult.success) {
      console.error('Invalid SOAP Note data:', parseResult.error);
      return res.status(400).json({ error: parseResult.error });
    }
    const soapNote = parseResult.data;
    soapNote.soapNote_text = req.body.soapNote_text; // Ensure soapNote_text is set
    if (!soapNote.id || !soapNote.soapNote_text) {
      return res.status(400).json({ error: 'id and soapNote_text are required for update' });
    }
    if (typeof soapNote.soapNote_text === 'object') {
      soapNote.soapNote_text = JSON.stringify(soapNote.soapNote_text);
    }

    const { data: existingSoapNote, error: fetchError } = await supabase
      .from(soapNoteTable)
      .select('patientEncounter_id')
      .eq('id', soapNote.id)
      .single();
    if (fetchError) {
      return res.status(500).json({ error: 'Failed to fetch existing SOAP Note for update' });
    }


    // Encrypt soapNote_text
    soapNote.patientEncounter_id = existingSoapNote.patientEncounter_id; // Ensure patientEncounter_id is set for encryption
    const encryptionResult = await encryptSoapNoteText(supabase, soapNote);
    if (!encryptionResult.success) {
      return res.status(400).json({ error: encryptionResult.error });
    }
    delete soapNote.patientEncounter_id; // No need to update patientEncounter_id

    const { data, error } = await supabase
      .from(soapNoteTable)
      .update(soapNote)
      .eq('id', soapNote.id)
      .select();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // DELETE ------------------------------------------------------------------------
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'SOAP Note ID is required' });
    const { data, error } = await supabase
      .from(soapNoteTable)
      .delete()
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, data });
  }

  res.status(405).json({ error: 'Method not allowed' });
}