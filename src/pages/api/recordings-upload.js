import { getSupabaseClient } from '@/src/utils/supabase';
import { authenticateRequest } from '@/src/utils/authenticateRequest';
import { recordingSchema } from '@/src/app/schemas';

const recordingTableName = 'recordings';

export const config = {
    api: {
        bodyParser: false, // Required for streaming/multipart (e.g., with busboy)
    },
};

export default async function handler(req, res) {
    const supabase = getSupabaseClient(req.headers.authorization);
    const { user, error: authError } = await authenticateRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    // POST: --------------------------------------------------------------------------------
    // POST: Upload a new recording with a unique name for this user, ACID: undo all if >1 file
    if (req.method === 'POST') {
        const busboy = require('busboy');

        // Wrap busboy handling in a Promise to prevent Next.js warning
        return new Promise((resolve, reject) => {
            const bb = busboy({ headers: req.headers });
            const allowedFields = ['name'];

            let fileError = null;
            let fileBuffer = null;
            let fileInfo = null;
            let fileCount = 0;
            let fields = {};
            let responseSet = false;

            bb.on('file', (fieldname, file, filename, encoding, mimetype) => {
                fileCount += 1;
                if (fileCount > 1) {
                    file.resume();
                    fileError = 'Only 1 file upload allowed per request.';
                    return;
                }

                // Extract actual filename if filename is an object
                const actualFilename = typeof filename === 'object' && filename !== null && 'filename' in filename
                    ? filename.filename
                    : filename;

                // Accept only mp3 files
                const allowedExts = ['mp3'];
                const ext = typeof actualFilename === 'string' && actualFilename.includes('.')
                    ? actualFilename.split('.').pop().toLowerCase()
                    : '';
                if (!allowedExts.includes(ext)) {
                    file.resume();
                    fileError = 'Only mp3 files are allowed.';
                    return;
                }

                // Collect file data into a buffer
                const chunks = [];
                file.on('data', (data) => chunks.push(data));
                file.on('end', () => {
                    fileBuffer = Buffer.concat(chunks);
                    fileInfo = { filename: actualFilename, mimetype, ext };
                });
                file.on('error', (err) => {
                    fileError = 'File upload error.';
                });
            });

            bb.on('field', (fieldname, val) => {
                if (allowedFields.includes(fieldname)) {
                    fields[fieldname] = val.trim();
                }
            });

            bb.on('finish', async () => {
                if (responseSet) {
                    return resolve();
                }

                try {
                    if (fileError) {
                        responseSet = true;
                        res.status(400).json({ error: fileError });
                        return resolve();
                    }

                    // Check for missing file
                    if (!fileBuffer || !fileInfo) {
                        responseSet = true;
                        res.status(400).json({ error: 'No file uploaded.' });
                        return resolve();
                    }

                    // Validate fields
                    const extraFields = Object.keys(fields).filter(f => !allowedFields.includes(f));
                    if (extraFields.length > 0) {
                        responseSet = true;
                        res.status(400).json({ error: `Unexpected field(s): ${extraFields.join(', ')}` });
                        return resolve();
                    }
                    if (!fields.name) {
                        responseSet = true;
                        res.status(400).json({ error: 'Name field is required.' });
                        return resolve();
                    }

                    // Check for unique name for this user
                    const { data: existing, error: nameCheckError } = await supabase
                        .from(recordingTableName)
                        .select('id')
                        .eq('user_id', user.id)
                        .eq('name', fields.name)
                        .maybeSingle();

                    if (nameCheckError) {
                        responseSet = true;
                        res.status(400).json({ error: nameCheckError.message });
                        return resolve();
                    }
                    if (existing) {
                        responseSet = true;
                        res.status(400).json({ error: 'A recording with this name already exists.' });
                        return resolve();
                    }

                    // Generate unique filename and a storage path relative to the bucket
                    const uniqueName = `${user.email}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}.${fileInfo.ext}`;
                    // store files under a folder for the user to avoid collisions and make downloads predictable
                    const filePath = `${user.id}/${uniqueName}`;

                    // Upload to Supabase Storage using the path relative to the bucket root
                    const { data: storageData, error: storageError } = await supabase.storage
                        .from('audio-files')
                        .upload(filePath, fileBuffer, {
                            contentType: fileInfo.mimetype,
                            upsert: false,
                        });

                    if (storageError) {
                        responseSet = true;
                        res.status(400).json({ error: storageError.message });
                        return resolve();
                    }

                    // Insert recording metadata into DB
                    const { data: dbData, error: dbError } = await supabase
                        .from(recordingTableName)
                        .insert([{
                            user_id: user.id,
                            name: fields.name,
                            audio_file_path: filePath,
                        }])
                        .select()
                        .single();

                    if (dbError) {
                        // Clean up uploaded file if DB insert fails
                        await supabase.storage.from('audio-files').remove([filePath]);
                        responseSet = true;
                        res.status(400).json({ error: dbError.message });
                        return resolve();
                    }

                    responseSet = true;
                    res.status(200).json({
                        success: true,
                        path: filePath,
                        data: dbData,
                    });
                    return resolve();

                } catch (error) {
                    if (!responseSet) {
                        responseSet = true;
                        res.status(500).json({ error: 'Internal server error.' });
                    }
                    return resolve();
                }
            });

            bb.on('error', (err) => {
                if (!responseSet) {
                    responseSet = true;
                    res.status(500).json({ error: 'File upload error.' });
                }
                return reject(err);
            });

            // Add timeout to prevent hanging requests
            const timeout = setTimeout(() => {
                if (!responseSet) {
                    responseSet = true;
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Request timeout.' });
                    }
                    resolve();
                }
            }, 30000);

            // Clear timeout when response is sent
            res.on('finish', () => {
                clearTimeout(timeout);
            });

            req.on('error', (err) => {
                if (!responseSet) {
                    responseSet = true;
                    clearTimeout(timeout);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Request error.' });
                    }
                }
                reject(err);
            });

            req.pipe(bb);
        });
    }
}