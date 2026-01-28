/**
 * GCP Transcription Controller
 * 
 * Fastify handlers for the complete transcription pipeline:
 * - Audio transcription via Cloud Run
 * - Dot phrase expansion (Aho-Corasick algorithm)
 * - PHI masking (AWS integration)
 */

import { transcribe_recording } from '../../utils/transcribeHelper.js';
import { mask_phi } from '../../utils/maskPhiHelper.js';
import { authenticateRequest } from '../../utils/authenticateRequest.js';
import { getAllDotPhrasesForUser } from './dotPhrasesController.js';
import { getSupabaseClient } from '../../utils/supabase.js';

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
    
    // Notated expansion for LLM - only add prefix for explicit dot phrase triggers, not auto-expansions
    let notatedExpansion;
    if (match.isAutoExpanded) {
      // Auto-expansions (from contractions/abbreviations) don't get the prefix
      notatedExpansion = cleanExpansion;
    } else {
      // Explicit dot phrase triggers get the prefix
      notatedExpansion = `{(This is the doctor's autofilled dotPhrase, place extra emphasis on this section of the transcript.) ${match.expansion}(end dotPhrase)}`;
    }
    llmNotatedText = llmNotatedText.substring(0, match.start) + notatedExpansion + llmNotatedText.substring(match.end);
    
    appliedExpansions.push({
      trigger: match.trigger,
      originalText: originalText,
      expansion: match.expansion,
      isAutoExpanded: match.isAutoExpanded,
      startIndex: match.start
    });

    console.log(`[expandDotPhrases] Replaced "${originalText}" at index ${match.start} with expansion${match.isAutoExpanded ? ' (auto-expanded)' : ''}`);
  }

  console.log(`[expandDotPhrases] Successfully applied ${appliedExpansions.length} expansions`);
  appliedExpansions.forEach(exp => {
    console.log(`  - "${exp.originalText}" → "${exp.expansion}"`);
  });

  return { expanded: expandedText, llm_notated: llmNotatedText };
}

/**
 * Builds multiple versions of each trigger and maps them to their expansions
 * Tracks whether each version is an original trigger or an auto-expanded version
 * @private
 * @param {Array} dotPhrases - Array of dot phrase objects
 * @returns {Map} - Map of trigger versions to their expansion data (with isAutoExpanded flag)
 */
