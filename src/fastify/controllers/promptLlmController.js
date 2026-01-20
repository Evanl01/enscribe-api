/**
 * OpenAI SOAP Note Generation Controller
 * 
 * Fastify handler for the complete SOAP note generation pipeline:
 * - Audio transcription via Cloud Run (GCP)
 * - Dot phrase expansion
 * - PHI masking (AWS)
 * - SOAP note and billing generation (OpenAI)
 * - PHI unmasking
 * 
 * Uses Server-Sent Events (SSE) for real-time progress streaming.
 */

import { getSupabaseClient } from '../../utils/supabase.js';
import { authenticateRequest } from '../../utils/authenticateRequest.js';
import * as gptRequestBodies from '../../utils/gptRequestBodies.js';
import { unmask_phi } from '../../utils/maskPhiHelper.js';
import { transcribe_expand_mask } from './transcribeController.js';
import { getAzureOpenAIConfig } from '../../utils/azureOpenaiConfig.js';

/**
 * Helper: Clean raw text from LLMs to normalize problematic characters for EHR systems
 */
function cleanRawText(s) {
    if (!s || typeof s !== 'string') return s;
    // Replace common bullet characters with a dash
    s = s.replace(/\u2022|\u2023|\u25E6|\u2043/g, '-');
    // Replace various ellipsis and similar with standard ellipsis
    s = s.replace(/[\u2026\u22EF\u22EE]/g, '...');
    // Normalize non-breaking spaces to regular space
    s = s.replace(/\u00A0/g, ' ');
    // Replace en-dash (–) with hyphen-minus (-)
    s = s.replace(/–/g, '-');
    // Replace em-dash (—) with hyphen-minus (-)
    s = s.replace(/—/g, '-');
    // Replace comparison operators with text equivalents
    s = s.replace(/≤/g, '<=');
    s = s.replace(/≥/g, '>=');
    // Replace multiplication symbol (×) with standard x
    s = s.replace(/×/g, 'x');
    // Replace common fractions with text equivalents
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
    // Replace superscript numbers with power notation (e.g., 2² → 2^2)
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
    // Replace arrows with text equivalents
    s = s.replace(/→/g, '->');
    s = s.replace(/←/g, '<-');
    s = s.replace(/↑/g, 'increase');
    s = s.replace(/↓/g, 'decrease');
    // Replace tilde (~) with "approximately"
    s = s.replace(/~/g, 'approximately');
    // Replace approximate equals (≈) with tilde (~)
    s = s.replace(/≈/g, '~');
    // Replace infinity symbol (∞) with "infinity"
    s = s.replace(/∞/g, 'infinity');
    // Remove control characters except common whitespace (tab, newline, carriage)
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    // Collapse multiple consecutive hyphens to a single one
    s = s.replace(/-{2,}/g, '-');
    // Trim excessive whitespace
    s = s.replace(/\s{2,}/g, ' ').trim();
    return s;
}

/**
 * Basic runtime validator for the expected soap_and_billing JSON schema.
 */
function validateSoapAndBilling(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('Response is not an object');
    if (!obj.soap_note || typeof obj.soap_note !== 'object') throw new Error('Missing soap_note object');
    if (!obj.billing || typeof obj.billing !== 'object') throw new Error('Missing billing object');

    const s = obj.soap_note;
    if (!s.subjective || typeof s.subjective !== 'object') throw new Error('Missing subjective object');
    if (!s.objective || typeof s.objective !== 'object') throw new Error('Missing objective object');
    if (typeof s.assessment !== 'string') throw new Error('assessment must be a string');
    if (typeof s.plan !== 'string') throw new Error('plan must be a string');

    // Check subjective required keys
    const subjReq = ["Chief complaint", "HPI", "History", "ROS", "Medications", "Allergies"];
    for (const k of subjReq) {
        if (!(k in s.subjective)) throw new Error(`subjective missing required key: ${k}`);
        if (typeof s.subjective[k] !== 'string') throw new Error(`subjective.${k} must be a string`);
    }

    // Objective required keys
    const objReq = ["HEENT", "General", "Cardiovascular", "Musculoskeletal", "Other"];
    for (const k of objReq) {
        if (!(k in s.objective)) throw new Error(`objective missing required key: ${k}`);
        if (typeof s.objective[k] !== 'string') throw new Error(`objective.${k} must be a string`);
    }

    // Billing checks
    const b = obj.billing;
    if (!Array.isArray(b.icd10_codes)) throw new Error('billing.icd10_codes must be an array');
    // if (b.icd10_codes.length < 1) throw new Error('billing.icd10_codes must contain at least one code');
    if (typeof b.billing_code !== 'string') throw new Error('billing.billing_code must be a string');
    if (typeof b.additional_inquiries !== 'string') throw new Error('billing.additional_inquiries must be a string');

    // Limit check
    if (b.icd10_codes.length > 10) throw new Error('billing.icd10_codes has too many entries');

    return true;
}

