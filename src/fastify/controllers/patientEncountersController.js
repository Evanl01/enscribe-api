/**
 * Patient Encounters Controller
 * Handles all patient encounter CRUD operations, batch operations, and completion
 */
import { getSupabaseClient } from '../../utils/supabase.js';
import { patientEncounterCreateRequestSchema, patientEncounterUpdateRequestSchema, patientEncounterForDatabaseSchema } from '../schemas/requests.js';
import * as encryptionUtils from '../../utils/encryptionUtils.js';

const patientEncounterTable = 'patientEncounters';

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

    // Decrypt sensitive fields
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

    // Decrypt sensitive fields
    if (encounter.encrypted_aes_key && encounter.iv && encounter.encrypted_name) {
      const aes_key = encryptionUtils.decryptAESKey(encounter.encrypted_aes_key);
      encounter.name = encryptionUtils.decryptText(
        encounter.encrypted_name,
        aes_key,
        encounter.iv
      );
      delete encounter.encrypted_name;
    }

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

    // Validate request body
    const parseResult = patientEncounterCreateRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error });
    }

    const encounter = parseResult.data;

    // Validate required fields
    if (!encounter.name) {
      return reply.status(400).send({ error: 'name is required' });
    }

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

    // Validate request body
    const parseResult = patientEncounterUpdateRequestSchema.partial().safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error });
    }

    const updates = parseResult.data;

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
 * Batch operations on patient encounters
 * POST /api/patient-encounters/batch
 */
export async function batchPatientEncounters(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { action, ids } = request.body;

    // Validate request
    if (!action || !ids || !Array.isArray(ids)) {
      return reply.status(400).send({ error: 'action and ids (array) are required' });
    }

    if (ids.length === 0) {
      return reply.status(400).send({ error: 'ids array cannot be empty' });
    }

    const validActions = ['delete', 'archive', 'update'];
    if (!validActions.includes(action)) {
      return reply.status(400).send({ error: `action must be one of: ${validActions.join(', ')}` });
    }

    // Validate all IDs are UUIDs
    for (const id of ids) {
      if (!isValidBigInt(id)) {
        return reply.status(400).send({ error: `Invalid ID format: ${id}` });
      }
    }

    let result;

    if (action === 'delete') {
      const { data, error } = await supabase
        .from(patientEncounterTable)
        .delete()
        .in('id', ids)
        .eq('user_id', user.id);

      if (error) {
        return reply.status(500).send({ error: error.message });
      }

      result = { success: true, message: `${ids.length} encounters deleted`, ids };
    } else if (action === 'archive') {
      const { data, error } = await supabase
        .from(patientEncounterTable)
        .update({ archived: true })
        .in('id', ids)
        .eq('user_id', user.id);

      if (error) {
        return reply.status(500).send({ error: error.message });
      }

      result = { success: true, message: `${ids.length} encounters archived`, ids };
    } else if (action === 'update') {
      const { updates } = request.body;
      if (!updates || typeof updates !== 'object') {
        return reply.status(400).send({ error: 'updates object is required for update action' });
      }

      const { data, error } = await supabase
        .from(patientEncounterTable)
        .update(updates)
        .in('id', ids)
        .eq('user_id', user.id);

      if (error) {
        return reply.status(500).send({ error: error.message });
      }

      result = { success: true, message: `${ids.length} encounters updated`, ids };
    }

    return reply.status(200).send(result);
  } catch (error) {
    console.error('Error in batch operation:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Mark a patient encounter as complete
 * POST /api/patient-encounters/:id/complete
 */
export async function completePatientEncounter(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params;
    const { notes, completedAt } = request.body;

    // Validate bigint ID format
    if (!isValidBigInt(id)) {
      return reply.status(400).send({ error: 'Invalid ID format - must be a numeric ID' });
    }

    const updateData = {
      completed: true,
      completed_at: completedAt || new Date().toISOString(),
    };

    if (notes) {
      updateData.notes = notes;
    }

    const { data, error } = await supabase
      .from(patientEncounterTable)
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return reply.status(404).send({ error: 'Encounter not found' });
      }
      return reply.status(500).send({ error: error.message });
    }

    return reply.status(200).send(data);
  } catch (error) {
    console.error('Error completing patient encounter:', error);
    return reply.status(500).send({ error: error.message });
  }
}

/**
 * Helper function to validate bigint ID format
 */
function isValidBigInt(id) {
  // IDs should be numeric strings
  return /^\d+$/.test(id);
}
