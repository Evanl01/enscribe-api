import { google } from "googleapis";
import { authenticateRequest } from "@/src/utils/authenticateRequest";

const CLOUD_RUN_URL =
  process.env.CLOUD_RUN_TRANSCRIBE_URL ||
  "https://emscribe-transcriber-641824253036.us-central1.run.app/transcribe";

// Helper: check signed URL by issuing a HEAD request
async function checkSignedUrlValid(url, timeoutMs = 10000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, { method: "HEAD", signal: controller.signal });
    clearTimeout(timeout);
    return resp.ok;
  } catch (err) {
    return false;
  }
}

// Exported helper: transcribe_recording
// Params:
// - recording_file_signed_url: signed URL to the recording (required)
// - req: optional Next.js request object; if provided, authenticateRequest(req) will be called
// - timeoutMs: optional timeout for the HEAD check
export async function transcribe_recording({ recording_file_signed_url, req = null, timeoutMs = 10000 } = {}) {
  if (!recording_file_signed_url || typeof recording_file_signed_url !== "string") {
    throw new Error("recording_file_signed_url is required");
  }

  // If caller provided a request, verify the user is authenticated
  if (req) {
    const { user, error: authError } = await authenticateRequest(req);
    if (authError || !user) {
      throw new Error("Authentication failed");
    }
  }

  // 1) Verify signed URL is still valid (HEAD request, no download)
  const isValid = await checkSignedUrlValid(recording_file_signed_url, timeoutMs);
  if (!isValid) {
    const err = new Error(`Invalid or expired recording_file_signed_url: ${recording_file_signed_url}`);
    err.code = "expired_signed_url";
    throw err;
  }
  console.log("Signed URL is valid:", recording_file_signed_url);

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
      method: "POST",
      data: { recording_file_signed_url },
      headers: { "Content-Type": "application/json" },
      timeout: 300000, // Increased to 5 minutes
    });

    // Enhanced debugging - check what we actually got back
    console.log("Cloud Run response received:");
    console.log("- typeof cloudRunResp:", typeof cloudRunResp);
    console.log("- cloudRunResp keys:", Object.keys(cloudRunResp || {}));
    console.log("- status:", cloudRunResp?.status);
    console.log("- statusText:", cloudRunResp?.statusText);
    console.log("- headers:", cloudRunResp?.headers);
    console.log("- data exists:", !!cloudRunResp?.data);
    console.log("- data type:", typeof cloudRunResp?.data);

    // Try to safely stringify the entire response
    try {
      console.log("- Full response (JSON):", JSON.stringify(cloudRunResp, null, 2));
    } catch (stringifyError) {
      console.log("- Could not stringify response:", stringifyError.message);
      console.log("- Raw response object:", cloudRunResp);
    }

    // Only log data details if data exists
    if (cloudRunResp?.data) {
      console.log("- Data length:", JSON.stringify(cloudRunResp.data).length);
      console.log("- Data preview:", JSON.stringify(cloudRunResp.data).slice(0, 1500));
    } else {
      console.log("- No data in response");
    }

    if (!cloudRunResp?.data) {
      throw new Error('Cloud Run returned empty response body');
    }

    return cloudRunResp.data;
  } catch (error) {
    // Enhanced error logging
    console.error('[transcribe_recording] Cloud Run request failed:');
    console.error('- Error message:', error.message);
    console.error('- Error name:', error.name);
    console.error('- Error code:', error.code);
    console.error('- Error status:', error.status);
    console.error('- Error stack:', error.stack);

    // Try to log the full error object
    try {
      console.error('- Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    } catch (errorStringifyError) {
      console.error('- Could not stringify error:', errorStringifyError.message);
      console.error('- Raw error object:', error);
    }

    if (error.message?.includes('aborted') || error.code === 'ECONNABORTED') {
      throw new Error('Transcription request timed out. Please try with a shorter audio file or check your network connection.');
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error('Unable to connect to transcription service. Please try again later.');
    }

    throw new Error(`Cloud Run service error: ${error.message}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 1) Verify user JWT
  const { user, error: authError } = await authenticateRequest(req);
  if (authError || !user) {
    return res.status(400).json({ error: "Authentication failed" });
  }
  // console.log("Authenticated user:", user.id);

  // 2) Parse body and delegate to exported helper
  const body = req.body || {};
  const { recording_file_signed_url } = body;
  try {
    const cloudRunData = await transcribe_recording({ recording_file_signed_url });
    console.log("Cloud Run response:", cloudRunData);
    return res.status(200).json({ ok: true, recording_file_signed_url, cloudRunResponse: cloudRunData ?? null });
  }
  catch (err) {
    console.error("GCP transcribe handler error:", err);
    const msg = err?.message || String(err);
    return res.status(400).json({ error: msg });
  }

}