/**
 * Handle OpenAI GPT API request for SOAP note generation
 */
async function gptAPIReq(reqBody) {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const openaiApiUrl = process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
    if (!openaiApiKey) {
        throw new Error('OpenAI API key not configured');
    }

    console.log(`[gptAPIReq] Using OpenAI model: ${reqBody.model}`);
    console.log(`[gptAPIReq] API URL: ${openaiApiUrl}`);
    console.log(`[gptAPIReq] Making request to OpenAI...`);

    const response = await fetch(openaiApiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify(reqBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${errorText}`);
    }

    const openaiData = await response.json();

    if (!openaiData.choices || !openaiData.choices[0]?.message) {
        throw new Error('Invalid response from OpenAI API');
    }

    // Log token usage
    if (openaiData.usage) {
        console.log(`[gptAPIReq] Prompt tokens: ${openaiData.usage.prompt_tokens}`);
        console.log(`[gptAPIReq] Completion tokens: ${openaiData.usage.completion_tokens}`);
        console.log(`[gptAPIReq] Total tokens: ${openaiData.usage.total_tokens}`);
    }

    console.log('[gptAPIReq] Successfully received response from OpenAI');
    // Return the content of the first message
    return openaiData.choices[0].message.content;
}

/**
 * Handle Azure OpenAI GPT API request for SOAP note generation
 * 
 * Uses Azure OpenAI SDK with endpoint and api-key authentication.
 * Falls back to OpenAI if Azure credentials are not configured.
 * 
 * @param {Object} reqBody - Request body with messages, model, etc.
 * @returns {Promise<string>} - LLM response content
 * @throws {Error} - If API call fails
 */
async function azureGptAPIReq(reqBody) {
    // Check if Azure OpenAI is configured
    const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const azureApiKey = process.env.AZURE_OPENAI_KEY;
    
    if (!azureEndpoint || !azureApiKey) {
        throw new Error('Missing Azure OpenAI environment variables. Configure AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY to use Azure OpenAI.');
    }

    try {
        // Dynamically import AzureOpenAI to avoid hard dependency
        const { AzureOpenAI } = await import('openai');
        
        // Get Azure config from environment
        const azureConfig = getAzureOpenAIConfig();
        
        console.log(`[azureGptAPIReq] Using Azure deployment: ${azureConfig.deploymentName}`);
        
        // Initialize Azure OpenAI client
        const client = new AzureOpenAI({
            apiVersion: azureConfig.apiVersion,
            apiKey: azureApiKey,
            baseURL: `${azureEndpoint}/openai/deployments/${azureConfig.deploymentName}`,
            defaultQuery: { 'api-version': azureConfig.apiVersion },
            defaultHeaders: { 'api-key': azureApiKey },
        });

        console.log(`[azureGptAPIReq] Making request to Azure OpenAI...`);

        // Make the chat completion request
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

        // Log token usage
        if (response.usage) {
            console.log(`[azureGptAPIReq] Prompt tokens: ${response.usage.prompt_tokens}`);
            console.log(`[azureGptAPIReq] Completion tokens: ${response.usage.completion_tokens}`);
            console.log(`[azureGptAPIReq] Total tokens: ${response.usage.total_tokens}`);
        }

        console.log('[azureGptAPIReq] Successfully received response from Azure OpenAI');
        return response.choices[0].message.content;
    } catch (error) {
        console.error('[azureGptAPIReq] Error:', error.message);
        throw error;
    }
}

/**
 * Helper: Send SSE event to client
 */
function sendSseEvent(reply, status, message, data = null) {
    const event = { status, message };
    if (data) {
        event.data = data;
    }
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Helper: Send SSE error to client
 * Sets appropriate HTTP status code (400 for validation, 500 for server errors)
 */
function sendSseError(reply, message, statusCode = 400) {
    const event = { status: 'error', message };
    
    // Only call writeHead if not already sent
    if (!reply.raw.headersSent) {
        reply.raw.writeHead(statusCode, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
    }
    
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    reply.raw.end();
}

/**
 * POST /api/prompt-llm
 * 
 * Generate SOAP note and billing suggestion from audio recording.
 * Uses Server-Sent Events (SSE) to stream real-time progress updates.
 * 
 * Requires authentication.
 * 
 * @param {Object} request - Fastify request object with { recording_file_path }
 * @param {Object} reply - Fastify reply object
 */
export async function promptLlmHandler(request, reply) {
    const startTime = Date.now();

    try {
        // Extract recording path (Fastify schema validation ensures this exists)
        const { recording_file_path } = request.body;

        // Set up SSE headers after validation passes (validation is done by Fastify schema)
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
        });

        // Send start status
        sendSseEvent(reply, 'started', 'Processing started...');

        // Download audio file from Supabase Storage
        sendSseEvent(reply, 'downloading', 'Downloading audio file from Supabase Storage...');
        
        const supabase = getSupabaseClient(request.headers.authorization);
        const expirySeconds = 60 * 60;
        const { data: signedUrlData, error: signedError } = await supabase.storage
            .from('audio-files')
            .createSignedUrl(recording_file_path, expirySeconds);
        
        if (signedError) {
            console.error('[promptLlmHandler] Signed URL error:', signedError);
            return sendSseError(reply, `Failed to create signed URL: ${signedError.message}`);
        }

        const recording_file_signed_url = signedUrlData.signedUrl;

        // Transcribe, expand, and mask
        sendSseEvent(reply, 'transcribe and mask', 'Transcribing audio and masking PHI...');
        
        let transcriptResult;
        const transcribeStartTime = Date.now();
        console.log("[promptLlmHandler] Transcription start time:", new Date(transcribeStartTime).toISOString());
        
        try {
            transcriptResult = await transcribe_expand_mask({ recording_file_signed_url, req: request });
        } catch (error) {
            console.error('[promptLlmHandler] transcribe_expand_mask error:', error?.message || error);
            console.error(error?.stack || error);
            return sendSseError(reply, `Transcription failed: ${error?.message || 'Unknown error'}`);
        }

        // Validate transcription result
        if (!transcriptResult || !transcriptResult.cloudRunData?.transcript || !transcriptResult.maskResult?.masked_transcript || !transcriptResult.maskResult?.phi_entities) {
            console.error('[promptLlmHandler] Transcription result missing expected properties:', transcriptResult);
            return sendSseError(reply, 'Failed to create transcript. Please try again.');
        }

        const transcript = transcriptResult.expandedTranscript; // Clean transcript with dot phrase expansions for user
        const maskedTranscript = transcriptResult.maskResult.masked_transcript; // Masked LLM-notated version for processing
        const tokens = transcriptResult.maskResult.tokens; // AWS Comprehend Medical token mapping for unmasking
        const transcribeEndTime = Date.now();
        
        console.log('[promptLlmHandler] Transcription Result:', JSON.stringify(transcriptResult, null, 2));
        console.log('[promptLlmHandler] Transcription time:', (transcribeEndTime - transcribeStartTime) / 1000, 's');

        // Send transcription complete with transcript
        sendSseEvent(reply, 'transcription complete', 'Transcription complete!', { transcript });

        // Create SOAP Note and Billing Suggestion
        sendSseEvent(reply, 'creating soap note', 'Creating SOAP note and billing suggestion...');

        const soapNoteAndBillingReqBody = gptRequestBodies.getSoapNoteAndBillingRequestBody(maskedTranscript);
        let soapNoteAndBillingResultRaw;
        
        try {
            soapNoteAndBillingResultRaw = await gptAPIReq(soapNoteAndBillingReqBody);
        } catch (error) {
            console.error('[promptLlmHandler] GPT API error:', error);
            return sendSseError(reply, `SOAP Note processing failed: ${error.message}`);
        }

        if (!soapNoteAndBillingResultRaw) {
            console.error('[promptLlmHandler] Empty response from OpenAI API');
            return sendSseError(reply, 'Failed to create SOAP note and billing suggestion. Empty response from LLM.');
        }

        console.log('[promptLlmHandler] SOAP Note and Billing Suggestion Result Raw:', soapNoteAndBillingResultRaw);

        // Parse LLM response as JSON (some LLMs return stringified JSON)
        let rawString;
        if (typeof soapNoteAndBillingResultRaw === 'string') {
            rawString = soapNoteAndBillingResultRaw;
        } else {
            try {
                rawString = JSON.stringify(soapNoteAndBillingResultRaw);
            } catch (err) {
                console.error('[promptLlmHandler] Failed to stringify LLM object response:', err, soapNoteAndBillingResultRaw);
                return sendSseError(reply, `Failed to convert LLM response to string: ${err.message}`);
            }
        }

        // Quick format validation before unmasking
        const looksLikeJson = rawString.trim().startsWith('{');
        const hasKeys = rawString.includes('soap_note') && rawString.includes('billing');
        if (!looksLikeJson || !hasKeys) {
            console.error('[promptLlmHandler] LLM response failed basic format check:', rawString.slice(0, 400));
            return sendSseError(reply, 'LLM response does not appear to be the expected JSON structure');
        }

        // Clean rawString then unmask any PHI tokens in the raw string before parsing
        rawString = cleanRawText(rawString);
        let unmaskRes;
        try {
            unmaskRes = unmask_phi(rawString, tokens);
        } catch (err) {
            console.error('[promptLlmHandler] Failed to unmask PHI tokens:', err);
            return sendSseError(reply, `Failed to unmask PHI tokens: ${err.message}`);
        }

        const unmaskedString = (unmaskRes && typeof unmaskRes === 'object' && unmaskRes.unmasked_transcript)
            ? unmaskRes.unmasked_transcript
            : String(unmaskRes || rawString);

        // Parse the unmasked string into JSON
        let soapNoteAndBillingResult;
        try {
            soapNoteAndBillingResult = JSON.parse(unmaskedString);
        } catch (err) {
            console.error('[promptLlmHandler] Failed to parse LLM response as JSON after unmasking:', err, { unmaskedString });
            return sendSseError(reply, `Failed to parse SOAP note response as JSON: ${err.message}`);
        }

        // Validate SOAP and Billing structure
        try {
            validateSoapAndBilling(soapNoteAndBillingResult);
        } catch (err) {
            console.error('[promptLlmHandler] SOAP and Billing validation failed:', err);
            return sendSseError(reply, `SOAP note validation failed: ${err.message}`);
        }

        const soapEndTime = Date.now();
        console.log('[promptLlmHandler] SOAP generation time:', (soapEndTime - transcribeEndTime) / 1000, 's');
        console.log('[promptLlmHandler] Total time:', (soapEndTime - startTime) / 1000, 's');

        // Send final response
        sendSseEvent(reply, 'soap note complete', 'SOAP note and billing suggestion created successfully!', soapNoteAndBillingResult);
        reply.raw.end();

    } catch (error) {
        console.error('[promptLlmHandler] Processing error:', error);
        sendSseError(reply, `Processing failed: ${error.message}`);
    }
}
