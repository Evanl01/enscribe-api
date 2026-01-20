import { getSupabaseClient } from '@/src/utils/supabase';
import { authenticateRequest } from '@/src/utils/authenticateRequest';
import { dotPhraseSchema } from '@/src/app/schemas';
import * as encryptionUtils from '@/src/utils/encryptionUtils';
import { z } from 'zod';

const dotPhrasesTable = 'dotPhrases';

/**
 * Generates a new AES key and encrypts it with RSA for storage.
 * Returns the encrypted AES key as base64 string.
 */
function generateEncryptedAESKey() {
  try {
    // Use shared utility to generate AES key
    const { aesKey } = encryptionUtils.generateAESKeyAndIV();
    // Use shared utility to encrypt it with RSA public key
    const encryptedAESKey = encryptionUtils.encryptAESKey(aesKey);
    return encryptedAESKey;
  } catch (err) {
    console.error('Failed to generate encrypted AES key:', err);
    throw new Error('Failed to generate encryption key');
  }
}

/**
 * Encrypts trigger and expansion fields for a dotPhrase object.
 * Generates a new AES key and IV for this specific dot phrase.
 * Returns { success, error, dotPhrase }.
 * @param {object} dotPhrase - DotPhrase object containing trigger and expansion.
 */
async function encryptDotPhraseFields(dotPhrase) {
  try {
    // Generate a fresh encrypted AES key for this dot phrase
    const encryptedAESKey = generateEncryptedAESKey();
    dotPhrase.encrypted_aes_key = encryptedAESKey;
    
    // Generate a single IV for both fields using shared utility
    const ivBase64 = encryptionUtils.generateRandomIVBase64();
    dotPhrase.iv = ivBase64;
    
    // Decrypt the AES key for encryption operations
    const aesKey = encryptionUtils.decryptAESKey(encryptedAESKey);
    const aesKeyBase64 = Buffer.isBuffer(aesKey) ? aesKey.toString('base64') : aesKey;
    
    // Encrypt trigger field using the same IV
    if (dotPhrase.trigger) {
      try {
        dotPhrase.encrypted_trigger = encryptionUtils.encryptText(dotPhrase.trigger, aesKeyBase64, ivBase64);
        delete dotPhrase.trigger; // Remove plain text
      } catch (err) {
        console.error('Failed to encrypt trigger:', err);
        return { success: false, error: 'Failed to encrypt trigger', dotPhrase: null };
      }
    }
    
    // Encrypt expansion field using the same IV
    if (dotPhrase.expansion) {
      try {
        dotPhrase.encrypted_expansion = encryptionUtils.encryptText(dotPhrase.expansion, aesKeyBase64, ivBase64);
        delete dotPhrase.expansion; // Remove plain text
      } catch (err) {
        console.error('Failed to encrypt expansion:', err);
        return { success: false, error: 'Failed to encrypt expansion', dotPhrase: null };
      }
    }
    
    return { success: true, error: null, dotPhrase };
  } catch (err) {
    console.error('Failed to encrypt dot phrase fields:', err);
    return { success: false, error: 'Failed to encrypt fields', dotPhrase: null };
  }
}

/**
 * Decrypts trigger and expansion fields for a dotPhrase object.
 * Returns { success, error, dotPhrase }.
 * @param {object} dotPhrase - DotPhrase object containing encrypted fields.
 */
