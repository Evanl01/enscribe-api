import { getSupabaseClient } from '@/src/utils/supabase';

import { authenticateRequest } from '@/src/utils/authenticateRequest';
import { recordingSchema } from '@/src/app/schemas';
const recordingTableName = 'recordings';

export default async function handler(req, res) {
    const supabase = getSupabaseClient(req.headers.authorization);
    // Authenticate user for all methods
    const { user, error: authError } = await authenticateRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    // GET: ------------------------------------------------------------------------------
    // GET: List all audio files for this user (batch) or single recording by ID
    if (req.method === 'GET') {
        const id = req.query.id; // Optional ID for filtering
        
        if (!id) {
            // Batch mode: List all recordings for this user
            const { data, error } = await supabase
                .from(recordingTableName)
                .select('*') // Select all fields
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });
            
            if (error) return res.status(500).json({ error: error.message });
            return res.status(200).json(data);
        }
        
        // Single recording mode: Get specific recording by ID
        const { data, error } = await supabase
            .from(recordingTableName)
            .select('*') // Select all fields
            .eq('id', id)
            .eq('user_id', user.id) // Ensure user can only access their own recordings
            .single(); // Use single() since we're querying by ID
        
        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'Recording not found' });

        // Check if we need to generate a new signed URL
        const needNewSignedUrl = !data.recording_file_signed_url || 
                                 new Date(data.recording_file_signed_url_expiry) < new Date();
        
        console.log('Generating signed URL for recording:', data.id, 'needNewSignedUrl:', needNewSignedUrl);
        
        if (data.recording_file_path && needNewSignedUrl) {
            // Normalize path: strip optional bucket prefix and any leading slash
            let normalizedPath = data.recording_file_path;
            if (normalizedPath.startsWith('audio-files/')) {
                normalizedPath = normalizedPath.replace(/^audio-files\//, '');
            }
            if (normalizedPath.startsWith('/')) normalizedPath = normalizedPath.slice(1);
            
            console.log('Creating signed URL for recording file:', normalizedPath);
            const expirySeconds = 60 * 60; // 1 hour expiry

            const { data: signedUrlData, error: signedError } = await supabase.storage
                .from('audio-files')
                .createSignedUrl(normalizedPath, expirySeconds);
                
            if (signedError) {
                console.error('Signed URL error:', signedError);
                return res.status(500).json({ error: 'Failed to create signed URL: ' + signedError.message });
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
                .eq('id', data.id)
                .select()
                .single();
                
            if (updateError) {
                console.error('Error updating recording signed URL:', updateError.message);
                return res.status(500).json({ error: updateError.message });
            }
            
            // Return the updated data with new signed URL
            return res.status(200).json(updateData);
        }
        
        // Return existing data if signed URL is still valid
        return res.status(200).json(data);
    }


    // DELETE ------------------------------------------------------------------------
    if (req.method === 'DELETE') {
        // Fetch the recording to get the audio file path
        const id = req.query.id; // ID of the recording to delete
        if (!id) return res.status(400).json({ error: 'Recording ID is required' });
        const { data: recording, error: fetchError } = await supabase
            .from(recordingTableName)
            .select('*')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();
        if (fetchError || !recording) {
            return res.status(404).json({ error: 'Recording not found.' });
        }

        // Delete the file from the bucket
        let storagePath = recording.audio_file_path;
        if (!storagePath) {
            return res.status(400).json({ error: 'No audio file associated with this recording.' });
        }
        // Normalize legacy paths that accidentally stored the bucket prefix
        storagePath = storagePath.replace(/^\/|^\/.*/, (s) => s); // noop safe guard
        if (storagePath.startsWith('audio-files/')) {
            storagePath = storagePath.replace(/^audio-files\//, ''); // Remove the prefix for deletion
        }
        // Ensure no leading slash
        if (storagePath.startsWith('/')) storagePath = storagePath.slice(1);
        const { error: fileDeleteError } = await supabase.storage
            .from('audio-files')
            .remove([storagePath]);
        if (fileDeleteError) {
            return res.status(500).json({ error: fileDeleteError.message });
        }

        // Delete the DB record
        const { data, error } = await supabase
            .from(recordingTableName)
            .delete()
            .eq('id', id)
            .select()
            .single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true, data });
    }


    // PATCH: --------------------------------------------------------------------------------
    // PATCH: Rename an existing file (expects id and name in body)
    if (req.method === 'PATCH') {
        // console.log(req.body);

        const parseResult = recordingSchema.partial().safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: parseResult.error });
        }
        const recording = parseResult.data;

        if (!recording.id) {
            return res.status(400).json({ error: 'Recording ID is required' });
        }
        const updateFields = {};
        if (recording.name) updateFields.name = recording.name;
    if (recording.audio_file_path) updateFields.audio_file_path = recording.audio_file_path;
        // Add other fields as needed

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        console.log('Recording (PATCH):', recording);
        console.log('User ID:', user.id);
        // Fetch current file path from DB
        const { data: updatedData, error: fetchError } = await supabase
            .from(recordingTableName)
            .update(updateFields)
            .eq('id', recording.id)
            .eq('user_id', user.id)
            .select()
            .single();
        if (fetchError || !updatedData) {
            return res.status(404).json({ error: fetchError || 'Recording not found' });
        }
        return res.status(200).json({ success: true, data: updatedData });
    }



    res.status(405).json({ error: 'Method not allowed' });
}