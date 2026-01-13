import { NextResponse } from "next/server";
import {
  ComprehendMedicalClient,
  DetectPHICommand,
} from "@aws-sdk/client-comprehendmedical";
import { authenticateRequest } from "@/src/utils/authenticateRequest";

/**
 * Reusable mask_phi helper for server-side usage.
 * Returns { masked_transcript, phi_entities }
 */
export async function mask_phi(transcript, mask_threshold = 0.15) {
  if (!transcript || typeof transcript !== "string") {
    throw new Error("Transcript is required and must be a string");
  }

  // AWS Comprehend Medical has a 20,000 character limit
  const MAX_CHARS = 19000; // Leave some buffer for safety
  
  // If transcript is within limit, process normally
  if (transcript.length <= MAX_CHARS) {
    return await processSingleChunk(transcript, mask_threshold);
  }

  // For longer transcripts, split into chunks and process each
  console.log(`Transcript length (${transcript.length}) exceeds AWS limit. Splitting into chunks.`);
  
  const chunks = splitIntoChunks(transcript, MAX_CHARS);
  let allEntities = [];
  let currentOffset = 0;
  let maskedTranscript = "";

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`Processing chunk ${i + 1}/${chunks.length}, length: ${chunk.length}`);
    
    const chunkResult = await processSingleChunk(chunk, mask_threshold);
    
    // Adjust entity offsets to account for previous chunks
    const adjustedEntities = chunkResult.phi_entities.map(entity => ({
      ...entity,
      BeginOffset: entity.BeginOffset + currentOffset,
      EndOffset: entity.EndOffset + currentOffset,
      Id: entity.Id + (i * 1000) // Offset IDs to avoid conflicts between chunks
    }));
    
    allEntities = allEntities.concat(adjustedEntities);
    maskedTranscript += chunkResult.masked_transcript;
    currentOffset += chunk.length;
  }

  return {
    masked_transcript: maskedTranscript,
    phi_entities: allEntities,
    skipped_entities: [], // Could aggregate if needed
    mask_threshold: mask_threshold !== undefined ? Number(mask_threshold) : 0.15,
    chunks_processed: chunks.length
  };
}

/**
 * Split text into chunks that respect word boundaries when possible
 */
function splitIntoChunks(text, maxChars) {
  const chunks = [];
  let start = 0;
  
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    
    // If not at the end of the text, try to break at a word boundary
    if (end < text.length) {
      // Look backwards for a space, period, or newline within the last 500 chars
      const searchStart = Math.max(start, end - 500);
      const breakPoint = text.lastIndexOf(' ', end);
      
      if (breakPoint > searchStart) {
        end = breakPoint + 1; // Include the space
      }
    }
    
    chunks.push(text.slice(start, end));
    start = end;
  }
  
  return chunks;
}

/**
 * Process a single chunk of text (original logic)
 */
async function processSingleChunk(transcript, mask_threshold = 0.15) {
  // AWS Comprehend Medical client
  const client = new ComprehendMedicalClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_COMPREHEND_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_COMPREHEND_SECRET_ACCESS_KEY,
    },
  });

  // Call detect PHI
  const command = new DetectPHICommand({ Text: transcript });
  const response = await client.send(command);
  const entities = response.Entities || [];

  // Sort entities (descending) so replacements don't shift indexes
  const sortedEntities = [...entities].sort((a, b) => b.BeginOffset - a.BeginOffset);

  // Determine threshold: param -> env -> default
  const threshold =
    mask_threshold !== undefined
      ? Number(mask_threshold)
      : 0.15;

  // Normalize and attach an Id for each entity. Use existing Id if provided by the SDK,
  // otherwise generate a sequential id (per entity) so replacement tokens are stable.
  // Then filter by score threshold so we only mask high-confidence entities.
  const normalized = sortedEntities.map((e, idx) => ({
    Type: e.Type,
    Text: e.Text,
    BeginOffset: e.BeginOffset,
    EndOffset: e.EndOffset,
    Score: e.Score,
    Id: e.Id ?? idx + 1,
  }));

  const phi_entities = normalized.filter(e => Number(e.Score) >= threshold);
  const skipped_entities = normalized.filter(e => Number(e.Score) < threshold);

  // Mask PHI spans using token format {{TYPE_ID}} (e.g. {{NAME_1}})
  // We iterate masked entities (already sorted desc) so offsets remain valid.
  let maskedTranscript = transcript;
  for (const entity of phi_entities) {
    const token = `{{${entity.Type}_${entity.Id}}}`;
    maskedTranscript =
      maskedTranscript.slice(0, entity.BeginOffset) +
      token +
      maskedTranscript.slice(entity.EndOffset);
  }

  console.log("Masked transcript:", maskedTranscript, "PHI entities:", phi_entities);

  return { masked_transcript: maskedTranscript, phi_entities, skipped_entities, mask_threshold: threshold };
}

/**
 * Unmask PHI tokens in the form {{TYPE_ID}} using provided phi_entities.
 * - Replaces tokens that exactly match <Type>_<Id> with the original text from phi_entities.
 * - Logs a warning for any {{...}} token that doesn't match the expected format.
 * - Logs a warning when a token matches the format but no corresponding entity is found.
 * Returns { unmasked_transcript, warnings }
 */
export function unmask_phi(maskedTranscript, phi_entities = []) {
  if (!maskedTranscript || typeof maskedTranscript !== 'string') {
    throw new Error('maskedTranscript is required and must be a string');
  }

  // Build quick lookup map keyed by "Type_Id"
  const entityMap = new Map();
  for (const e of phi_entities) {
    // Ensure Id is string for stable lookup
    const idStr = String(e.Id);
    const key = `${e.Type}_${idStr}`;
    entityMap.set(key, e.Text);
  }

  const invalidTokens = [];
  const noMatchTokens = [];

  const unmasked = maskedTranscript.replace(/\{\{([^}]+)\}\}/g, (match, inner) => {
    // Validate expected format TYPE_ID
    const parts = inner.match(/^([A-Za-z0-9]+)_(\d+)$/);
    if (!parts) {
      // Token looked like PHI but doesn't match our mask format
      invalidTokens.push(match);
      console.warn('PHI detected but invalid format:', match);
      return match; // leave unchanged
    }

    const key = `${parts[1]}_${parts[2]}`;
    const replacement = entityMap.get(key);
    if (replacement === undefined) {
      noMatchTokens.push(match);
      console.warn('PHI token has no matching entity:', match);
      return match; // leave unchanged
    }

    return replacement;
  });

  return { unmasked_transcript: unmasked, warnings: { invalidTokens, noMatchTokens } };
}

export async function POST(req) {
  try {
    // Verify user JWT to prevent abuse
    const { user, error: authError } = await authenticateRequest(req);
    if (authError || !user) {
      return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
    }

    const body = await req.json();
    const { transcript } = body;

    if (!transcript) {
      return NextResponse.json({ error: "Transcript is required" }, { status: 400 });
    }

    const result = await mask_phi(transcript);
    return NextResponse.json(result);
  } catch (err) {
    console.error("mask-phi error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
