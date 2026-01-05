/**
 * GCP Cloud Run Transcription Helper
 * 
 * Low-level utility for Cloud Run communication
 * Handles signed URL validation and authenticated requests to transcription service
 */

import { google } from 'googleapis';
import { authenticateRequest } from './authenticateRequest.js';

const CLOUD_RUN_URL =
  process.env.CLOUD_RUN_TRANSCRIBE_URL ||
  'https://emscribe-transcriber-641824253036.us-central1.run.app/transcribe';

/**
 * Validate a signed URL by issuing a HEAD request
 * 
 * @private
 * @param {string} url - Signed URL to validate
 * @param {number} [timeoutMs=10000] - Timeout in milliseconds
 * @returns {Promise<boolean>} - True if URL is valid and accessible
 */
async function checkSignedUrlValid(url, timeoutMs = 10000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);
    return resp.ok;
  } catch (err) {
    return false;
  }
}

/**
 * Transcribe a recording using GCP Cloud Run
 * 
 * Validates the signed URL, authenticates with GCP service account,
 * and sends the recording URL to Cloud Run for transcription.
 * 
 * @param {Object} options - Options object
 * @param {string} options.recording_file_signed_url - Signed URL to the recording file (required)
 * @param {Object} [options.req] - Next.js or Fastify request object for authentication
 * @param {number} [options.timeoutMs=10000] - Timeout for signed URL validation
 * @returns {Promise<Object>} - Cloud Run response containing transcription data
 * @throws {Error} - If URL is invalid, authentication fails, or Cloud Run returns error
 */
export async function transcribe_recording({ recording_file_signed_url, req = null, timeoutMs = 10000 } = {}) {
  if (!recording_file_signed_url || typeof recording_file_signed_url !== 'string') {
    throw new Error('recording_file_signed_url is required');
  }

  // If caller provided a request, verify the user is authenticated
  if (req) {
    const { user, error: authError } = await authenticateRequest(req);
    if (authError || !user) {
      throw new Error('Authentication failed');
    }
  }

  // 0) Validate URL format (must start with http:// or https://)
  if (!recording_file_signed_url.startsWith('http://') && !recording_file_signed_url.startsWith('https://')) {
    const err = new Error(`Invalid or expired recording_file_signed_url: ${recording_file_signed_url}`);
    err.code = 'invalid_url_format';
    err.status = 400; // Client error - malformed URL
    throw err;
  }

  // 1) Verify signed URL is still valid (HEAD request, no download)
  const isValid = await checkSignedUrlValid(recording_file_signed_url, timeoutMs);
  if (!isValid) {
    const err = new Error(`Invalid or expired recording_file_signed_url: ${recording_file_signed_url}`);
    err.code = 'expired_signed_url';
    err.status = 400; // Client error - invalid/expired URL
    throw err;
  }
  console.log('Signed URL is valid:', recording_file_signed_url);

  // 2) Obtain ID token using service account credentials and call Cloud Run
  const auth = new google.auth.GoogleAuth({
    credentials: process.env.GCP_SERVICE_ACCOUNT_KEY
      ? JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY)
      : undefined,
    // DO NOT set scopes when you will call getIdTokenClient(audience)
  });
  const idClient = await auth.getIdTokenClient(CLOUD_RUN_URL);

  try {
    console.log('[transcribe_recording] Making request to Cloud Run...');
    const cloudRunResp = await idClient.request({
      url: CLOUD_RUN_URL,
      method: 'POST',
      data: { recording_file_signed_url },
      headers: { 'Content-Type': 'application/json' },
      timeout: 300000, // 5 minutes
    });

    if (!cloudRunResp?.data) {
      throw new Error('Cloud Run returned empty response body');
    }

    console.log('[transcribe_recording] Cloud Run response received successfully');
    return cloudRunResp.data;
  } catch (error) {
    console.error('[transcribe_recording] Cloud Run request failed:', error.message);

    if (error.message?.includes('aborted') || error.code === 'ECONNABORTED') {
      throw new Error('Transcription request timed out. Please try with a shorter audio file or check your network connection.');
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error('Unable to connect to transcription service. Please try again later.');
    }

    throw new Error(`Cloud Run service error: ${error.message}`);
  }
}
