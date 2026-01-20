import fs from 'fs';
import path from 'path';
import { getSupabaseClient } from '@/src/utils/supabase';
import { authenticateRequest } from '@/src/utils/authenticateRequest';

export default async function handler(req, res) {
  const supabase = getSupabaseClient(req.headers.authorization);
  const { user: user, error: authError } = await authenticateRequest(req);
  if (authError) return res.status(401).json({ error: authError });

  if (req.method == 'GET') {
    // Use env vars for key path and ID
    const keyId = process.env.PUBLIC_KEY_ID || 'default';
    const pubKeyPath = process.env.PUBLIC_KEY_PATH || 'keys/public.pem';
    const publicKey = process.env.RSA_PUBLIC_KEY;
    if (!publicKey) {
      return res.status(500).json({ error: 'Public key not configured' });
    }
    res.status(200).json({ publicKey });
    // const resolvedPath = path.resolve(process.cwd(), pubKeyPath);

    // try {
    //   const publicKey = fs.readFileSync(resolvedPath, 'utf8');
    //   res.status(200).json({ keyId, publicKey });
    // } catch (err) {
    //   res.status(500).json({ error: 'Public key not found' });
    // }
  }


  else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}