// Backend: /api/process-recording.js

import { getSupabaseClient } from '@/src/utils/supabase';
import { authenticateRequest } from '@/src/utils/authenticateRequest';
import { recordingSchema } from '@/src/app/schemas';
import * as geminiRequestBodies from '@/src/utils/geminiRequestBodies'; // Adjust the import path as needed
import * as gptRequestBodies from '@/src/utils/gptRequestBodies'; // Adjust the import path as needed
import * as transcribe_complete from '@/src/pages/api/gcp/transcribe/complete';
import { unmask_phi } from '@/src/utils/maskPhiHelper';
import { sendApiError, sendSseError } from '@/src/utils/apiErrorResponse';
import ca from 'zod/v4/locales/ca.cjs';
import tr from 'zod/v4/locales/tr.cjs';
const recordingTableName = 'recordings';

// Schema types for Gemini structured output

let response = {
    status: '',      // e.g. 'started', 'processing', 'error', etc.
    message: '',     // e.g. 'Processing started...', etc.
};

// Disable Next.js body parsing to handle multipart/form-data
export const config = {
    api: {
        bodyParser: false,
    },
};


// Helper: clean raw text from LLMs to normalize problematic characters for EHR systems
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


//  Handle Gemini API request
async function geminiAPIReq(reqBody) {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const geminiApiUrl = process.env.GEMINI_API_URL || "https://generative-language.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
    if (!geminiApiKey) {
        throw new Error('Gemini API key not configured');
    }

    const response = await fetch(`${geminiApiUrl}?key=${geminiApiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(reqBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${errorText}`);
    }

    const geminiData = await response.json();

    if (!geminiData.candidates || !geminiData.candidates[0] || !geminiData.candidates[0].content) {
        throw new Error('Invalid response from Gemini API');
    }

    const responseText = geminiData.candidates[0].content.parts[0].text;
    return JSON.parse(responseText);
}

// Handle OpenAI GPT API request
async function gptAPIReq(reqBody) {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const openaiApiUrl = process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
    if (!openaiApiKey) {
        throw new Error('OpenAI API key not configured');
    }

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

    // Print token usage
    if (openaiData.usage) {
        console.log(`Prompt tokens: ${openaiData.usage.prompt_tokens}`);
        console.log(`Completion tokens: ${openaiData.usage.completion_tokens}`);
        console.log(`Total tokens: ${openaiData.usage.total_tokens}`);
    }


    // Return the content of the first message
    return openaiData.choices[0].message.content;
}

// Basic runtime validator for the expected soap_and_billing JSON schema.
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
    if (b.icd10_codes.length < 1) throw new Error('billing.icd10_codes must contain at least one code');
    if (typeof b.billing_code !== 'string') throw new Error('billing.billing_code must be a string');
    if (typeof b.additional_inquiries !== 'string') throw new Error('billing.additional_inquiries must be a string');

    // Limit check
    if (b.icd10_codes.length > 10) throw new Error('billing.icd10_codes has too many entries');

    return true;
}

