import { transcribe_recording } from "@/src/pages/api/gcp/transcribe";
import { mask_phi } from "@/src/utils/maskPhiHelper";
import { authenticateRequest } from "@/src/utils/authenticateRequest";
import { getAllDotPhrasesForUser } from "@/src/pages/api/dotPhrases";
import { getSupabaseClient } from "@/src/utils/supabase";

/**
 * Expands dot phrases in text using Aho-Corasick algorithm for efficient multi-pattern matching.
 * Creates multiple versions of each trigger: original, no punctuation (except apostrophes), and expanded contractions.
 * Prioritizes longer matches over shorter ones.
 * 
 * @param {string} text - The text to expand dot phrases in
 * @param {Array} dotPhrases - Array of dot phrase objects with trigger and expansion properties
 * @returns {Object} - Object with expanded (clean) and llm_notated (with prefixes) versions
 */
function expandDotPhrases(text, dotPhrases) {
  if (!text || !dotPhrases || dotPhrases.length === 0) {
    return { expanded: text, llm_notated: text };
  }

  console.log(`[expandDotPhrases] Processing ${dotPhrases.length} dot phrases`);

  // Build all trigger versions
  const triggerMap = buildTriggerVersions(dotPhrases);
  const allTriggers = Array.from(triggerMap.keys());

  if (allTriggers.length === 0) {
    console.log('[expandDotPhrases] No valid trigger versions to process');
    return text;
  }

  console.log(`[expandDotPhrases] Built ${allTriggers.length} trigger versions from ${dotPhrases.length} dot phrases`);

  // Build Aho-Corasick automaton
  const automaton = buildAhoCorasick(allTriggers);
  
  // Find all matches using Aho-Corasick
  const matches = findAllMatches(text.toLowerCase(), automaton, triggerMap);

  if (matches.length === 0) {
    console.log('[expandDotPhrases] No dot phrase triggers found in text');
    return { expanded: text, llm_notated: text };
  }

  // Sort matches by position (descending) to avoid offset issues during replacement
  matches.sort((a, b) => b.start - a.start);

  console.log(`[expandDotPhrases] Found ${matches.length} matches`);

  // Apply replacements - create both versions
  let expandedText = text; // Clean version for user
  let llmNotatedText = text; // Version with notation for LLM
  const appliedExpansions = [];

  for (const match of matches) {
    const originalText = text.substring(match.start, match.end);
    
    // Clean expansion for user
    const cleanExpansion = match.expansion;
    expandedText = expandedText.substring(0, match.start) + cleanExpansion + expandedText.substring(match.end);
    
    // Notated expansion for LLM
    const notatedExpansion = `{(This is the doctor's autofilled dotPhrase, place extra emphasis on this section of the transcript) ${match.expansion}(end dotPhrase)}`;
    llmNotatedText = llmNotatedText.substring(0, match.start) + notatedExpansion + llmNotatedText.substring(match.end);
    
    appliedExpansions.push({
      trigger: match.trigger,
      originalText: originalText,
      expansion: match.expansion,
      startIndex: match.start
    });

    console.log(`[expandDotPhrases] Replaced "${originalText}" at index ${match.start} with expansion`);
  }

  console.log(`[expandDotPhrases] Successfully applied ${appliedExpansions.length} expansions`);
  appliedExpansions.forEach(exp => {
    console.log(`  - "${exp.originalText}" → "${exp.expansion}"`);
  });

  return { expanded: expandedText, llm_notated: llmNotatedText };
}

/**
 * Builds multiple versions of each trigger and maps them to their expansions
 * @param {Array} dotPhrases - Array of dot phrase objects
 * @returns {Map} - Map of trigger versions to their expansion data
 */
