import { z } from 'zod';
import * as encryptionUtils from '../../utils/encryptionUtils.js';
import { dotPhraseSchema } from '../schemas/dotPhrase.js';

const dotPhrasesTable = 'dotPhrases';

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

/**
 * Gets a single dot phrase by ID for the authenticated user
 */
export async function getOneDotPhrase(userId, dotPhraseId, supabase) {
  try {
    if (!isValidBigInt(dotPhraseId)) {
      return { success: false, error: 'Invalid dot phrase ID format', data: null };
    }

    const { data, error } = await supabase
      .from(dotPhrasesTable)
      .select('*')
      .eq('id', dotPhraseId)
      .eq('user_id', userId)
      .single();

    if (error) {
      return { success: false, error: error.message, data: null };
    }

    if (!data) {
      return { success: false, error: 'Dot phrase not found', data: null };
    }

    // Decrypt fields before returning
    if (data.encrypted_trigger || data.encrypted_expansion) {
      const decryptResult = await decryptDotPhraseFields(data);
      if (!decryptResult.success) {
        return { success: false, error: decryptResult.error, data: null };
      }
    }

    return { success: true, error: null, data };
  } catch (err) {
    console.error('Error fetching single dot phrase:', err);
    return { success: false, error: err.message, data: null };
  }
}

/**
 * Creates a new dot phrase for the authenticated user
 */
export async function createDotPhrase(userId, trigger, expansion, supabase) {
  try {
    if (!trigger || !expansion) {
      return { success: false, error: 'trigger and expansion are required', data: null };
    }

    const dotPhrase = {
      trigger,
      expansion,
      user_id: userId,
    };

    console.log('[createDotPhrase] Creating dotPhrase:', dotPhrase);

    // Encrypt the fields
    const encryptionResult = await encryptDotPhraseFields(dotPhrase);
    if (!encryptionResult.success) {
      return { success: false, error: encryptionResult.error, data: null };
    }

    const { data: insertData, error: insertError } = await supabase
      .from(dotPhrasesTable)
      .insert([dotPhrase])
      .select()
      .single();

    if (insertError) {
      return { success: false, error: insertError.message, data: null };
    }

    return { success: true, error: null, data: insertData };
  } catch (err) {
    console.error('Error creating dot phrase:', err);
    return { success: false, error: err.message, data: null };
  }
}

/**
 * Updates an existing dot phrase for the authenticated user
 */
export async function updateDotPhrase(userId, dotPhraseId, updateData, supabase) {
  try {
    if (!isValidBigInt(dotPhraseId)) {
      return { success: false, error: 'Invalid dot phrase ID format', data: null };
    }

    // updateData is already validated by route, no need to validate again
    const dotPhrase = updateData;
    dotPhrase.id = dotPhraseId;
    dotPhrase.user_id = userId; // Ensure user_id is set to the authenticated user's ID

    console.log('[updateDotPhrase] Received body:', updateData);
    console.log('[updateDotPhrase] Parsed dotPhrase:', dotPhrase);

    // Check if trigger or expansion are being updated
    if (updateData.trigger !== undefined || updateData.expansion !== undefined) {
      // Set the raw values from request body directly
      if (updateData.trigger !== undefined) dotPhrase.trigger = updateData.trigger;
      if (updateData.expansion !== undefined) dotPhrase.expansion = updateData.expansion;

      console.log('[updateDotPhrase] About to encrypt fields:', {
        trigger: dotPhrase.trigger,
        expansion: dotPhrase.expansion,
      });

      const encryptionResult = await encryptDotPhraseFields(dotPhrase);
      if (!encryptionResult.success) {
        return { success: false, error: encryptionResult.error, data: null };
      }

      console.log('[updateDotPhrase] Encryption successful, encrypted fields added');
    }

    console.log('[updateDotPhrase] Final dotPhrase before update:', dotPhrase);

    const { data: updatedData, error: updateError } = await supabase
      .from(dotPhrasesTable)
      .update(dotPhrase)
      .eq('id', dotPhraseId)
      .eq('user_id', userId) // Ensure only the owner can update
      .select()
      .single();

    if (updateError) {
      console.error('[updateDotPhrase] Update error:', updateError);
      return { success: false, error: updateError.message, data: null };
    }

    if (!updatedData) {
      return { success: false, error: 'Dot phrase not found or not authorized to update', data: null };
    }

    console.log('[updateDotPhrase] Update successful:', updatedData);
    return { success: true, error: null, data: updatedData };
  } catch (err) {
    console.error('Error updating dot phrase:', err);
    return { success: false, error: err.message, data: null };
  }
}

/**
 * Deletes a dot phrase for the authenticated user
 */
export async function deleteDotPhrase(userId, dotPhraseId, supabase) {
  try {
    if (!isValidBigInt(dotPhraseId)) {
      return { success: false, error: 'Invalid dot phrase ID format', data: null };
    }

    const { data, error } = await supabase
      .from(dotPhrasesTable)
      .delete()
      .eq('id', dotPhraseId)
      .eq('user_id', userId) // Ensure only the owner can delete
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message, data: null };
    }

    if (!data) {
      return { success: false, error: 'Dot phrase not found or not authorized to delete', data: null };
    }

    return { success: true, error: null, data };
  } catch (err) {
    console.error('Error deleting dot phrase:', err);
    return { success: false, error: err.message, data: null };
  }
}