async function decryptDotPhraseFields(dotPhrase) {
  try {
    if (!dotPhrase.encrypted_aes_key || !dotPhrase.iv) {
      return { success: false, error: 'Missing encryption key or IV for dot phrase', dotPhrase: null };
    }

    // Decrypt the AES key for decryption operations
    const aesKey = encryptionUtils.decryptAESKey(dotPhrase.encrypted_aes_key);
    
    // Decrypt trigger field using the stored IV
    if (dotPhrase.encrypted_trigger) {
      try {
        dotPhrase.trigger = encryptionUtils.decryptText(dotPhrase.encrypted_trigger, aesKey, dotPhrase.iv);
      } catch (err) {
        console.error('Failed to decrypt trigger:', err);
        return { success: false, error: 'Failed to decrypt trigger', dotPhrase: null };
      }
    }
    
    // Decrypt expansion field using the same stored IV
    if (dotPhrase.encrypted_expansion) {
      try {
        dotPhrase.expansion = encryptionUtils.decryptText(dotPhrase.encrypted_expansion, aesKey, dotPhrase.iv);
      } catch (err) {
        console.error('Failed to decrypt expansion:', err);
        return { success: false, error: 'Failed to decrypt expansion', dotPhrase: null };
      }
    }
    
    // Clean up encrypted fields from response
    delete dotPhrase.encrypted_trigger;
    delete dotPhrase.encrypted_expansion;
    delete dotPhrase.encrypted_aes_key;
    delete dotPhrase.iv;
    
    return { success: true, error: null, dotPhrase };
  } catch (err) {
    console.error('Failed to decrypt dot phrase fields:', err);
    return { success: false, error: 'Failed to decrypt fields', dotPhrase: null };
  }
}

/**
 * Gets all dot phrases for a specific user with decryption.
 * This function can be called from other modules (like prompt-llm).
 * @param {string} userId - The user ID to get dot phrases for.
 * @param {object} supabaseClient - Optional Supabase client instance.
 * @returns {Promise<{success: boolean, data: Array, error: string|null}>}
 */
export async function getAllDotPhrasesForUser(userId, supabaseClient = null) {
  try {
    // Require supabase client
    if (!supabaseClient) {
      console.error('[getAllDotPhrasesForUser] No supabase client provided');
      return { success: false, data: [], error: 'Supabase client is required' };
    }
    
    console.log(`[getAllDotPhrasesForUser] Fetching dot phrases for user: ${userId}`);
    
    // Get all dot phrases for the user
    const { data, error } = await supabaseClient
      .from(dotPhrasesTable)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[getAllDotPhrasesForUser] Database error:', error);
      return { success: false, data: [], error: error.message };
    }

    if (!data || data.length === 0) {
      console.log('[getAllDotPhrasesForUser] No dot phrases found for user');
      return { success: true, data: [], error: null };
    }

    console.log(`[getAllDotPhrasesForUser] Found ${data.length} dot phrases, decrypting...`);

    // Decrypt all dot phrases
    const decryptedDotPhrases = [];
    for (const dotPhrase of data) {
      if (dotPhrase.encrypted_trigger || dotPhrase.encrypted_expansion) {
        const decryptResult = await decryptDotPhraseFields(dotPhrase);
        if (decryptResult.success) {
          decryptedDotPhrases.push(dotPhrase);
        } else {
          console.error(`[getAllDotPhrasesForUser] Failed to decrypt dot phrase ${dotPhrase.id}:`, decryptResult.error);
          // Still include the record but without decrypted fields
          decryptedDotPhrases.push(dotPhrase);
        }
      } else {
        // No encryption, add as-is
        decryptedDotPhrases.push(dotPhrase);
      }
    }

    console.log(`[getAllDotPhrasesForUser] Successfully processed ${decryptedDotPhrases.length} dot phrases`);
    return { success: true, data: decryptedDotPhrases, error: null };

  } catch (err) {
    console.error('[getAllDotPhrasesForUser] Unexpected error:', err);
    return { success: false, data: [], error: 'Failed to fetch dot phrases' };
  }
}

