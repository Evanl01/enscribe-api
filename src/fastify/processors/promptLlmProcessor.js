/**
 * Prompt LLM Processor
 * 
 * Async worker for SOAP note generation pipeline
 * - Transcription (GCP Cloud Run)
 * - PHI masking (AWS Comprehend Medical)
 * - SOAP note generation (OpenAI/Azure OpenAI)
 * - PHI unmasking
 * 
 * Called by jobController, runs in background
 * Updates job status in database at each step
 */

import { supabaseAdmin } from '../../utils/supabaseAdmin.js';
import { getSupabaseClient } from '../../utils/supabase.js';
import * as gptRequestBodies from '../../utils/gptRequestBodies.js';
import { unmask_phi } from '../../utils/maskPhiHelper.js';
import { transcribe_expand_mask } from '../controllers/transcribeController.js';
import { getAzureOpenAIConfig } from '../../utils/azureOpenaiConfig.js';
import parseSoapNotes from '../../utils/parseSoapNotes.js';
import { validateSoapAndBilling, detectAndNormalizeResponse } from '../../utils/soapNoteValidator.js';

/**
 * Helper: Clean raw text from LLMs to normalize problematic characters for EHR systems
 */
function cleanRawText(s) {
  if (!s || typeof s !== 'string') return s;
  s = s.replace(/\u2022|\u2023|\u25E6|\u2043/g, '-');
  s = s.replace(/[\u2026\u22EF\u22EE]/g, '...');
  s = s.replace(/\u00A0/g, ' ');
  s = s.replace(/–/g, '-');
  s = s.replace(/—/g, '-');
  s = s.replace(/≤/g, '<=');
  s = s.replace(/≥/g, '>=');
  s = s.replace(/×/g, 'x');
  s = s.replace(/±/g, '+/-');
  s = s.replace(/½/g, '1/2');
  s = s.replace(/⅓/g, '1/3');
  s = s.replace(/⅔/g, '2/3');
  s = s.replace(/¼/g, '1/4');
  s = s.replace(/¾/g, '3/4');
  s = s.replace(/⅕/g, '1/5');
  s = s.replace(/⅖/g, '2/5');
  s = s.replace(/⅗/g, '3/5');
  s = s.replace(/⅘/g, '4/5');
  s = s.replace(/⅙/g, '1/6');
  s = s.replace(/⅚/g, '5/6');
  s = s.replace(/⁰/g, '^0');
  s = s.replace(/¹/g, '^1');
  s = s.replace(/²/g, '^2');
  s = s.replace(/³/g, '^3');
  s = s.replace(/⁴/g, '^4');
  s = s.replace(/⁵/g, '^5');
  s = s.replace(/⁶/g, '^6');
  s = s.replace(/⁷/g, '^7');
  s = s.replace(/⁸/g, '^8');
  s = s.replace(/⁹/g, '^9');
  s = s.replace(/→/g, '->');
  s = s.replace(/←/g, '<-');
  s = s.replace(/↑/g, 'increase');
  s = s.replace(/↓/g, 'decrease');
  s = s.replace(/~/g, 'approximately');
  s = s.replace(/≈/g, '~');
  s = s.replace(/∞/g, 'infinity');
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  s = s.replace(/-{2,}/g, '-');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

/**
 * Helper: Update job status in database
 */
async function updateJobStatus(jobId, status, updates = {}) {
  const supabase = supabaseAdmin();
  const { error } = await supabase
    .from('jobs')
    .update({
      status,
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) {
    console.error(`[updateJobStatus] Failed to update job ${jobId}:`, error);
  }
}

/**
 * Helper: OpenAI API request
 */
async function gptAPIReq(reqBody) {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const openaiApiUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
  
  if (!openaiApiKey) {
    throw new Error('OpenAI API key not configured');
  }

  console.log(`[gptAPIReq] Using OpenAI model: ${reqBody.model}`);
  const response = await fetch(openaiApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify(reqBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${errorText}`);
  }

  const openaiData = await response.json();
  if (!openaiData.choices || !openaiData.choices[0]?.message) {
    throw new Error('Invalid response from OpenAI API');
  }

  return openaiData.choices[0].message.content;
}

/**
 * Helper: Azure OpenAI API request
 */
async function azureGptAPIReq(reqBody) {
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const azureApiKey = process.env.AZURE_OPENAI_KEY;
  
  if (!azureEndpoint || !azureApiKey) {
    throw new Error('Missing Azure OpenAI environment variables');
  }

  const { AzureOpenAI } = await import('openai');
  const azureConfig = getAzureOpenAIConfig();
  
  const client = new AzureOpenAI({
    apiVersion: azureConfig.apiVersion,
    apiKey: azureApiKey,
    baseURL: `${azureEndpoint}/openai/deployments/${azureConfig.deploymentName}`,
    defaultQuery: { 'api-version': azureConfig.apiVersion },
    defaultHeaders: { 'api-key': azureApiKey },
  });

  const response = await client.chat.completions.create({
    messages: reqBody.messages,
    model: azureConfig.deploymentName,
    max_completion_tokens: reqBody.max_completion_tokens || reqBody.max_tokens,
    temperature: reqBody.temperature,
    top_p: reqBody.top_p,
    response_format: reqBody.response_format,
  });

  if (!response.choices || !response.choices[0]?.message) {
    throw new Error('Invalid response from Azure OpenAI API');
  }

  return response.choices[0].message.content;
}

/**
 * Main async processor for SOAP note generation
 * 
 * @param {string} jobId - Job UUID
 * @param {string} userId - User UUID
 * @param {string} authorizationHeader - User's JWT token from initial request (e.g., 'Bearer ...')
 */
export async function promptLlmProcessor(jobId, userId, authorizationHeader) {
  const startTime = Date.now();
  console.log(`[promptLlmProcessor] Starting job ${jobId} for user ${userId}`);

  try {
    // Get job record to retrieve recording path
    const supabase = supabaseAdmin();
    const { data: job, error: getError } = await supabase
      .from('jobs')
      .select('recording_file_path')
      .eq('id', jobId)
      .single();

    if (getError || !job) {
      throw new Error(`Failed to retrieve job: ${getError?.message}`);
    }

    const { recording_file_path } = job;

    // Step 1: Update status to transcribing
    await updateJobStatus(jobId, 'transcribing');
    console.log(`[promptLlmProcessor] ${jobId}: Started transcription`);

    // Get signed URL for recording (use service key client for internal operations)
    const { data: signedUrlData, error: signedError } = await supabase.storage
      .from('audio-files')
      .createSignedUrl(recording_file_path, 60 * 60);

    if (signedError) {
      throw new Error(`Failed to create signed URL: ${signedError.message}`);
    }

    // Transcribe, expand, and mask
    let transcriptResult;
    const transcribeStartTime = Date.now();
    try {
      // Use the authorization header from job creation for authenticated access
      const internalRequest = {
        headers: {
          authorization: authorizationHeader,
        },
      };
      transcriptResult = await transcribe_expand_mask({
        recording_file_signed_url: signedUrlData.signedUrl,
        req: internalRequest,
      });
    } catch (error) {
      throw new Error(`Transcription failed: ${error?.message || 'Unknown error'}`);
    }

    // Validate transcription result
    if (
      !transcriptResult ||
      !transcriptResult.cloudRunData?.transcript ||
      !transcriptResult.maskResult?.masked_transcript ||
      !transcriptResult.maskResult?.phi_entities
    ) {
      throw new Error('Transcription result missing expected properties');
    }

    const transcript = transcriptResult.expandedTranscript;
    const maskedTranscript = transcriptResult.maskResult.masked_transcript;
    const tokens = transcriptResult.maskResult.tokens;
    const transcribeEndTime = Date.now();

    console.log(`[promptLlmProcessor] ${jobId}: Transcription complete (${(transcribeEndTime - transcribeStartTime) / 1000}s)`);

    // Step 2: Update status to generating with transcript
    await updateJobStatus(jobId, 'generating', {
      transcript_text: transcript,
    });

    // Step 3: Generate SOAP note and billing suggestion
    const soapNoteAndBillingReqBody = gptRequestBodies.getSoapNoteAndBillingRequestBody(maskedTranscript);
    let soapNoteAndBillingResultRaw;

    try {
      soapNoteAndBillingResultRaw = await gptAPIReq(soapNoteAndBillingReqBody);
    } catch (error) {
      throw new Error(`OpenAI API request failed: ${error.message}`);
    }

    if (!soapNoteAndBillingResultRaw) {
      throw new Error('Empty response from OpenAI API');
    }

    console.log(`[promptLlmProcessor] ${jobId}: OpenAI response received`);

    // Parse LLM response
    let rawString;
    if (typeof soapNoteAndBillingResultRaw === 'string') {
      rawString = soapNoteAndBillingResultRaw;
    } else {
      rawString = JSON.stringify(soapNoteAndBillingResultRaw);
    }

    // Validate format
    const looksLikeJson = rawString.trim().startsWith('{');
    const hasKeys = rawString.includes('soap_note') && rawString.includes('billing');
    if (!looksLikeJson || !hasKeys) {
      throw new Error('LLM response does not appear to be valid JSON structure');
    }

    // Clean and unmask
    rawString = cleanRawText(rawString);
    let unmaskRes;
    try {
      unmaskRes = unmask_phi(rawString, tokens);
    } catch (error) {
      throw new Error(`PHI unmasking failed: ${error.message}`);
    }

    const unmaskedString = (unmaskRes && typeof unmaskRes === 'object' && unmaskRes.unmasked_transcript)
      ? unmaskRes.unmasked_transcript
      : String(unmaskRes || rawString);

    // Parse JSON
    let soapNoteAndBillingResult;
    try {
      soapNoteAndBillingResult = JSON.parse(unmaskedString);
    } catch (error) {
      throw new Error(`Failed to parse SOAP note JSON: ${error.message}`);
    }

    // Detect and normalize response (handles both data and schema-wrapped formats)
    const { format, data, warning } = detectAndNormalizeResponse(soapNoteAndBillingResult);

    if (format === 'unknown') {
      throw new Error('Unrecognized response format. Expected SOAP note data or schema structure.');
    }

    if (warning) {
      console.warn(`[promptLlmProcessor] ${jobId}: ${warning} - Auto-normalizing`);
    }

    // Validate the normalized data
    validateSoapAndBilling(data);

    // Extract only required fields, removing any extra metadata (e.g., "type" wrapper field)
    const cleanData = {
      soap_note: data.soap_note,
      billing: data.billing,
    };

    // Store raw SOAP note string (parsing will be done on demand via parseSoapNotes utility)
    const soapNoteText = JSON.stringify(cleanData);

    // Step 4: Update to complete status
    const soapEndTime = Date.now();
    await updateJobStatus(jobId, 'complete', {
      soap_note_text: soapNoteText,
    });

    console.log(`[promptLlmProcessor] ${jobId}: Complete (${(soapEndTime - startTime) / 1000}s total)`);
  } catch (error) {
    console.error(`[promptLlmProcessor] ${jobId}: Error:`, error);
    await updateJobStatus(jobId, 'error', {
      error_message: error.message,
    });
  }
}
