/**
 * AWS PHI Masking Controller
 * 
 * Fastify request handlers for PHI masking/unmasking operations.
 * Uses AWS Comprehend Medical for PHI detection.
 */

import { mask_phi, unmask_phi } from '../../utils/maskPhiHelper.js';
import { authenticateRequest } from '../../utils/authenticateRequest.js';

/**
 * POST /api/aws/mask-phi
 * 
 * Masks PHI (Protected Health Information) in a medical transcript.
 * Replaces PHI with tokens in format {{TYPE_ID}}.
 * 
 * Requires authentication.
 * 
 * @param {Object} request - Fastify request object
 * @param {Object} reply - Fastify reply object
 */
export async function maskPhiHandler(request, reply) {
  try {
    // Authenticate user
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      return reply.status(401).send({ error: 'Authentication failed' });
    }

    const { text, maskThreshold = 0.15 } = request.body;

    // Mask PHI
    const result = await mask_phi(text, maskThreshold);
    
    console.log('[maskPhiHandler] Result tokens:', JSON.stringify(result.tokens).substring(0, 200));
    
    // Reformat response to match API schema
    return reply.status(200).send({
      maskedText: result.masked_transcript,
      entities: result.phi_entities,
      tokens: result.tokens,
    });
  } catch (error) {
    console.error('[maskPhiHandler] Error:', error);
    return reply.status(500).send({ error: error.message || 'Failed to mask PHI' });
  }
}

/**
 * POST /api/aws/unmask-phi
 * 
 * Unmasks PHI tokens ({{TYPE_ID}}) using provided entity data.
 * Restores original PHI text in the transcript.
 * 
 * Requires authentication.
 * 
 * @param {Object} request - Fastify request object
 * @param {Object} reply - Fastify reply object
 */
export async function unmaskPhiHandler(request, reply) {
  try {
    // Authenticate user
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      return reply.status(401).send({ error: 'Authentication failed' });
    }

    const { text, tokens = {} } = request.body;

    // Unmask PHI
    const result = unmask_phi(text, tokens);

    // Reformat response to match API schema
    return reply.status(200).send({
      unmaskedText: result.unmasked_transcript,
    });
  } catch (error) {
    console.error('[unmaskPhiHandler] Error:', error);
    return reply.status(500).send({ error: error.message || 'Failed to unmask PHI' });
  }
}

export { mask_phi, unmask_phi };