export default async function handler(req, res) {
    const supabase = getSupabaseClient(req.headers.authorization);
    // Authenticate user for all methods
    const { user, error: authError } = await authenticateRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    // GET ---------------------------------------------------------
    if (req.method === 'GET') {
        const id = req.query.id;

        if (id) {
            // Get a single dot phrase by ID
            const { data, error } = await supabase
                .from(dotPhrasesTable)
                .select('*')
                .eq('id', id)
                .eq('user_id', user.id)
                .single();

            if (error) return res.status(500).json({ error: error.message });

            if (!data) {
                return res.status(404).json({ error: 'Dot phrase not found' });
            }

            // Decrypt fields before sending to frontend
            if (data.encrypted_trigger || data.encrypted_expansion) {
                const decryptResult = await decryptDotPhraseFields(data);
                if (!decryptResult.success) {
                    return res.status(400).json({ error: decryptResult.error });
                }
            }

            return res.status(200).json(data);
        } else {
            // Get all dot phrases for the user using the shared function
            const result = await getAllDotPhrasesForUser(user.id, supabase);
            
            if (!result.success) {
                return res.status(500).json({ error: result.error });
            }

            return res.status(200).json(result.data);
        }
    }

    // POST -------------------------------------------------------
    if (req.method === 'POST') {
        const { trigger, expansion } = req.body;

        if (!trigger || !expansion) {
            return res.status(400).json({ error: 'trigger and expansion are required' });
        }

        const dotPhrase = {
            trigger,
            expansion,
            user_id: user.id
        };
        console.log('[POST] Creating dotPhrase:', dotPhrase);

        // Encrypt the fields
        const encryptionResult = await encryptDotPhraseFields(dotPhrase);
        if (!encryptionResult.success) {
            return res.status(400).json({ error: encryptionResult.error });
        }

        const { data: insertData, error: insertError } = await supabase
            .from(dotPhrasesTable)
            .insert([dotPhrase])
            .select()
            .single();

        if (insertError) return res.status(500).json({ error: insertError.message });

        return res.status(201).json(insertData);
    }

    // PATCH -----------------------------------------------------------------------------------------
    if (req.method === 'PATCH') {
        const parseResult = dotPhraseSchema.partial().safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: parseResult.error });
        }
        const dotPhrase = parseResult.data;
        console.log('[PATCH] Received body:', req.body);
        console.log('[PATCH] Parsed dotPhrase:', dotPhrase);
        
        dotPhrase.user_id = user.id; // Ensure user_id is set to the authenticated user's ID
        if (!dotPhrase.id) {
            return res.status(400).json({ error: 'id is required for update' });
        }

        // Check if trigger or expansion are being updated (from request body, not parsed schema)
        if (req.body.trigger !== undefined || req.body.expansion !== undefined) {
            // Set the raw values from request body directly since they won't be in parsed schema
            if (req.body.trigger !== undefined) dotPhrase.trigger = req.body.trigger;
            if (req.body.expansion !== undefined) dotPhrase.expansion = req.body.expansion;
            
            console.log('[PATCH] About to encrypt fields:', { 
                trigger: dotPhrase.trigger, 
                expansion: dotPhrase.expansion 
            });
            
            const encryptionResult = await encryptDotPhraseFields(dotPhrase);
            if (!encryptionResult.success) {
                return res.status(400).json({ error: encryptionResult.error });
            }
            
            console.log('[PATCH] Encryption successful, encrypted fields added');
        }

        console.log('[PATCH] Final dotPhrase before update:', dotPhrase);

        const { data: updatedData, error: updateError } = await supabase
            .from(dotPhrasesTable)
            .update(dotPhrase)
            .eq('id', dotPhrase.id)
            .eq('user_id', user.id) // Ensure only the owner can update
            .select()
            .single();

        if (updateError) {
            console.error('[PATCH] Update error:', updateError);
            return res.status(500).json({ error: updateError.message });
        }

        if (!updatedData) {
            return res.status(404).json({ error: 'Dot phrase not found or not authorized to update' });
        }

        console.log('[PATCH] Update successful:', updatedData);
        return res.status(200).json(updatedData);
    }

    // DELETE ------------------------------------------------------------------------
    if (req.method === 'DELETE') {
        const id = req.query.id;
        if (!id) return res.status(400).json({ error: 'Dot phrase ID is required' });

        const { data, error } = await supabase
            .from(dotPhrasesTable)
            .delete()
            .eq('id', id)
            .eq('user_id', user.id) // Ensure only the owner can delete
            .select()
            .single();

        if (error) return res.status(500).json({ error: error.message });

        if (!data) {
            return res.status(404).json({ error: 'Dot phrase not found or not authorized to delete' });
        }

        return res.status(200).json({ success: true, data });
    }

    res.status(405).json({ error: 'Method not allowed' });
}