function buildTriggerVersions(dotPhrases) {
  const triggerMap = new Map();
  
  for (const dotPhrase of dotPhrases) {
    const trigger = dotPhrase.trigger?.trim();
    const expansion = dotPhrase.expansion?.trim();
    
    if (!trigger || !expansion) continue;

    const versions = [];
    
    // Version 1: Original trigger (lowercase) - NOT auto-expanded
    versions.push({ version: trigger.toLowerCase(), isAutoExpanded: false });
    
    // Version 2: No punctuation except apostrophes - NOT auto-expanded
    const noPunct = trigger.replace(/[^\w'\s-]/g, '').toLowerCase().trim();
    if (noPunct && noPunct !== trigger.toLowerCase()) {
      versions.push({ version: noPunct, isAutoExpanded: false });
    }
    
    // Version 3: Contractions expanded (e.g., "don't" becomes "do not")
    // This is for matching contracted forms in the transcript - marked as auto-expanded
    const contractionsExpanded = expandContractions(noPunct);
    if (contractionsExpanded && contractionsExpanded !== trigger.toLowerCase() && contractionsExpanded !== noPunct) {
      versions.push({ version: contractionsExpanded, isAutoExpanded: true });
    }
    
    // Version 4: Abbreviations expanded for matching purposes ONLY
    // (e.g., match "pt" and also "patient" if user typed it out)
    // Marked as auto-expanded since it's from abbreviation expansion
    const abbrevExpanded = expandAbbreviations(trigger.toLowerCase());
    if (abbrevExpanded && abbrevExpanded !== trigger.toLowerCase() && !versions.some(v => v.version === abbrevExpanded)) {
      versions.push({ version: abbrevExpanded, isAutoExpanded: true });
    }

    // Add all unique versions to map
    const uniqueVersions = [];
    const seenVersions = new Set();
    for (const item of versions) {
      if (!seenVersions.has(item.version)) {
        seenVersions.add(item.version);
        uniqueVersions.push(item);
      }
    }
    
    for (const item of uniqueVersions) {
      if (item.version.length > 0) {
        triggerMap.set(item.version, {
          originalTrigger: trigger,
          expansion: expansion,
          isAutoExpanded: item.isAutoExpanded
        });
      }
    }
  }

  return triggerMap;
}

/**
 * Expands common contractions
 * @private
 * @param {string} text - Text to expand
 * @returns {string} - Expanded text
 */
function expandContractions(text) {
  const contractions = {
    "don't": "do not",
    "doesn't": "does not",
    "didn't": "did not",
    "won't": "will not",
    "wouldn't": "would not",
    "can't": "cannot",
    "couldn't": "could not",
    "shouldn't": "should not",
    "isn't": "is not",
    "aren't": "are not",
    "wasn't": "was not",
    "weren't": "were not",
    "haven't": "have not",
    "hasn't": "has not",
    "hadn't": "had not",
    "i'm": "i am",
    "you're": "you are",
    "he's": "he is",
    "she's": "she is",
    "it's": "it is",
    "we're": "we are",
    "they're": "they are",
    "i've": "i have",
    "you've": "you have",
    "we've": "we have",
    "they've": "they have",
    "i'll": "i will",
    "you'll": "you will",
    "he'll": "he will",
    "she'll": "she will",
    "it'll": "it will",
    "we'll": "we will",
    "they'll": "they will"
  };

  let result = text.toLowerCase();
  for (const [contraction, expansion] of Object.entries(contractions)) {
    result = result.replace(new RegExp(contraction, 'gi'), expansion);
  }
  return result;
}

/**
 * Expands common medical abbreviations
 * @private
 * @param {string} text - Text to expand
 * @returns {string} - Expanded text
 */
function expandAbbreviations(text) {
  const abbreviations = {
    'pt': 'patient',
    'pts': 'patients',
    'hx': 'history',
    'sx': 'symptoms',
    'dx': 'diagnosis',
    'tx': 'treatment',
    'rx': 'prescription',
    'px': 'prognosis',
    'h&p': 'history and physical',
    'a&p': 'assessment and plan',
    'hvd': 'hypertensive disease',
    'cad': 'coronary artery disease',
    'chf': 'congestive heart failure',
    'copd': 'chronic obstructive pulmonary disease',
    'dm': 'diabetes mellitus',
    'htn': 'hypertension',
    'gerd': 'gastroesophageal reflux disease',
    'nka': 'no known allergies',
    'asap': 'as soon as possible',
    'bid': 'twice a day',
    'tid': 'three times a day',
    'qid': 'four times a day'
  };

  let result = text.toLowerCase();
  for (const [abbrev, expansion] of Object.entries(abbreviations)) {
    result = result.replace(new RegExp(`\\b${abbrev}\\b`, 'gi'), expansion);
  }
  return result;
}

/**
 * Builds an Aho-Corasick automaton for multi-pattern string matching
 * @private
 * @param {Array<string>} patterns - Array of trigger patterns
 * @returns {Object} - Root node of the automaton
 */
function buildAhoCorasick(patterns) {
  const root = { children: {}, failure: null, patterns: [] };

  // Step 1: Build trie
  for (const pattern of patterns) {
    let node = root;
    for (const char of pattern) {
      if (!node.children[char]) {
        node.children[char] = { children: {}, failure: null, patterns: [] };
      }
      node = node.children[char];
    }
    node.patterns.push(pattern);
  }

  // Step 2: Build failure links using BFS
  const queue = [];
  
  // Initialize failure links for depth 1
  for (const char in root.children) {
    root.children[char].failure = root;
    queue.push(root.children[char]);
  }

  // BFS to assign failure links
  while (queue.length > 0) {
    const node = queue.shift();

    for (const char in node.children) {
      const child = node.children[char];
      let failNode = node.failure;

      while (failNode && !failNode.children[char]) {
        failNode = failNode.failure;
      }

      child.failure = failNode?.children[char] || root;

      // Inherit patterns from failure link
      if (child.failure.patterns.length > 0) {
        child.patterns = [...new Set([...child.patterns, ...child.failure.patterns])];
      }

      queue.push(child);
    }
  }

  return root;
}

/**
 * Finds all pattern matches in text using Aho-Corasick automaton
 * @private
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
              expansion: triggerData.expansion,
              isAutoExpanded: triggerData.isAutoExpanded
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
 * @private
 * @param {string} char - Character to check
 * @returns {boolean} - True if character is a word boundary
 */
function isWordBoundary(char) {
  return /\W/.test(char);
}

/**
 * Removes overlapping matches, prioritizing longer matches
 * @private
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
 * @param {Object} opts.req - Fastify request object for authentication
 * @param {boolean} [opts.enableDotPhraseExpansion=true] - whether to perform dot phrase expansion
 * @returns {Promise<{ cloudRunData: any, dotPhrasesData: any, expandedTranscript: string, maskResult: any }>}
 */
export async function transcribe_expand_mask({ 
  recording_file_signed_url, 
  req,
  enableDotPhraseExpansion = true 
} = {}) {
  if (!recording_file_signed_url || typeof recording_file_signed_url !== 'string') {
    const e = new Error('recording_file_signed_url is required');
    e.status = 400;
    throw e;
  }

  // Require req parameter
  if (!req) {
    const e = new Error('req is required');
    e.status = 400;
    throw e;
  }

  // Authenticate user
  const { user, error: authError } = await authenticateRequest(req);
  if (authError || !user) {
    const e = new Error('Authentication failed');
    e.status = 401;
    throw e;
  }

  console.log('Step 1: Starting parallel transcription and dot phrase fetching');
  
  // 1) Run transcription and dot phrase fetching in parallel
  const [transcriptionResult, dotPhrasesResult] = await Promise.allSettled([
    transcribe_recording({ recording_file_signed_url, user }),
    enableDotPhraseExpansion ? getAllDotPhrasesForUser(user.id, getSupabaseClient(req.headers.authorization)) : Promise.resolve({ success: true, data: [], error: null })
  ]);

  // 2) Handle transcription result
  let cloudRunData;
  if (transcriptionResult.status === 'rejected') {
    const err = transcriptionResult.reason;
    console.error('transcribe_recording error:', err?.message || err);
    console.error(err?.stack || err);

    const e = new Error(err?.message || 'Transcription failed');
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
  if (!originalTranscript || typeof originalTranscript !== 'string') {
    const e = new Error('Transcription returned no transcript text');
    e.status = 500;
    e.cloudRunData = cloudRunData;
    throw e;
  }

  console.log('Step 2: Transcription completed, processing dot phrases');

  // 4) Handle dot phrases result
  let dotPhrasesData = [];
  let expandedTranscript = originalTranscript; // Clean version for user
  let llmNotatedText = originalTranscript; // Notated version for LLM/masking

  if (enableDotPhraseExpansion) {
    if (dotPhrasesResult.status === 'rejected') {
      console.warn('Warning: Failed to fetch dot phrases, skipping expansion:', dotPhrasesResult.reason?.message || dotPhrasesResult.reason);
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
        console.warn('Warning: Dot phrases fetch returned error, skipping expansion:', dotPhrasesResponse.error);
        dotPhrasesData = [];
      }
    }
  } else {
    console.log('Step 3: Dot phrase expansion disabled, skipping');
  }

  console.log('Step 4: Masking PHI');

  // 5) Mask PHI on the LLM-notated text (with dot phrase emphasis)
  let maskResult;
  try {
    maskResult = await mask_phi(llmNotatedText);
  } catch (err) {
    // Log full error + stack before wrapping/propagating
    console.error('mask_phi error:', err?.message || err);
    console.error(err?.stack || err);

    // preserve original error as cause and include original stack
    const e = new Error(err?.message || 'Masking PHI failed');
    if (err?.status) e.status = err.status;
    e.cause = err;
    if (err?.stack) {
      e.stack = `${e.stack}\nCaused by: ${err.stack}`;
    }
    throw e;
  }

  // If maskResult is a fetch Response-like object, try to read .ok/.json
  if (maskResult && typeof maskResult === 'object' && 'ok' in maskResult && typeof maskResult.ok === 'boolean') {
    if (!maskResult.ok) {
      const e = new Error('Mask PHI endpoint returned failure');
      e.status = 500;
      e.details = maskResult;
      throw e;
    }
    // attempt to normalize to JSON body if available
    if (typeof maskResult.json === 'function') {
      const body = await maskResult.json();
      return { cloudRunData, dotPhrasesData, expandedTranscript, maskResult: body };
    }
  }

  // Return structured result for callers
  return { cloudRunData, dotPhrasesData, expandedTranscript, maskResult };
}

/**
 * Alternative version for internal use (without authentication requirement)
 * @param {string} recording_file_signed_url - Recording URL
 * @returns {Promise<Object>} - Same as transcribe_expand_mask
 */
export async function transcribe_and_mask(recording_file_signed_url) {
  if (!recording_file_signed_url || typeof recording_file_signed_url !== 'string') {
    throw new Error('recording_file_signed_url is required');
  }

  // This version does not require a request object
  const cloudRunData = await transcribe_recording({ recording_file_signed_url });
  const maskResult = await mask_phi(cloudRunData?.transcript || '');

  return { cloudRunData, maskResult };
}

/**
 * Fastify route handler for POST /api/gcp/transcribe/complete
 * @param {Object} request - Fastify request object
 * @param {Object} reply - Fastify reply object
 */
export async function handler(request, reply) {
  const startTime = Date.now();
  try {
    const { recording_file_signed_url, enableDotPhraseExpansion = true } = request.body || {};
    
    console.log(`[transcribeController.handler] Starting transcription for: ${recording_file_signed_url?.substring(0, 200)}...`);
    console.log(`[transcribeController.handler] User: ${request.user?.id}`);
    
    // Use the transcribe_expand_mask function - it will handle authentication internally
    const result = await transcribe_expand_mask({ 
      recording_file_signed_url, 
      req: request,
      enableDotPhraseExpansion
    });
    
    const elapsed = Date.now() - startTime;
    console.log(`[transcribeController.handler] ✓ Completed in ${elapsed}ms`);
    
    return reply.status(200).send({ 
      ok: true, 
      ...result 
    });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`[transcribeController.handler] ✗ Error after ${elapsed}ms:`, err.message);
    console.error(`[transcribeController.handler] Error stack:`, err.stack);
    
    const status = err?.status || 500;
    const payload = { error: err?.message || String(err) };
    if (err?.cloudRunData) payload.cloudRunData = err.cloudRunData;
    if (err?.details) payload.details = err.details;
    
    return reply.status(status).send(payload);
  }
}
/**
 * Fastify route handler for POST /api/gcp/expand
 * Tests dot phrase expansion logic with provided transcript and dot phrases
 * Useful for unit testing expansion without requiring real transcriptions
 * 
 * @param {Object} request - Fastify request object
 * @param {Object} reply - Fastify reply object
 */
export async function expandHandler(request, reply) {
  const startTime = Date.now();
  try {
    const { transcript, dotPhrases = [], enableDotPhraseExpansion = true } = request.body || {};
    
    console.log(`[expandHandler] Expanding transcript with ${dotPhrases.length} dot phrases`);
    
    let expanded = transcript;
    let llm_notated = transcript;
    
    // Perform expansion if enabled
    if (enableDotPhraseExpansion && dotPhrases.length > 0) {
      const result = expandDotPhrases(transcript, dotPhrases);
      expanded = result.expanded;
      llm_notated = result.llm_notated;
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`[expandHandler] ✓ Expansion completed in ${elapsed}ms`);
    
    return reply.status(200).send({ 
      ok: true, 
      expanded,
      llm_notated,
      dotPhrasesApplied: enableDotPhraseExpansion ? dotPhrases.length : 0
    });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`[expandHandler] ✗ Error after ${elapsed}ms:`, err.message);
    
    const status = err?.status || 500;
    const payload = { error: err?.message || String(err) };
    
    return reply.status(status).send(payload);
  }
}