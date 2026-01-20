import { getSupabaseClient } from '@/src/utils/supabase';
import { authenticateRequest } from '@/src/utils/authenticateRequest';
import { recordingSchema } from '@/src/app/schemas';

const recordingTableName = 'recordings';

export default async function handler(req, res) {
    // Authenticate user for all methods
    const supabase = getSupabaseClient(req.headers.authorization);

    const { user, error: authError } = await authenticateRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    // GET: ------------------------------------------------------------------------------
    // GET: List all audio files for this user
    if (req.method === 'GET') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'Recording ID is required' });
        // Validate ownership before fetching
        
        const { data, error } = await supabase //Only fetch recordings for the authenticated user
            .from(recordingTableName)
            .select('*') // Select all fields
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
    }

    switch (req.method) {
        case 'GET':
            return handleGetRequest(req, res, user);
        default:
            return res.status(405).json({ error: 'Method not allowed' });
    }
}