function buildTriggerVersions(dotPhrases) {
  const triggerMap = new Map();
  
  for (const dotPhrase of dotPhrases) {
    const trigger = dotPhrase.trigger?.trim();
    const expansion = dotPhrase.expansion?.trim();
    
    if (!trigger || !expansion) continue;

    const versions = [];
    
    // Version 1: Original trigger
    versions.push(trigger.toLowerCase());
    
    // Version 2: Remove all punctuation except apostrophes
    const noPunctVersion = trigger.replace(/[^\w\s']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (noPunctVersion && noPunctVersion !== trigger.toLowerCase()) {
      versions.push(noPunctVersion);
    }
    
    // Version 3: Remove all punctuation, expand contractions and abbreviations
    const contractionsExpanded = expandContractions(noPunctVersion);
    const expandedVersion = expandAbbreviations(contractionsExpanded).toLowerCase();
    if (expandedVersion && expandedVersion !== trigger.toLowerCase() && expandedVersion !== noPunctVersion) {
      versions.push(expandedVersion);
    }

    // Add all unique versions to the map
    const uniqueVersions = [...new Set(versions)].filter(v => v.length > 0);
    
    for (const version of uniqueVersions) {
      if (!triggerMap.has(version) || triggerMap.get(version).trigger.length < trigger.length) {
        triggerMap.set(version, {
          trigger: version,
          originalTrigger: trigger,
          expansion: expansion,
          length: version.length
        });
      }
    }
  }
  
  return triggerMap;
}

/**
 * Expands common contractions in text
 * @param {string} text - Text containing contractions
 * @returns {string} - Text with contractions expanded
 */
function expandContractions(text) {
  if (!text) return text;
  
  const contractions = {
    "aren't": "are not",
    "can't": "cannot", 
    "couldn't": "could not",
    "didn't": "did not",
    "doesn't": "does not",
    "don't": "do not",
    "hadn't": "had not",
    "hasn't": "has not",
    "haven't": "have not",
    "isn't": "is not",
    "mightn't": "might not",
    "mustn't": "must not",
    "needn't": "need not",
    "shan't": "shall not",
    "shouldn't": "should not",
    "wasn't": "was not",
    "weren't": "were not",
    "won't": "will not",
    "wouldn't": "would not"
  };

  let result = text;
  for (const [contraction, expansion] of Object.entries(contractions)) {
    const regex = new RegExp(`\\b${contraction}\\b`, 'gi');
    result = result.replace(regex, expansion);
  }
  
  return result;
}

/**
 * Expands common abbreviations in text (e.g., "dr." → "doctor", "ok" → "okay")
 * @param {string} text - Text to expand abbreviations in
 * @returns {string} - Text with abbreviations expanded
 */
function expandAbbreviations(text) {
  const abbreviations = {
    // Titles
    "dr.": "doctor",
    "mr.": "mister", 
    "mrs.": "missus",
    "ms.": "miss",
    "prof.": "professor",
    
    // Common abbreviations
    "ok": "okay",
    "etc.": "et cetera",
    "vs.": "versus",
    "i.e.": "that is",
    "e.g.": "for example",
    "aka": "also known as",
    "asap": "as soon as possible",
    "fyi": "for your information",
    "btw": "by the way",
    "omg": "oh my god",
    "lol": "laugh out loud",
    "imo": "in my opinion",
    "tbh": "to be honest",
    "irl": "in real life",
    
    // Medical abbreviations
    "bp": "blood pressure",
    "hr": "heart rate", 
    "rr": "respiratory rate",
    "temp": "temperature",
    "wt": "weight",
    "ht": "height",
    "bmi": "body mass index",
    "cc": "chief complaint",
    "hpi": "history of present illness",
    "pmh": "past medical history",
    "psh": "past surgical history",
    "fh": "family history",
    "sh": "social history",
    "ros": "review of systems",
    "pe": "physical exam",
    "a&p": "assessment and plan",
    "dx": "diagnosis",
    "tx": "treatment",
    "rx": "prescription",
    "pt": "patient",
    "pts": "patients",
    "yr": "year",
    "yrs": "years",
    "mo": "month",
    "mos": "months",
    "wk": "week",
    "wks": "weeks"
  };

  let result = text;
  for (const [abbreviation, expansion] of Object.entries(abbreviations)) {
    const regex = new RegExp(`\\b${abbreviation}\\b`, 'gi');
    result = result.replace(regex, expansion);
  }
  
  return result;
}

/**
 * Builds Aho-Corasick automaton for efficient multi-pattern matching
 * @param {Array} patterns - Array of patterns to search for
 * @returns {Object} - Aho-Corasick automaton
 */
function buildAhoCorasick(patterns) {
  const trie = { children: {}, isEnd: false, patterns: [], failure: null };
  
  // Build trie
  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    let current = trie;
    
    for (const char of pattern) {
      if (!current.children[char]) {
        current.children[char] = { children: {}, isEnd: false, patterns: [], failure: null };
      }
      current = current.children[char];
    }
    
    current.isEnd = true;
    current.patterns.push(pattern);
  }
  
  // Build failure links using BFS
  const queue = [];
  
  // All first level nodes have failure link to root
  for (const child of Object.values(trie.children)) {
    child.failure = trie;
    queue.push(child);
  }
  
  while (queue.length > 0) {
    const current = queue.shift();
    
    for (const [char, child] of Object.entries(current.children)) {
      queue.push(child);
      
      let failure = current.failure;
      while (failure && !failure.children[char]) {
        failure = failure.failure;
      }
      
      child.failure = failure ? failure.children[char] : trie;
      
      // Add patterns from failure node
      if (child.failure.patterns.length > 0) {
        child.patterns.push(...child.failure.patterns);
      }
    }
  }
  
  return trie;
}

