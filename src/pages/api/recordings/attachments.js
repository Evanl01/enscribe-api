import { getSupabaseClient } from '@/src/utils/supabase';
import { authenticateRequest } from '@/src/utils/authenticateRequest';
import * as encryptionUtils from '@/src/utils/encryptionUtils';

const recordingTableName = 'recordings';
const patientEncounterTableName = 'patientEncounters';

export default async function handler(req, res) {
    // Authenticate user
    const supabase = getSupabaseClient(req.headers.authorization);
    const { user, error: authError } = await authenticateRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    // Only allow GET method
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Parse query parameters
        const { attached, limit = 100, offset = 0, sortBy = 'name', order = 'asc' } = req.query;
        
        if (attached !== 'true' && attached !== 'false') {
            return res.status(400).json({ error: 'attached parameter is required and must be "true" or "false"' });
        }

        const attachedBool = attached === 'true';

        if (!['name', 'created_at', 'updated_at'].includes(sortBy)) {
            return res.status(400).json({ error: 'sortBy must be one of: name, created_at, updated_at' });
        }

        if (!['asc', 'desc'].includes(order)) {
            return res.status(400).json({ error: 'order must be one of: asc, desc' });
        }

        const userId = user.id;

        // Get all recordings for this user with patientEncounter join
        const { data: recordingsData, error: recordingsError } = await supabase
            .from(recordingTableName)
            .select(`
                *,
                patientEncounters:patientEncounter_id (*)
            `)
            .eq('user_id', userId)
            .order('recording_file_path', { ascending: true });

        if (recordingsError) {
            console.error('Error fetching recordings:', recordingsError);
            return res.status(500).json({ error: recordingsError.message });
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
                return res.status(500).json({ error: storageError.message });
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
                .slice(offset, offset + limit)
                .map(({ db_created_at, db_updated_at, ...recording }) => recording);

            return res.status(200).json(result);
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
            const paginatedUnattached = unattachedFiles.slice(offset, offset + limit);
            return res.status(200).json(paginatedUnattached);
        }

    } catch (error) {
        console.error('Error in recordings attachments handler:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
