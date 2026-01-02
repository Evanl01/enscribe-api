/**
 * Recordings Controller
 * Handles all recording-related operations including listing attached/unattached files
 */
import { getSupabaseClient } from '../../utils/supabase.js';
import * as encryptionUtils from '../../utils/encryptionUtils.js';

const recordingTableName = 'recordings';
const patientEncounterTableName = 'patientEncounters';

/**
 * Get recordings with attachment status
 * GET /api/recordings/attachments
 * 
 * Query Parameters:
 * - attached: 'true' or 'false' (required)
 * - limit: number (default: 100)
 * - offset: number (default: 0)
 * - sortBy: 'name' | 'created_at' | 'updated_at' (default: 'name')
 * - order: 'asc' | 'desc' (default: 'asc')
 */
export async function getRecordingsAttachments(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Parse and validate query parameters
    const { attached, limit = 100, offset = 0, sortBy = 'name', order = 'asc' } = request.query;
    
    // Convert limit and offset to numbers
    const limitNum = parseInt(limit) || 100;
    const offsetNum = parseInt(offset) || 0;

    const attachedBool = attached === 'true';
    const userId = user.id;

    // Get all recordings for this user with patientEncounter join
    // RLS policy ensures user can only access their own recordings
    const { data: recordingsData, error: recordingsError } = await supabase
      .from(recordingTableName)
      .select(`
        *,
        patientEncounters:patientEncounter_id (*)
      `)
      .order('recording_file_path', { ascending: true });

    if (recordingsError) {
      console.error('Error fetching recordings:', recordingsError);
      return reply.status(500).send({ error: recordingsError.message });
    }

    // Get all files from storage bucket for this user
    const allStorageFiles = [];
    const pageSize = 1000;
    let offset_storage = 0;
    let hasMoreFiles = true;

    while (hasMoreFiles) {
      const { data: storageData, error: storageError } = await supabase.storage
        .from('audio-files')
        .list(userId, {
          limit: pageSize,
          offset: offset_storage,
          sortBy: { column: 'name', order: 'asc' }
        });

      if (storageError) {
        console.error('Error fetching storage files:', storageError);
        return reply.status(500).send({ error: storageError.message });
      }

      // If no data returned or empty array, we're done
      if (!storageData || storageData.length === 0) {
        hasMoreFiles = false;
        break;
      }

      // Add files to our collection
      allStorageFiles.push(...storageData);

      // If we got fewer files than requested, we've reached the end
      if (storageData.length < pageSize) {
        hasMoreFiles = false;
      } else {
        // Move to next page
        offset_storage += storageData.length;
      }
    }

    // Create a map of storage files by filename for quick lookup
    const storageFileMap = new Map();
    allStorageFiles.forEach(file => {
      const fullPath = `${userId}/${file.name}`;
      storageFileMap.set(fullPath, file);
    });

    if (attachedBool) {
      // Build attached recordings array (all records, not paginated yet)
      const attachedRecordings = await Promise.all(recordingsData.map(async recording => {
        const storageFile = storageFileMap.get(recording.recording_file_path);
        const missing = !storageFile;
        
        let patientEncounterData = recording.patientEncounters || null;
        
        // Decrypt patientEncounter name if present
        if (patientEncounterData && patientEncounterData.encrypted_name) {
          try {
            const aes_key = encryptionUtils.decryptAESKey(patientEncounterData.encrypted_aes_key);
            const decryptPatientEncounterResult = await encryptionUtils.decryptField(patientEncounterData, 'name', patientEncounterData.encrypted_aes_key);
            if (!decryptPatientEncounterResult.success) {
              console.error('Failed to decrypt patient encounter name:', decryptPatientEncounterResult.error);
              // Keep the original data but mark as decryption failed
              patientEncounterData = { ...patientEncounterData, name: '[Decryption Failed]' };
            } else {
              // Remove encrypted fields before returning
              const { encrypted_name, encrypted_aes_key, iv, ...cleanPatientEncounterData } = patientEncounterData;
              patientEncounterData = cleanPatientEncounterData;
            }
          } catch (error) {
            console.error('Error decrypting patient encounter name:', error);
            // Keep the original data but mark as decryption failed
            const { encrypted_name, encrypted_aes_key, iv, ...cleanPatientEncounterData } = patientEncounterData;
            patientEncounterData = { ...cleanPatientEncounterData, name: '[Decryption Failed]' };
          }
        }
        
        return {
          id: recording.id, // Include recording ID for signed URL fetching
          path: recording.recording_file_path,
          size: missing ? null : storageFile.metadata?.size || null,
          missing: missing,
          created_at: missing ? null : storageFile.created_at || null,
          updated_at: missing ? null : storageFile.updated_at || null,
          patientEncounter: patientEncounterData,
          // Include database timestamps for sorting
          db_created_at: recording.created_at,
          db_updated_at: recording.updated_at
        };
      }));

      // Apply sorting based on sortBy parameter
      attachedRecordings.sort((a, b) => {
        let valueA, valueB;
        
        if (sortBy === 'name') {
          valueA = a.path || '';
          valueB = b.path || '';
          const comparison = valueA.localeCompare(valueB);
          return order === 'asc' ? comparison : -comparison;
        } else if (sortBy === 'created_at') {
          // Use database timestamps for attached recordings
          valueA = new Date(a.db_created_at || 0);
          valueB = new Date(b.db_created_at || 0);
        } else if (sortBy === 'updated_at') {
          // Use database timestamps for attached recordings
          valueA = new Date(a.db_updated_at || 0);
          valueB = new Date(b.db_updated_at || 0);
        }
        
        if (sortBy !== 'name') {
          const comparison = valueA - valueB;
          return order === 'asc' ? comparison : -comparison;
        }
        return 0;
      });

      // Remove temporary database timestamp fields and apply pagination
      const result = attachedRecordings
        .slice(offsetNum, offsetNum + limitNum)
        .map(({ db_created_at, db_updated_at, ...recording }) => recording);

      return reply.status(200).send(result);
    } else {
      // Build unattached files array (files in storage but not in recordings table)
      const recordingPaths = new Set(recordingsData.map(r => r.recording_file_path));
      
      const unattachedFiles = [];
      for (const file of allStorageFiles) {
        const fullPath = `${userId}/${file.name}`;
        if (!recordingPaths.has(fullPath)) {
          unattachedFiles.push({
            path: fullPath,
            size: file.metadata?.size || null,
            created_at: file.created_at || null,
            updated_at: file.updated_at || null
          });
        }
      }

      // Apply sorting based on sortBy parameter
      unattachedFiles.sort((a, b) => {
        let valueA, valueB;
        
        if (sortBy === 'name') {
          valueA = a.path || '';
          valueB = b.path || '';
          const comparison = valueA.localeCompare(valueB);
          return order === 'asc' ? comparison : -comparison;
        } else if (sortBy === 'created_at') {
          // Use storage timestamps for unattached files
          valueA = new Date(a.created_at || 0);
          valueB = new Date(b.created_at || 0);
        } else if (sortBy === 'updated_at') {
          // Use storage timestamps for unattached files
          valueA = new Date(a.updated_at || 0);
          valueB = new Date(b.updated_at || 0);
        }
        
        if (sortBy !== 'name') {
          const comparison = valueA - valueB;
          return order === 'asc' ? comparison : -comparison;
        }
        return 0;
      });

      // Apply pagination to unattached files
      const paginatedUnattached = unattachedFiles.slice(offsetNum, offsetNum + limitNum);
      return reply.status(200).send(paginatedUnattached);
    }

  } catch (error) {
    console.error('Error in getRecordingsAttachments:', error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
}

/**
 * Create a recording entry linked to a patient encounter
 * POST /api/recordings
 * Body: { patient_encounter_id, recording_file_path }
 */
export async function createRecording(request, reply) {
  try {
    // Check authentication
    const userId = request.user?.id;  // Supabase returns ID in 'id' property, not 'sub'
    if (!userId) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }

    const { patientEncounter_id, recording_file_path } = request.body || {};

    // Validate required fields
    if (!patientEncounter_id || !recording_file_path) {
      return reply.status(400).send({ 
        error: 'Missing required fields: patientEncounter_id, recording_file_path' 
      });
    }

    // Use the user's authenticated client with their authorization header
    const supabase = getSupabaseClient(request.headers.authorization);
    
    // Verify the encounter exists and belongs to this user
    const { data: encounterData, error: encounterError } = await supabase
      .from(patientEncounterTableName)
      .select('id')
      .eq('id', patientEncounter_id)
      .eq('user_id', userId);

    if (encounterError) {
      console.error('[createRecording] Encounter query error:', encounterError);
      return reply.status(500).send({ error: 'Database error' });
    }

    if (!encounterData || encounterData.length === 0) {
      console.error('[createRecording] No matching encounter found for id:', patientEncounter_id);
      return reply.status(404).send({ error: 'Patient encounter not found' });
    }

    // Create the recording entry
    const { data, error } = await supabase
      .from(recordingTableName)
      .insert({
        user_id: userId,
        patientEncounter_id: patientEncounter_id,
        recording_file_path: recording_file_path,
      })
      .select()
      .single();

    if (error) {
      console.error('[createRecording] Error creating recording:', error);
      return reply.status(500).send({ error: error.message });
    }

    console.log('[createRecording] Recording created successfully');
    return reply.status(201).send({
      status: 'success',
      data: data,
    });

  } catch (error) {
    console.error('Error in createRecording:', error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
}

/**
 * Get all recordings or single recording by ID
 * GET /api/recordings/:id (optional)
 */
export async function getRecordings(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const userId = user.id;
    const recordingId = request.params.id;

    // Single recording mode: Get by ID with signed URL generation
    if (recordingId) {
      // RLS policy ensures user can only access their own recordings
      const { data: recording, error } = await supabase
        .from(recordingTableName)
        .select('*')
        .eq('id', recordingId)
        .single();

      if (error || !recording) {
        return reply.status(404).send({ error: 'Recording not found' });
      }

      // Check if we need to generate a new signed URL
      const needNewSignedUrl = !recording.recording_file_signed_url || 
                               new Date(recording.recording_file_signed_url_expiry) < new Date();

      if (recording.recording_file_path && needNewSignedUrl) {
        // Normalize path: strip optional bucket prefix and any leading slash
        let normalizedPath = recording.recording_file_path;
        if (normalizedPath.startsWith('audio-files/')) {
          normalizedPath = normalizedPath.replace(/^audio-files\//, '');
        }
        if (normalizedPath.startsWith('/')) normalizedPath = normalizedPath.slice(1);

        const expirySeconds = 60 * 60; // 1 hour expiry

        const { data: signedUrlData, error: signedError } = await supabase.storage
          .from('audio-files')
          .createSignedUrl(normalizedPath, expirySeconds);

        if (signedError) {
          console.error('[getRecordings] Signed URL error:', signedError);
          return reply.status(500).send({ error: 'Failed to create signed URL' });
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + expirySeconds * 1000).toISOString();

        // Update the recording with the new signed URL and expiry
        const { data: updateData, error: updateError } = await supabase
          .from(recordingTableName)
          .update({
            recording_file_signed_url: signedUrlData.signedUrl,
            recording_file_signed_url_expiry: expiresAt
          })
          .eq('id', recording.id)
          .select()
          .single();

        if (updateError) {
          console.error('[getRecordings] Error updating signed URL:', updateError);
          return reply.status(500).send({ error: updateError.message });
        }

        return reply.status(200).send(updateData);
      }

      // Return existing data if signed URL is still valid
      return reply.status(200).send(recording);
    }

    // Batch mode: List all recordings for this user
    // RLS policy ensures user can only access their own recordings
    const { data, error } = await supabase
      .from(recordingTableName)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[getRecordings] Error fetching recordings:', error);
      return reply.status(500).send({ error: error.message });
    }

    return reply.status(200).send(data);
  } catch (error) {
    console.error('Error in getRecordings:', error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
}

/**
 * Delete a recording and its associated file
 * DELETE /api/recordings/:id
 */
export async function deleteRecording(request, reply) {
  try {
    const supabase = getSupabaseClient(request.headers.authorization);
    const user = request.user;

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const userId = user.id;
    const recordingId = request.params.id;

    if (!recordingId) {
      return reply.status(400).send({ error: 'Recording ID is required' });
    }

    // Fetch the recording to get the audio file path
    // RLS policy ensures user can only access their own recordings
    const { data: recording, error: fetchError } = await supabase
      .from(recordingTableName)
      .select('*')
      .eq('id', recordingId)
      .single();

    if (fetchError || !recording) {
      return reply.status(404).send({ error: 'Recording not found' });
    }

    // Delete the file from storage if it exists
    if (recording.recording_file_path) {
      let storagePath = recording.recording_file_path;
      
      // Normalize legacy paths
      if (storagePath.startsWith('audio-files/')) {
        storagePath = storagePath.replace(/^audio-files\//, '');
      }
      if (storagePath.startsWith('/')) storagePath = storagePath.slice(1);

      const { error: fileDeleteError } = await supabase.storage
        .from('audio-files')
        .remove([storagePath]);

      if (fileDeleteError) {
        console.error('[deleteRecording] Error deleting file:', fileDeleteError);
        // Don't fail if file deletion fails - the recording can still be deleted from DB
      }
    }

    // Delete the DB record
    const { data, error } = await supabase
      .from(recordingTableName)
      .delete()
      .eq('id', recordingId)
      .select()
      .single();

    if (error) {
      console.error('[deleteRecording] Error deleting recording:', error);
      return reply.status(500).send({ error: error.message });
    }

    return reply.status(200).send({ success: true, data });
  } catch (error) {
    console.error('Error in deleteRecording:', error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
}

/**
 * ⚠️ UPDATE DISABLED - No updatable fields in recording schema
 * PATCH /api/recordings/:id
 * 
 * REASON: Recording schema has no user-editable fields:
 *   - 'recording_file_path': Immutable (set at upload time)
 *   - 'recording_file_signed_url': Generated server-side, not user-updatable
 *   - 'recording_file_signed_url_expiry': Generated server-side, not user-updatable
 *   - 'iv' / 'encrypted_aes_key': Immutable (encryption details)
 * 
 * TO ENABLE: First decide which fields should be user-editable and update database schema.
 * Currently recording updates are not supported.
 */
// export async function updateRecording(request, reply) {
//   try {
//     const supabase = getSupabaseClient(request.headers.authorization);
//     const user = request.user;
//
//     if (!user) {
//       return reply.status(401).send({ error: 'Unauthorized' });
//     }
//
//     const userId = user.id;
//     const recordingId = request.params.id;
//
//     if (!recordingId) {
//       return reply.status(400).send({ error: 'Recording ID is required' });
//     }
//
//     const { name, recording_file_path } = request.body || {};
//     const updateFields = {};
//
//     if (name) updateFields.name = name;
//     if (recording_file_path) updateFields.recording_file_path = recording_file_path;
//
//     if (Object.keys(updateFields).length === 0) {
//       return reply.status(400).send({ error: 'No valid fields to update' });
//     }
//
//     // Update the recording
//     // RLS policy ensures user can only update their own recordings
//     const { data: updatedData, error } = await supabase
//       .from(recordingTableName)
//       .update(updateFields)
//       .eq('id', recordingId)
//       .select()
//       .single();
//
//     if (error || !updatedData) {
//       console.error('[updateRecording] Error updating recording:', error);
//       return reply.status(404).send({ error: 'Recording not found' });
//     }
//
//     return reply.status(200).send({ success: true, data: updatedData });
//   } catch (error) {
//     console.error('Error in updateRecording:', error);
//     return reply.status(500).send({ error: 'Internal server error' });
//   }
// }