/**
 * Finds all pattern matches in text using Aho-Corasick algorithm
 * @param {string} text - Text to search in (should be lowercase)
 * @param {Object} automaton - Aho-Corasick automaton
 * @param {Map} triggerMap - Map of triggers to their expansion data
 * @returns {Array} - Array of match objects with start, end, trigger, and expansion
 */
function findAllMatches(text, automaton, triggerMap) {
  const matches = [];
  let current = automaton;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    // Follow failure links until we find a valid transition or reach root
    while (current && !current.children[char]) {
      current = current.failure;
    }
    
    if (current && current.children[char]) {
      current = current.children[char];
    } else {
      current = automaton;
      continue;
    }
    
    // Check for matches at current position
    if (current.patterns.length > 0) {
      for (const pattern of current.patterns) {
        const start = i - pattern.length + 1;
        const end = i + 1;
        
        // Verify word boundaries for whole-word matching
        const beforeChar = start > 0 ? text[start - 1] : ' ';
        const afterChar = end < text.length ? text[end] : ' ';
        
        if (isWordBoundary(beforeChar) && isWordBoundary(afterChar)) {
          const triggerData = triggerMap.get(pattern);
          if (triggerData) {
            matches.push({
              start: start,
              end: end,
              trigger: pattern,
              originalTrigger: triggerData.originalTrigger,
              expansion: triggerData.expansion
            });
          }
        }
      }
    }
  }
  
  // Remove overlapping matches, keeping the longest ones
  return removeOverlappingMatches(matches);
}

/**
 * Checks if a character represents a word boundary
 * @param {string} char - Character to check
 * @returns {boolean} - True if character is a word boundary
 */
function isWordBoundary(char) {
  return /\W/.test(char);
}

/**
 * Removes overlapping matches, prioritizing longer matches
 * @param {Array} matches - Array of match objects
 * @returns {Array} - Array of non-overlapping matches
 */
function removeOverlappingMatches(matches) {
  if (matches.length <= 1) return matches;
  
  // Sort by length (descending), then by position
  matches.sort((a, b) => {
    const lengthDiff = (b.end - b.start) - (a.end - a.start);
    return lengthDiff !== 0 ? lengthDiff : a.start - b.start;
  });
  
  const result = [];
  const used = new Set();
  
  for (const match of matches) {
    let overlap = false;
    for (let i = match.start; i < match.end; i++) {
      if (used.has(i)) {
        overlap = true;
        break;
      }
    }
    
    if (!overlap) {
      result.push(match);
      for (let i = match.start; i < match.end; i++) {
        used.add(i);
      }
    }
  }
  
  return result;
}

/**
 * Enhanced transcription pipeline: transcribe, expand dot phrases, then mask PHI.
 * Runs transcription and dot phrase fetching in parallel for better performance.
 * 
 * @param {object} opts
 * @param {string} opts.recording_file_signed_url - signed url to recording
 * @param {import('http').IncomingMessage} opts.req - HTTP request object for authentication
 * @param {boolean} [opts.enableDotPhraseExpansion=true] - whether to perform dot phrase expansion
 * @returns {Promise<{ cloudRunData: any, dotPhrasesData: any, expandedTranscript: string, maskResult: any }>}
 */