export default async function handler(req, res) {
    // Authenticate user for all methods
    const supabase = getSupabaseClient(req.headers.authorization);
    const { user, error: authError } = await authenticateRequest(req);
    if (authError) return sendApiError(res, 401, 'auth_error', authError);

    if (req.method !== 'POST') {
        return sendApiError(res, 405, 'method_not_allowed', 'Method not allowed');
    }
    // Start timer
    // Set up SSE headers for progress updates
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
    });

    try {
        // Send immediate acknowledgment
        response.status = 'started';
        response.message = 'Processing started...';
        res.write(`data: ${JSON.stringify(response)}\n\n`);

        // Expect JSON body with recording_file_path
        let body = '';
        req.on('data', chunk => { body += chunk; });
        await new Promise(resolve => req.on('end', resolve));
        let recording_file_path;
        try {
            const parsed = JSON.parse(body);
            recording_file_path = parsed.recording_file_path;
        } catch (e) {
            sendSseError(res, 400, 'Invalid JSON body or missing recording_file_path');
            return;
        }
        if (!recording_file_path) {
            sendSseError(res, 400, 'recording_file_path is required');
            return;
        }

        response.status = 'downloading';
        response.message = 'Downloading audio file from Supabase Storage...';
        res.write(`data: ${JSON.stringify(response)}\n\n`);
        const expirySeconds = 60 * 60;
        const { data: signedUrlData, error: signedError } = await supabase.storage
            .from('audio-files')
            .createSignedUrl(recording_file_path, expirySeconds);
        if (signedError) {
            console.error('Signed URL error:', signedError);
            return sendApiError(res, 500, 'signed_url_error', 'Failed to create signed URL: ' + signedError.message);
        }
        const recording_file_signed_url = signedUrlData.signedUrl;

        // Transcribe audio using cloud GCP and mask with AWS Comprehend medical
        response.status = 'transcribe and mask';
        response.message = 'Transcribing audio and masking PHI...';
        res.write(`data: ${JSON.stringify(response)}\n\n`);
        // Transcribe audio using cloud GCP and mask with AWS Comprehend medical
        let transcriptResult;
        const start_time = Date.now(); // Use numeric timestamp instead of ISO string
        console.log("[transcribe_expand_mask] Start time: ", new Date(start_time).toISOString());
        try {
            transcriptResult = await transcribe_complete.transcribe_expand_mask({ recording_file_signed_url, req });
        }
        catch (error) {
            // Log full error + stack so backend logs show root cause
            console.error('transcribe_expand_mask error:', error?.message || error);
            console.error(error?.stack || error);
            sendSseError(res, 500,  `Transcription failed: ${error?.message || 'Unknown error'}`);
            return;
        }
        // const transcriptResult = await geminiAPIReq(transcriptReqBody).catch(error => {
        //     response.status = 'error';
        //     response.message = `Transcription failed: ${error.message}`;
        //     res.write(`data: ${JSON.stringify(response)}\n\n`);
        //     res.end();
        //     return;
        // });
        if (!transcriptResult || !transcriptResult.cloudRunData?.transcript || !transcriptResult.maskResult?.masked_transcript || !transcriptResult.maskResult?.phi_entities) {
            // response.status = 'error';
            // response.message = 'Transcription result is empty or invalid';
            console.error('Transcription result is missing expected properties:', transcriptResult);
            return sendApiError(res, 400, 'transcription_invalid', 'Failed to create transcript. Please try again.');
        }
        const transcript = transcriptResult.expandedTranscript; // Clean transcript with dot phrase expansions for user
        const maskedTranscript = transcriptResult.maskResult.masked_transcript; // Masked LLM-notated version for processing
        const phiEntities = transcriptResult.maskResult.phi_entities;
        const transcribe_end_time = Date.now(); // Use numeric timestamp
        
        console.log('Transcription Result:', JSON.stringify(transcriptResult, null, 2));
        console.log('[transcribe_expand_mask] Total time: ', (transcribe_end_time - start_time) / 1000, 's');
        response.status = 'transcription complete';
        response.message = 'Transcription complete!';
        // Send message, with additional 'data' field for transcript
        res.write(`data: ${JSON.stringify({ ...response, data: { transcript } })}\n\n`);

        // Create SOAP Note and Billing Suggestion request body
        response.status = 'creating soap note';
        response.message = 'Creating SOAP note and billing suggestion...';
        res.write(`data: ${JSON.stringify(response)}\n\n`);

        // Create SOAP Note and Billing Suggestion using OpenAI API
        const soapNoteAndBillingReqBody = gptRequestBodies.getSoapNoteAndBillingRequestBody(maskedTranscript);
        let soapNoteAndBillingResultRaw;
        try {
            soapNoteAndBillingResultRaw = await gptAPIReq(soapNoteAndBillingReqBody);
        } catch (error) {
            sendSseError(res, 500, `SOAP Note processing failed: ${error.message}`);
            return;
        }

        if (!soapNoteAndBillingResultRaw) {
            const error = 'soap empty response'
            console.error(error, soapNoteAndBillingResultRaw);
            sendSseError(res, 500, `Failed to create SOAP note and billing suggestion. Empty response from LLM.`);
            return;
        }
        console.log('SOAP Note and Billing Suggestion Result Raw:', soapNoteAndBillingResultRaw);

        let soapNoteAndBillingResultUnmasked;
        try {
            // Clean then unmask any PHI tokens in the raw string before parsing
            const cleanedSoapRaw = typeof soapNoteAndBillingResultRaw === 'string'
                ? cleanRawText(soapNoteAndBillingResultRaw)
                : cleanRawText(JSON.stringify(soapNoteAndBillingResultRaw));
            soapNoteAndBillingResultUnmasked = unmask_phi(cleanedSoapRaw, phiEntities);
        } catch (err) {
            console.error('Failed to unmask PHI tokens:', err);
            sendSseError(res, 500, `Failed to unmask PHI tokens: ${err.message}`);
            return;
        }
        // Try to parse LLM response as JSON (some LLMs return stringified JSON)
        // Prepare raw string for validation/unmasking: if LLM returned an object, stringify it
        let rawString;
        if (typeof soapNoteAndBillingResultRaw === 'string') {
            rawString = soapNoteAndBillingResultRaw;
        } else {
            try {
                rawString = JSON.stringify(soapNoteAndBillingResultRaw);
            } catch (err) {
                console.error('Failed to stringify LLM object response:', err, soapNoteAndBillingResultRaw);
                sendSseError(res, 500, `Failed to convert LLM response to string: ${err.message}`);
                return;
            }
        }

        // Quick format validation before unmasking: ensure it looks like a JSON object containing expected keys
        const looksLikeJson = rawString.trim().startsWith('{');
        const hasKeys = rawString.includes('soap_note') && rawString.includes('billing');
        if (!looksLikeJson || !hasKeys) {
            console.error('LLM response failed basic format check:', rawString.slice(0, 400));
            sendSseError(res, 500, `LLM response does not appear to be the expected JSON structure`);
            return;
        }

        // Clean rawString then unmask any PHI tokens in the raw string before parsing
        rawString = cleanRawText(rawString);
        let unmaskRes;
        try {
            unmaskRes = unmask_phi(rawString, phiEntities || []);
        } catch (err) {
            console.error('Failed to unmask PHI tokens:', err);
            sendSseError(res, 500, `Failed to unmask PHI tokens: ${err.message}`);
            return;
        }

        const unmaskedString = (unmaskRes && typeof unmaskRes === 'object' && unmaskRes.unmasked_transcript)
            ? unmaskRes.unmasked_transcript
            : String(unmaskRes || rawString);

        // Parse the unmasked string into JSON
        let soapNoteAndBillingResult;
        try {
            soapNoteAndBillingResult = JSON.parse(unmaskedString);
        } catch (err) {
            console.error('Failed to parse LLM response as JSON after unmasking:', err, { unmaskedString });
            sendSseError(res, 500, `Failed to parse SOAP note response as JSON: ${err.message}`);
            return;
        }
        const end_time = Date.now(); // Use numeric timestamp
        console.log("[soap and billing] time: ", (end_time - transcribe_end_time) / 1000, 's');
        console.log('[/prompt-llm] Total time: ', (end_time - start_time) / 1000, 's');

        response.status = 'soap note complete';
        response.message = 'SOAP note and billing suggestion created successfully!';
        res.write(`data: ${JSON.stringify({ ...response, data: soapNoteAndBillingResult })}\n\n`);
        res.end();

    } catch (error) {
        console.error('Processing error:', error);
        response.status = 'error';
        response.message = `Processing failed: ${error.message}`;
        res.write(`data: ${JSON.stringify(response)}\n\n`);
        res.end();
    }
}