export async function transcribe_expand_mask({ 
  recording_file_signed_url, 
  req,
  enableDotPhraseExpansion = true 
} = {}) {
  if (!recording_file_signed_url || typeof recording_file_signed_url !== "string") {
    const e = new Error("recording_file_signed_url is required");
    e.status = 400;
    throw e;
  }

  // Require req parameter
  if (!req) {
    const e = new Error("req is required");
    e.status = 400;
    throw e;
  }

  // Authenticate user
  const { user, error: authError } = await authenticateRequest(req);
  if (authError || !user) {
    const e = new Error("Authentication failed");
    e.status = 401;
    throw e;
  }

  console.log("Step 1: Starting parallel transcription and dot phrase fetching");
  
  // 1) Run transcription and dot phrase fetching in parallel
  const [transcriptionResult, dotPhrasesResult] = await Promise.allSettled([
    transcribe_recording({ recording_file_signed_url, user }),
    enableDotPhraseExpansion ? getAllDotPhrasesForUser(user.id, getSupabaseClient(req.headers.authorization)) : Promise.resolve({ success: true, data: [], error: null })
  ]);

  // 2) Handle transcription result
  let cloudRunData;
  if (transcriptionResult.status === 'rejected') {
    const err = transcriptionResult.reason;
    console.error("transcribe_recording error:", err?.message || err);
    console.error(err?.stack || err);

    const e = new Error(err?.message || "Transcription failed");
    if (err?.status) e.status = err.status;
    e.cause = err;
    if (err?.stack) {
      e.stack = `${e.stack}\nCaused by: ${err.stack}`;
    }
    throw e;
  }
  cloudRunData = transcriptionResult.value;

  // 3) Extract transcript text
  const originalTranscript = cloudRunData?.transcript || null;
  if (!originalTranscript || typeof originalTranscript !== "string") {
    const e = new Error("Transcription returned no transcript text");
    e.status = 500;
    e.cloudRunData = cloudRunData;
    throw e;
  }

  console.log("Step 2: Transcription completed, processing dot phrases");

  // 4) Handle dot phrases result
  let dotPhrasesData = [];
  let expandedTranscript = originalTranscript; // Clean version for user
  let llmNotatedText = originalTranscript; // Notated version for LLM/masking

  if (enableDotPhraseExpansion) {
    if (dotPhrasesResult.status === 'rejected') {
      console.warn("Warning: Failed to fetch dot phrases, skipping expansion:", dotPhrasesResult.reason?.message || dotPhrasesResult.reason);
      dotPhrasesData = [];
    } else {
      const dotPhrasesResponse = dotPhrasesResult.value;
      if (dotPhrasesResponse.success) {
        dotPhrasesData = dotPhrasesResponse.data;
        console.log(`Step 3: Expanding dot phrases (${dotPhrasesData.length} available)`);
        const expansionResult = expandDotPhrases(originalTranscript, dotPhrasesData);
        expandedTranscript = expansionResult.expanded;
        llmNotatedText = expansionResult.llm_notated;
      } else {
        console.warn("Warning: Dot phrases fetch returned error, skipping expansion:", dotPhrasesResponse.error);
        dotPhrasesData = [];
      }
    }
  } else {
    console.log("Step 3: Dot phrase expansion disabled, skipping");
  }

  console.log("Step 4: Masking PHI");

  // 5) Mask PHI on the LLM-notated text (with dot phrase emphasis)
  let maskResult;
  try {
    maskResult = await mask_phi(llmNotatedText);
  } catch (err) {
    console.error("mask_phi error:", err?.message || err);
    console.error(err?.stack || err);

    const e = new Error(err?.message || "Masking PHI failed");
    if (err?.status) e.status = err.status;
    e.cause = err;
    if (err?.stack) {
      e.stack = `${e.stack}\nCaused by: ${err.stack}`;
    }
    throw e;
  }

  // Handle Response-like maskResult objects
  if (maskResult && typeof maskResult === "object" && "ok" in maskResult && typeof maskResult.ok === "boolean") {
    if (!maskResult.ok) {
      const e = new Error("Mask PHI endpoint returned failure");
      e.status = 500;
      e.details = maskResult;
      throw e;
    }
    if (typeof maskResult.json === "function") {
      const body = await maskResult.json();
      maskResult = body;
    }
  }

  console.log("Step 5: Pipeline completed successfully");

  return { 
    cloudRunData, 
    dotPhrasesData, 
    expandedTranscript, 
    maskResult 
  };
}

/**
 * Helper: transcribe a recording via Cloud Run then mask PHI.
 * Throws on error so callers (e.g. prompt-llm) can catch and propagate.
 *
 * @param {object} opts
 * @param {string} opts.recording_file_signed_url - signed url to recording
 * @param {import('http').IncomingMessage} opts.req - HTTP request object for authentication
 * @returns {Promise<{ cloudRunData: any, maskResult: any }>}
 */
export async function transcribe_and_mask({ recording_file_signed_url, req } = {}) {
  if (!recording_file_signed_url || typeof recording_file_signed_url !== "string") {
    const e = new Error("recording_file_signed_url is required");
    e.status = 400;
    throw e;
  }

  // Require req parameter
  if (!req) {
    const e = new Error("req is required");
    e.status = 400;
    throw e;
  }

  // Authenticate user
  const { user, error: authError } = await authenticateRequest(req);
  if (authError || !user) {
    const e = new Error("Authentication failed");
    e.status = 401;
    throw e;
  }

  // 1) Transcribe via Cloud Run (transcribe_recording should throw on failure)
  console.log("Step 1: [transcribe_recording]");
  let cloudRunData;
  try {
    cloudRunData = await transcribe_recording({ recording_file_signed_url, user });
  } catch (err) {
    // Log full error + stack before wrapping/propagating
    console.error("transcribe_recording error:", err?.message || err);
    console.error(err?.stack || err);

    // preserve original error as cause and include original stack
    const e = new Error(err?.message || "Transcription failed");
    if (err?.status) e.status = err.status;
    e.cause = err;
    if (err?.stack) {
      e.stack = `${e.stack}\nCaused by: ${err.stack}`;
    }
    throw e;
  }

  // 2) Extract transcript text from common response shapes
  const transcriptText =
    cloudRunData?.transcript ||
    null;

  if (!transcriptText || typeof transcriptText !== "string") {
    const e = new Error("Transcription returned no transcript text");
    e.status = 500;
    e.cloudRunData = cloudRunData;
    throw e;
  }

  // 3) Mask PHI
  let maskResult;
  try {
    maskResult = await mask_phi(transcriptText);
  } catch (err) {
    // Log full error + stack before wrapping/propagating
    console.error("mask_phi error:", err?.message || err);
    console.error(err?.stack || err);

    // preserve original error as cause and include original stack
    const e = new Error(err?.message || "Masking PHI failed");
    if (err?.status) e.status = err.status;
    e.cause = err;
    if (err?.stack) {
      e.stack = `${e.stack}\nCaused by: ${err.stack}`;
    }
    throw e;
  }

  // If maskResult is a fetch Response-like object, try to read .ok/.json
  if (maskResult && typeof maskResult === "object" && "ok" in maskResult && typeof maskResult.ok === "boolean") {
    if (!maskResult.ok) {
      const e = new Error("Mask PHI endpoint returned failure");
      e.status = 500;
      e.details = maskResult;
      throw e;
    }
    // attempt to normalize to JSON body if available
    if (typeof maskResult.json === "function") {
      const body = await maskResult.json();
      return { cloudRunData, maskResult: body };
    }
  }

  // Return structured result for callers
  return { cloudRunData, maskResult };
}

// Keep existing HTTP handler for backward compatibility, but use new function
export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { recording_file_signed_url } = req.body || {};
    
    // Use the new enhanced function - it will handle authentication internally
    const result = await transcribe_expand_mask({ 
      recording_file_signed_url, 
      req
    });
    
    return res.status(200).json({ 
      ok: true, 
      ...result 
    });
  } catch (err) {
    console.error("/api/gcp/transcribe/complete error:", err);
    const status = err?.status || 400;
    const payload = { error: err?.message || String(err) };
    if (err?.cloudRunData) payload.cloudRunData = err.cloudRunData;
    if (err?.details) payload.details = err.details;
    return res.status(status).json(payload);
  }
}