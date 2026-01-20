/**
 * Test Suite: Patient Encounters API
 * Tests all patient encounter endpoints: CRUD operations, batch, complete, filtering
 * Also includes transcript-related endpoints:
 * - PATCH /api/patient-encounters/:id/transcript (transcript-only update)
 * - PATCH /api/patient-encounters/:id/update-with-transcript (compound update with rollback)
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Load .env.local
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env.local');
dotenv.config({ path: envPath });

import { TestRunner } from './testUtils.js';
import { getTestAccount, hasTestAccounts } from './testConfig.js';
import { createClient } from '@supabase/supabase-js';

const runner = new TestRunner('Patient Encounters API Tests');

// Mock token for invalid auth tests
const MOCK_TOKEN = 'invalid.token.here';

// Load test data
const TEST_DATA_FILE = path.resolve(__dirname, 'testData.json');
let testData = null;

function loadTestData() {
  if (!fs.existsSync(TEST_DATA_FILE)) {
    // Optional - not required for basic CRUD tests
    return null;
  }

  try {
    const data = fs.readFileSync(TEST_DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.warn(`  ⚠️  Could not load testData.json: ${error.message}`);
    return null;
  }
}

/**
 * Helper: Fetch real recording files from Supabase storage
 * Returns the first available recording file path for use in tests
 */
async function getFirstRealRecordingFile(accessToken) {
  try {
    // Create authenticated Supabase client with the user's token
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        auth: { persistSession: false },
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      }
    );

    // Get the current user from Supabase auth
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user || !user.id) {
      console.warn('  ⚠️  Could not get user from token');
      return null;
    }

    // List files in the user's directory in the audio-files bucket
    const { data, error } = await supabase.storage
      .from('audio-files')
      .list(`${user.id}`, { limit: 100 });

    if (error) {
      console.warn(`  ⚠️  Error listing storage files: ${error.message}`);
      return null;
    }

    // Get the first audio file
    if (!data || data.length === 0) {
      console.warn('  ⚠️  No recording files found in Supabase storage');
      return null;
    }

    const firstFile = data[0];
    const recordingPath = `${user.id}/${firstFile.name}`;
    console.log(`  ✓ Using real recording file: ${recordingPath}`);
    return recordingPath;
  } catch (error) {
    console.warn(`  ⚠️  Error fetching real recording file: ${error.message}`);
    return null;
  }
}

// Track created test data for cleanup
const createdEncounterIds = [];

// Test data for creating encounters
// Only includes fields in the patientEncounter schema
const mockEncounterData = {
  name: 'Test Patient',
};

/**
 * Helper: Clean up test encounters after tests complete
 * Deletes all encounters created during the test run
 */
async function cleanupTestEncounters(accessToken) {
  if (createdEncounterIds.length === 0) return;
  
  console.log(`\n  [Cleanup] Deleting ${createdEncounterIds.length} created test encounters...`);
  
  let successCount = 0;
  let failedIds = [];
  
  for (const id of createdEncounterIds) {
    try {
      const response = await fetch(`${runner.baseUrl}/api/patient-encounters/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.log(`  ⚠️  Failed to delete encounter ${id}: ${response.status} ${response.statusText}`);
        if (errorData.error) console.log(`       Error: ${errorData.error}`);
        failedIds.push(id);
      } else {
        successCount++;
      }
    } catch (error) {
      console.log(`  ⚠️  Could not delete encounter ${id}:`, error.message);
      failedIds.push(id);
    }
  }
  
  if (failedIds.length === 0) {
    console.log(`  ✅ Cleanup complete - all ${successCount} encounters deleted\n`);
  } else {
    console.log(`  ⚠️  Cleanup partial - deleted ${successCount}, failed ${failedIds.length}\n`);
  }
}

/**
 * Run all patient encounter tests
 */
async function runPatientEncounterTests() {
  console.log('Starting Patient Encounters API tests...');
  console.log(`Server: ${runner.baseUrl}\n`);

  // Track suite-level count for cleanup verification
  let suiteCountBefore = null;
  let realAccessToken = null;
  let createdEncounterId = null;  // Current encounter ID for dependent tests
  let createdEncounterIds = [];   // Array of all created IDs for cleanup

  // Get real token early if test account is configured
  if (hasTestAccounts()) {
    const testAccount = getTestAccount('primary');
    if (testAccount && testAccount.email && testAccount.password) {
      try {
        const response = await fetch(`${runner.baseUrl}/api/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sign-in',
            email: testAccount.email,
            password: testAccount.password,
          }),
        });
        const signInResponse = await response.json();
        if (signInResponse?.token?.access_token) {
          realAccessToken = signInResponse.token.access_token;
          console.log('✅ Obtained real access token for validation tests\n');
        }
      } catch (error) {
        console.log('⚠️  Could not get real token, using mock tests only\n');
      }
    }
  }

  // ===== TEST 1: Get patient encounters without auth =====
  await runner.test('Test 1: Get patient encounters without auth', {
    method: 'GET',
    endpoint: '/api/patient-encounters',
    expectedStatus: 401,
  });

  // ===== TEST 2: Get patient encounters with invalid token =====
  await runner.test('Test 2: Get patient encounters with invalid token', {
    method: 'GET',
    endpoint: '/api/patient-encounters',
    headers: {
      Authorization: `Bearer ${MOCK_TOKEN}`,
    },
    expectedStatus: 401,
  });

  // ===== TEST 3: Create patient encounter without auth =====
  await runner.test('Test 3: Create patient encounter without auth', {
    method: 'POST',
    endpoint: '/api/patient-encounters',
    body: mockEncounterData,
    expectedStatus: 401,
  });

  // ===== TEST 4: Create patient encounter with invalid token =====
  await runner.test('Test 4: Create patient encounter with invalid token', {
    method: 'POST',
    endpoint: '/api/patient-encounters',
    body: mockEncounterData,
    headers: {
      Authorization: `Bearer ${MOCK_TOKEN}`,
    },
    expectedStatus: 401,
  });

  // ===== TEST 5: Create patient encounter with missing required name field =====
  await runner.test('Test 5: Create patient encounter with missing required name field', {
    method: 'POST',
    endpoint: '/api/patient-encounters',
    body: {},
    headers: {
      Authorization: realAccessToken ? `Bearer ${realAccessToken}` : `Bearer ${MOCK_TOKEN}`,
    },
    expectedStatus: realAccessToken ? 400 : 401,
    validator: realAccessToken ? (data) => {
      if (!data.error) return { valid: false, reason: 'Missing error field' };
      if (data.error.name !== 'ZodError') return { valid: false, reason: `Expected ZodError, got ${data.error.name}` };
      if (!data.error.message.includes('name')) return { valid: false, reason: 'Error message should mention name field' };
      return { valid: true };
    } : undefined,
  });

  // ===== TEST 6: Get specific encounter without auth =====
  await runner.test('Test 6: Get specific encounter without auth', {
    method: 'GET',
    endpoint: '/api/patient-encounters/test-id',
    expectedStatus: 401,
  });

  if (hasTestAccounts()) {
    const testAccount = getTestAccount('primary');

    if (testAccount && testAccount.email && testAccount.password) {
      console.log(`\n📝 Running real account tests with: ${testAccount.email.split('@')[0]}@****\n`);

      // First: Sign-in to get access token
      console.log('  [Setup] Signing in to get access token...\n');
      try {
        const response = await fetch(`${runner.baseUrl}/api/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sign-in',
            email: testAccount.email,
            password: testAccount.password,
          }),
        });
        const signInResponse = await response.json();

        if (signInResponse && signInResponse.token && signInResponse.token.access_token) {
          realAccessToken = signInResponse.token.access_token;
          console.log('  ✅ Successfully obtained access token\n');
          
          // Get initial count before any tests create data
          try {
            const getCountResponse = await fetch(`${runner.baseUrl}/api/patient-encounters`, {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${realAccessToken}`,
              },
            });
            const countData = await getCountResponse.json();
            suiteCountBefore = Array.isArray(countData) ? countData.length : 0;
            console.log(`  📊 Suite initial encounter count: ${suiteCountBefore}\n`);
          } catch (error) {
            console.log(`  ⚠️  Could not get initial count: ${error.message}\n`);
          }
        } else {
          console.log('  ⚠️  Could not extract access token from sign-in response\n');
        }
      } catch (error) {
        console.log('  ⚠️  Sign-in failed:', error.message, '\n');
      }

      if (realAccessToken) {
        // ===== TEST 7: Get patient encounters (authenticated user) =====
        await runner.test('Test 7: Get patient encounters (authenticated user)', {
          method: 'GET',
          endpoint: '/api/patient-encounters',
          headers: {
            Authorization: `Bearer ${realAccessToken}`,
          },
          expectedStatus: 200,
        });

        // ===== TEST 8: Create patient encounter (authenticated user) =====
        await runner.test('Test 8: Create patient encounter (authenticated user)', {
          method: 'POST',
          endpoint: '/api/patient-encounters',
          body: {
            name: 'Integration Test Patient',
          },
          headers: {
            Authorization: `Bearer ${realAccessToken}`,
          },
          expectedStatus: 201,
          expectedFields: ['id', 'name', 'created_at', 'updated_at', 'user_id'],
          onSuccess: (data) => {
            // Store the created encounter ID for dependent tests
            if (data.id) {
              createdEncounterId = data.id;
              createdEncounterIds.push(data.id);
              console.log(`    Created encounter ID: ${data.id}`);
            }
          },
        });

        // ===== TEST 9: Get patient encounters with query params =====
        await runner.test('Test 9: Get patient encounters with query params', {
          method: 'GET',
          endpoint: '/api/patient-encounters?limit=5&offset=0',
          headers: {
            Authorization: `Bearer ${realAccessToken}`,
          },
          expectedStatus: 200,
        });

        // ===== TEST 10: PATCH encounter (DEPENDENT ON TEST 8) =====
        let test10Passed = false;
        if (createdEncounterId) {
          await runner.test('Test 10: PATCH encounter to update name (DEPENDENT ON TEST 8)', {
            method: 'PATCH',
            endpoint: `/api/patient-encounters/${createdEncounterId}`,
            body: {
              name: 'Updated Integration Test Patient',
            },
            headers: {
              Authorization: `Bearer ${realAccessToken}`,
            },
            expectedStatus: 200,
            expectedFields: ['id', 'name', 'updated_at'],
            onSuccess: () => {
              test10Passed = true;
            },
          });
        } else {
          console.log('⊘ Test 10: SKIPPED (Test 8 dependency failed - no encounter created)\n');
        }

        // ===== TEST 11: DELETE encounter (DEPENDENT ON TEST 10) =====
        if (createdEncounterId && test10Passed) {
          await runner.test('Test 11: DELETE encounter (DEPENDENT ON TEST 10)', {
            method: 'DELETE',
            endpoint: `/api/patient-encounters/${createdEncounterId}`,
            headers: {
              Authorization: `Bearer ${realAccessToken}`,
            },
            expectedStatus: 200,
          });
        } else {
          console.log('⊘ Test 11: SKIPPED (Test 10 dependency failed)\n');
        }

        // ===== TEST 12: Get encounter with invalid ID format =====
        await runner.test('Test 12: Get encounter with invalid ID format', {
          method: 'GET',
          endpoint: '/api/patient-encounters/invalid-id-format',
          headers: {
            Authorization: `Bearer ${realAccessToken}`,
          },
          expectedStatus: 400,
          validator: (data) => {
            if (!data.error) return { valid: false, reason: 'Missing error field' };
            if (!data.error.includes('Invalid ID format')) return { valid: false, reason: 'Error should indicate invalid ID format' };
            return { valid: true };
          },
        });

        // ===== TEST 13: Get non-existent encounter =====
        await runner.test('Test 13: Get non-existent encounter', {
          method: 'GET',
          endpoint: '/api/patient-encounters/999999999999',
          headers: {
            Authorization: `Bearer ${realAccessToken}`,
          },
          expectedStatus: 404,
        });



        // ===== TEST 14: Create complete patient encounter bundle (with all linked data) =====
        // This test creates a new encounter with recording, transcript, and SOAP note in one request
        // First, fetch a real recording file from Supabase storage
        let realRecordingPath = null;
        if (realAccessToken) {
          realRecordingPath = await getFirstRealRecordingFile(realAccessToken);
        }

        // Default bundle for tests that don't need real recording files (e.g., auth tests)
        let completeBundle = {
          patientEncounter: {
            name: 'Complete Bundle Test Patient',
          },
          recording: {
            recording_file_name: 'default-recording.wav',
            recording_duration: 300,
            recording_file_size: 2400000,
            recording_file_path: '/test-recordings/default.wav',
          },
          transcript: {
            transcript_text: 'This is a test transcript for the complete bundle test.',
            confidence_score: 0.95,
          },
          soapNote_text: {
            soapNote: {
              subjective: 'Patient reports feeling better',
              objective: 'Vital signs stable',
              assessment: 'Improvement noted',
              plan: 'Continue current treatment',
            },
            billingSuggestion: 'CPT 99214',
          },
        };

        if (!realRecordingPath) {
          console.log('⊘ Test 14: SKIPPED (No real recording files found in Supabase storage)\n');
        } else {
          // Update completeBundle with the real recording file for Test 14
          completeBundle = {
            patientEncounter: {
              name: 'Complete Bundle Test Patient',
            },
            recording: {
              recording_file_name: realRecordingPath.split('/').pop(),
              recording_duration: 300,
              recording_file_size: 2400000,
              recording_file_path: realRecordingPath,
            },
            transcript: {
              transcript_text: 'This is a test transcript for the complete bundle test.',
              confidence_score: 0.95,
            },
            soapNote_text: {
              soapNote: {
                subjective: 'Patient reports feeling better',
                objective: 'Vital signs stable',
                assessment: 'Improvement noted',
                plan: 'Continue current treatment',
              },
              billingSuggestion: 'CPT 99214',
            },
          };

          let completeBundleEncounterId = null;
          await runner.test('Test 14: Create complete patient encounter bundle (POST)', {
            method: 'POST',
            endpoint: '/api/patient-encounters/complete',
            body: completeBundle,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${realAccessToken}`,
            },
          expectedStatus: 201,
          expectedFields: ['patientEncounter', 'recording', 'transcript', 'soapNote'],
          onSuccess: (data) => {
            // Extract and track the created encounter ID for dependent tests
            if (data.patientEncounter && data.patientEncounter.id) {
              completeBundleEncounterId = data.patientEncounter.id;
              createdEncounterIds.push(completeBundleEncounterId);
              console.log(`    Created complete bundle encounter ID: ${completeBundleEncounterId}`);
            }
          },
          });

          // ===== TEST 15: Get the created complete bundle (GET) =====
          if (completeBundleEncounterId) {
            await runner.test('Test 15: Get complete patient encounter bundle (verify creation)', {
              method: 'GET',
              endpoint: `/api/patient-encounters/complete/${completeBundleEncounterId}`,
              headers: {
                Authorization: `Bearer ${realAccessToken}`,
              },
              expectedStatus: 200,
            expectedFields: ['patientEncounter', 'recording', 'transcript', 'soapNotes'],
            customValidator: (data) => {
              // Print full response for debugging
              console.log(`\n    📋 Full Test 15 Response:\n${JSON.stringify(data, null, 2)}\n`);
              
              // Check for encryption fields that should be cleaned
              if (data.patientEncounter) {
                const encryptedFields = Object.keys(data.patientEncounter).filter(k => 
                  k.includes('encrypted') || k.includes('iv')
                );
                if (encryptedFields.length > 0) {
                  console.log(`    ⚠️  WARNING: Encryption fields found in patientEncounter: ${encryptedFields.join(', ')}`);
                } else {
                  console.log(`    ✓ No encryption fields in patientEncounter`);
                }
              }
              
              // Check for proper field names
              if (data.patientEncounter && !data.patientEncounter.name && data.patientEncounter.encrypted_name) {
                return { passed: false, message: 'Found encrypted_name instead of name - decryption failed' };
              }
              if (data.transcript && !data.transcript.transcript_text && data.transcript.encrypted_transcript) {
                return { passed: false, message: 'Found encrypted_transcript instead of transcript_text - decryption failed' };
              }
              
              // ===== STRICT VALIDATION: Signed URL Generation =====
              // Validate that the signed URL was generated and refreshed
              if (!data.recording) {
                return { passed: false, message: 'Missing recording object' };
              }
              
              const recording = data.recording;
              
              // Check signed URL exists (should be auto-generated in Step 1.5)
              if (!recording.recording_file_signed_url) {
                return { passed: false, message: 'Recording missing recording_file_signed_url (should be auto-generated in getCompletePatientEncounter)' };
              }
              
              // Check signed URL is valid (contains Supabase domain)
              if (!recording.recording_file_signed_url.includes('supabase.co')) {
                return { passed: false, message: 'Signed URL does not appear valid (missing supabase.co domain)' };
              }
              
              // Check signed URL is HTTPS
              if (!recording.recording_file_signed_url.startsWith('https://')) {
                return { passed: false, message: 'Signed URL must be HTTPS' };
              }
              
              // Check expiry timestamp exists
              if (!recording.recording_file_signed_url_expiry) {
                return { passed: false, message: 'Recording missing recording_file_signed_url_expiry (should be set with signed URL)' };
              }
              
              // Check expiry is fresh (not in the past)
              const expiryDate = new Date(recording.recording_file_signed_url_expiry);
              const now = new Date();
              if (isNaN(expiryDate.getTime())) {
                return { passed: false, message: 'Signed URL expiry is not a valid date: ' + recording.recording_file_signed_url_expiry };
              }
              if (expiryDate <= now) {
                return { passed: false, message: 'Signed URL is already expired (expiry: ' + recording.recording_file_signed_url_expiry + ')' };
              }
              
              // Check file path exists
              if (!recording.recording_file_path) {
                return { passed: false, message: 'Recording missing recording_file_path' };
              }
              
              console.log(`    ✓ Recording has valid signed URL: ${recording.recording_file_signed_url.substring(0, 100)}...`);
              console.log(`    ✓ Signed URL expires at: ${recording.recording_file_signed_url_expiry}`);
              
              return { passed: true, message: 'Recording has valid signed URL and expiry (Step 1.5 working correctly)' };
            },
            });
          }

          // ===== TEST 16: DELETE complete encounter (DEPENDENT ON TEST 15) =====
          if (completeBundleEncounterId) {
            await runner.test('Test 16: DELETE complete encounter (DEPENDENT ON TEST 15)', {
              method: 'DELETE',
              endpoint: `/api/patient-encounters/${completeBundleEncounterId}`,
              headers: {
                Authorization: `Bearer ${realAccessToken}`,
              },
              expectedStatus: 200,
            });
          } else {
            console.log('⊘ Test 16: SKIPPED (Test 15 dependency failed - no complete bundle encounter created)\n');
          }
        }

        // ===== TEST 17: Missing required field validation =====
        // Attempts to create bundle without patient name (required field)
        await runner.test('Test 17: Create complete encounter with missing patientEncounter.name (should fail)', {
          method: 'POST',
          endpoint: '/api/patient-encounters/complete',
          body: {
            patientEncounter: {
              // Missing required 'name' field
            },
            recording: {
              recording_file_name: 'test.wav',
              recording_duration: 300,
              recording_file_size: 2400000,
              recording_file_path: '/test.wav',
            },
            transcript: {
              transcript_text: 'Test transcript',
              confidence_score: 0.95,
            },
            soapNote_text: {
              soapNote: {
                subjective: 'Test',
                objective: 'Test',
                assessment: 'Test',
                plan: 'Test',
              },
            },
          },
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${realAccessToken}`,
          },
          expectedStatus: 400,
          validator: (data) => {
            if (!data.error) return { valid: false, reason: 'Missing error field' };
            if (data.error.name !== 'ZodError') return { valid: false, reason: `Expected ZodError, got ${data.error.name}` };
            if (!data.error.message.includes('name')) return { valid: false, reason: 'Error message should mention name field' };
            return { valid: true };
          },
        });

        // ===== TEST 18: Invalid soapNote_text type enforcement =====
        // Attempts to send string instead of object for soapNote_text (strict type checking)
        await runner.test('Test 18: Create complete encounter with invalid soapNote_text type (should fail)', {
          method: 'POST',
          endpoint: '/api/patient-encounters/complete',
          body: {
            patientEncounter: {
              name: 'Type Validation Test',
            },
            recording: {
              recording_file_name: 'test.wav',
              recording_duration: 300,
              recording_file_size: 2400000,
              recording_file_path: '/test.wav',
            },
            transcript: {
              transcript_text: 'Test',
              confidence_score: 0.95,
            },
            soapNote_text: 'This should be an object, not a string',
          },
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${realAccessToken}`,
          },
          expectedStatus: 400,
          validator: (data) => {
            if (!data.error) return { valid: false, reason: 'Missing error field' };
            if (data.error.name !== 'ZodError') return { valid: false, reason: `Expected ZodError, got ${data.error.name}` };
            if (!data.error.message.includes('soapNote_text')) return { valid: false, reason: 'Error message should mention soapNote_text field' };
            return { valid: true };
          },
        });

        // ===== TEST 19: Auth required for POST =====
        // Attempts to create bundle without JWT token
        await runner.test('Test 19: Create complete encounter without auth (should fail)', {
          method: 'POST',
          endpoint: '/api/patient-encounters/complete',
          body: completeBundle,
          expectedStatus: 401,
        });

        // ===== TEST 20: Invalid ID format on GET =====
        await runner.test('Test 20: Get complete patient encounter (invalid ID format)', {
          method: 'GET',
          endpoint: '/api/patient-encounters/complete/invalid-format',
          headers: {
            Authorization: `Bearer ${realAccessToken}`,
          },
          expectedStatus: 400,
          validator: (data) => {
            if (!data.error) return { valid: false, reason: 'Missing error field' };
            if (!data.error.includes('Invalid ID format')) return { valid: false, reason: 'Error should indicate invalid ID format' };
            return { valid: true };
          },
        });

        // ===== TEST 21: Non-existent encounter on GET =====
        await runner.test('Test 21: Get complete patient encounter (non-existent)', {
          method: 'GET',
          endpoint: '/api/patient-encounters/complete/999999999999',
          headers: {
            Authorization: `Bearer ${realAccessToken}`,
          },
          expectedStatus: 404,
        });

        // ===== TEST 22: Auth required for GET =====
        await runner.test('Test 22: Get complete patient encounter (no auth)', {
          method: 'GET',
          endpoint: '/api/patient-encounters/complete/test-id',
          expectedStatus: 401,
        });
      }
    }
  } else {
    console.log('\n⚠️  Test accounts not configured. Skipping real credential tests.');
    console.log('To enable: Add TEST_ACCOUNT_EMAIL and TEST_ACCOUNT_PASSWORD to .env.local\n');
  }

  // ========================================
  // TRANSCRIPT ENDPOINT TESTS
  // ========================================
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('📋 Patient Encounter Transcript Tests');
  console.log('═══════════════════════════════════════════════════════\n');

  // Load test data for transcript tests
  testData = loadTestData();
  let testEncounterId = null;
  let testTranscriptId = null;

  if (testData) {
    // Find an encounter that has a linked transcript (created during setup)
    // Setup creates transcripts for first 2 recordings, which are attached to first 2 encounters
    if (testData.encounters && testData.transcripts && testData.encounters.length > 0) {
      // Find first encounter that has a transcript linked to its recording
      const encounterWithTranscript = testData.encounters.find(enc => 
        enc.recording_id && testData.transcripts.some(t => t.recording_id === enc.recording_id)
      );
      
      if (encounterWithTranscript) {
        testEncounterId = encounterWithTranscript.id;
        // Find the transcript for this encounter's recording
        const linkedTranscript = testData.transcripts.find(t => t.recording_id === encounterWithTranscript.recording_id);
        if (linkedTranscript) {
          testTranscriptId = linkedTranscript.id;
          console.log(`✓ Found encounter with linked transcript:`);
          console.log(`  - Encounter ID: ${testEncounterId}`);
          console.log(`  - Transcript ID: ${testTranscriptId}\n`);
        }
      } else if (testData.encounters.length > 0) {
        // Fallback: use first encounter (may not have transcript)
        testEncounterId = testData.encounters[0].id;
        console.log(`✓ Found test encounter ID from testData.json: ${testEncounterId}`);
      }
    } else if (testData.encounters && testData.encounters.length > 0) {
      testEncounterId = testData.encounters[0].id;
      console.log(`✓ Found test encounter ID from testData.json: ${testEncounterId}`);
    }
    
    if (testData.transcripts && testData.transcripts.length > 0 && !testTranscriptId) {
      testTranscriptId = testData.transcripts[0].id;
      console.log(`✓ Found test transcript ID from testData.json: ${testTranscriptId}\n`);
    }
  } else {
    console.log('⚠️  testData.json not available. Run setup first: npm run test:setup\n');
  }

  // ========================================
  // PATCH /patient-encounters/:id/transcript
  // ========================================

  // Test 23: PATCH /patient-encounters/:id/transcript without auth
  if (testEncounterId) {
    await runner.test('Test 23: PATCH /patient-encounters/:id/transcript without auth (should fail)', {
      method: 'PATCH',
      endpoint: `/api/patient-encounters/${testEncounterId}/transcript`,
      body: {
        transcript_text: 'Updated transcript text',
      },
      expectedStatus: 401,
      expectedFields: ['error'],
    });
  } else {
    runner.results.push({
      name: 'Test 23: PATCH /patient-encounters/:id/transcript without auth (should fail)',
      passed: false,
      endpoint: `/api/patient-encounters/[id]/transcript`,
      method: 'PATCH',
      status: null,
      expectedStatus: 401,
      body: {},
      customMessage: '⚠️  SKIPPED: No test encounter available (run npm run test:setup)',
      testNumber: 23,
      timestamp: new Date().toISOString(),
    });
    console.log('\n⚠️  Test 23: PATCH /patient-encounters/:id/transcript without auth');
    console.log('    ⚠️  SKIPPED: No test encounter available (run npm run test:setup)');
  }

  // Test 24: PATCH /patient-encounters/:id/transcript with invalid token
  if (testEncounterId) {
    await runner.test('Test 24: PATCH /patient-encounters/:id/transcript with invalid token (should fail)', {
      method: 'PATCH',
      endpoint: `/api/patient-encounters/${testEncounterId}/transcript`,
      headers: {
        Authorization: `Bearer ${MOCK_TOKEN}`,
      },
      body: {
        transcript_text: 'Updated transcript text',
      },
      expectedStatus: 401,
    });
  } else {
    runner.results.push({
      name: 'Test 24: PATCH /patient-encounters/:id/transcript with invalid token (should fail)',
      passed: false,
      endpoint: `/api/patient-encounters/[id]/transcript`,
      method: 'PATCH',
      status: null,
      expectedStatus: 401,
      body: {},
      customMessage: '⚠️  SKIPPED: No test encounter available',
      testNumber: 24,
      timestamp: new Date().toISOString(),
    });
    console.log('\n⚠️  Test 24: PATCH /patient-encounters/:id/transcript with invalid token');
    console.log('    ⚠️  SKIPPED: No test encounter available');
  }

  // Test 25: PATCH /patient-encounters/:id/transcript - missing transcript_text
  if (realAccessToken && testEncounterId) {
    await runner.test('Test 25: PATCH /patient-encounters/:id/transcript with missing transcript_text (should fail)', {
      method: 'PATCH',
      endpoint: `/api/patient-encounters/${testEncounterId}/transcript`,
      headers: {
        Authorization: `Bearer ${realAccessToken}`,
      },
      body: {},
      expectedStatus: 400,
      expectedFields: ['error'],
      validator: (data) => {
        if (!data.error) return { valid: false, reason: 'Missing error field' };
        if (data.error.name !== 'ZodError') return { valid: false, reason: `Expected ZodError, got ${data.error.name}` };
        if (!data.error.message.includes('transcript_text')) return { valid: false, reason: 'Error message should mention transcript_text field' };
        return { valid: true };
      },
    });
  } else {
    runner.results.push({
      name: 'Test 25: PATCH /patient-encounters/:id/transcript with missing transcript_text (should fail)',
      passed: false,
      endpoint: `/api/patient-encounters/[id]/transcript`,
      method: 'PATCH',
      status: null,
      expectedStatus: 400,
      body: {},
      customMessage: '⚠️  SKIPPED: Missing auth token or encounter ID',
      testNumber: 25,
      timestamp: new Date().toISOString(),
    });
    console.log('\n⚠️  Test 25: PATCH /patient-encounters/:id/transcript with missing transcript_text');
    console.log('    ⚠️  SKIPPED: Missing auth token or encounter ID');
  }

  // Test 26: PATCH /patient-encounters/:id/transcript - valid update
  if (realAccessToken && testEncounterId && testTranscriptId) {
    await runner.test('Test 26: PATCH /patient-encounters/:id/transcript with valid update (should succeed)', {
      method: 'PATCH',
      endpoint: `/api/patient-encounters/${testEncounterId}/transcript`,
      headers: {
        Authorization: `Bearer ${realAccessToken}`,
      },
      body: {
        transcript_text: 'Updated transcript text for testing with new content.',
      },
      expectedStatus: 200,
    });
  } else {
    runner.results.push({
      name: 'Test 26: PATCH /patient-encounters/:id/transcript with valid update (should succeed)',
      passed: false,
      endpoint: `/api/patient-encounters/[id]/transcript`,
      method: 'PATCH',
      status: null,
      expectedStatus: 200,
      body: {},
      customMessage: '⚠️  SKIPPED: Missing auth token, encounter ID, or transcript ID',
      testNumber: 26,
      timestamp: new Date().toISOString(),
    });
    console.log('\n⚠️  Test 26: PATCH /patient-encounters/:id/transcript with valid update');
    console.log('    ⚠️  SKIPPED: Missing auth token, encounter ID, or transcript ID');
  }

  // Test 27: PATCH /patient-encounters/:id/transcript - not found
  if (realAccessToken) {
    await runner.test('Test 27: PATCH /patient-encounters/:id/transcript with non-existent ID (should fail)', {
      method: 'PATCH',
      endpoint: '/api/patient-encounters/99999/transcript',
      headers: {
        Authorization: `Bearer ${realAccessToken}`,
      },
      body: {
        transcript_text: 'Update text',
      },
      expectedStatus: 404,
    });
  } else {
    runner.results.push({
      name: 'Test 27: PATCH /patient-encounters/:id/transcript with non-existent ID (should fail)',
      passed: false,
      endpoint: '/api/patient-encounters/99999/transcript',
      method: 'PATCH',
      status: null,
      expectedStatus: 404,
      body: {},
      customMessage: '⚠️  SKIPPED: Missing auth token',
      testNumber: 27,
      timestamp: new Date().toISOString(),
    });
    console.log('\n⚠️  Test 27: PATCH /patient-encounters/:id/transcript with non-existent ID');
    console.log('    ⚠️  SKIPPED: Missing auth token');
  }

  // ======================================================
  // PATCH /patient-encounters/:id/update-with-transcript
  // ======================================================

  // Test 28: PATCH /patient-encounters/:id/update-with-transcript without auth
  if (testEncounterId) {
    await runner.test('Test 28: PATCH /patient-encounters/:id/update-with-transcript without auth (should fail)', {
      method: 'PATCH',
      endpoint: `/api/patient-encounters/${testEncounterId}/update-with-transcript`,
      body: {
        name: 'Updated Name',
        transcript_text: 'Updated transcript text',
      },
      expectedStatus: 401,
      expectedFields: ['error'],
    });
  } else {
    runner.results.push({
      name: 'Test 28: PATCH /patient-encounters/:id/update-with-transcript without auth (should fail)',
      passed: false,
      endpoint: `/api/patient-encounters/[id]/update-with-transcript`,
      method: 'PATCH',
      status: null,
      expectedStatus: 401,
      body: {},
      customMessage: '⚠️  SKIPPED: No test encounter available',
      testNumber: 28,
      timestamp: new Date().toISOString(),
    });
    console.log('\n⚠️  Test 28: PATCH /patient-encounters/:id/update-with-transcript without auth');
    console.log('    ⚠️  SKIPPED: No test encounter available');
  }

  // Test 29: PATCH /patient-encounters/:id/update-with-transcript with invalid token
  if (testEncounterId) {
    await runner.test('Test 29: PATCH /patient-encounters/:id/update-with-transcript with invalid token (should fail)', {
      method: 'PATCH',
      endpoint: `/api/patient-encounters/${testEncounterId}/update-with-transcript`,
      headers: {
        Authorization: `Bearer ${MOCK_TOKEN}`,
      },
      body: {
        name: 'Updated Name',
        transcript_text: 'Updated transcript text',
      },
      expectedStatus: 401,
    });
  } else {
    runner.results.push({
      name: 'Test 29: PATCH /patient-encounters/:id/update-with-transcript with invalid token (should fail)',
      passed: false,
      endpoint: `/api/patient-encounters/[id]/update-with-transcript`,
      method: 'PATCH',
      status: null,
      expectedStatus: 401,
      body: {},
      customMessage: '⚠️  SKIPPED: No test encounter available',
      testNumber: 29,
      timestamp: new Date().toISOString(),
    });
    console.log('\n⚠️  Test 29: PATCH /patient-encounters/:id/update-with-transcript with invalid token');
    console.log('    ⚠️  SKIPPED: No test encounter available');
  }

  // Test 30: PATCH /patient-encounters/:id/update-with-transcript - missing both fields
  if (realAccessToken && testEncounterId) {
    await runner.test('Test 30: PATCH /patient-encounters/:id/update-with-transcript with missing both fields (should fail)', {
      method: 'PATCH',
      endpoint: `/api/patient-encounters/${testEncounterId}/update-with-transcript`,
      headers: {
        Authorization: `Bearer ${realAccessToken}`,
      },
      body: {},
      expectedStatus: 400,
      expectedFields: ['error'],
      validator: (data) => {
        if (!data.error) return { valid: false, reason: 'Missing error field' };
        if (data.error.name !== 'ZodError') return { valid: false, reason: `Expected ZodError, got ${data.error.name}` };
        return { valid: true };
      },
    });
  } else {
    runner.results.push({
      name: 'Test 30: PATCH /patient-encounters/:id/update-with-transcript with missing both fields (should fail)',
      passed: false,
      endpoint: `/api/patient-encounters/[id]/update-with-transcript`,
      method: 'PATCH',
      status: null,
      expectedStatus: 400,
      body: {},
      customMessage: '⚠️  SKIPPED: Missing auth token or encounter ID',
      testNumber: 30,
      timestamp: new Date().toISOString(),
    });
    console.log('\n⚠️  Test 30: PATCH /patient-encounters/:id/update-with-transcript with missing both fields');
    console.log('    ⚠️  SKIPPED: Missing auth token or encounter ID');
  }

  // Test 31: PATCH /patient-encounters/:id/update-with-transcript - missing name
  if (realAccessToken && testEncounterId) {
    await runner.test('Test 31: PATCH /patient-encounters/:id/update-with-transcript with missing name (should fail)', {
      method: 'PATCH',
      endpoint: `/api/patient-encounters/${testEncounterId}/update-with-transcript`,
      headers: {
        Authorization: `Bearer ${realAccessToken}`,
      },
      body: {
        transcript_text: 'Updated transcript text',
      },
      expectedStatus: 400,
      expectedFields: ['error'],
      validator: (data) => {
        if (!data.error) return { valid: false, reason: 'Missing error field' };
        if (data.error.name !== 'ZodError') return { valid: false, reason: `Expected ZodError, got ${data.error.name}` };
        if (!data.error.message.includes('name')) return { valid: false, reason: 'Error message should mention name field' };
        return { valid: true };
      },
    });
  } else {
    runner.results.push({
      name: 'Test 31: PATCH /patient-encounters/:id/update-with-transcript with missing name (should fail)',
      passed: false,
      endpoint: `/api/patient-encounters/[id]/update-with-transcript`,
      method: 'PATCH',
      status: null,
      expectedStatus: 400,
      body: {},
      customMessage: '⚠️  SKIPPED: Missing auth token or encounter ID',
      testNumber: 31,
      timestamp: new Date().toISOString(),
    });
    console.log('\n⚠️  Test 31: PATCH /patient-encounters/:id/update-with-transcript with missing name');
    console.log('    ⚠️  SKIPPED: Missing auth token or encounter ID');
  }

  // Test 32: PATCH /patient-encounters/:id/update-with-transcript - missing transcript_text
  if (realAccessToken && testEncounterId) {
    await runner.test('Test 32: PATCH /patient-encounters/:id/update-with-transcript with missing transcript_text (should fail)', {
      method: 'PATCH',
      endpoint: `/api/patient-encounters/${testEncounterId}/update-with-transcript`,
      headers: {
        Authorization: `Bearer ${realAccessToken}`,
      },
      body: {
        name: 'Updated Name',
      },
      expectedStatus: 400,
      expectedFields: ['error'],
      validator: (data) => {
        if (!data.error) return { valid: false, reason: 'Missing error field' };
        if (data.error.name !== 'ZodError') return { valid: false, reason: `Expected ZodError, got ${data.error.name}` };
        if (!data.error.message.includes('transcript_text')) return { valid: false, reason: 'Error message should mention transcript_text field' };
        return { valid: true };
      },
    });
  } else {
    runner.results.push({
      name: 'Test 32: PATCH /patient-encounters/:id/update-with-transcript with missing transcript_text (should fail)',
      passed: false,
      endpoint: `/api/patient-encounters/[id]/update-with-transcript`,
      method: 'PATCH',
      status: null,
      expectedStatus: 400,
      body: {},
      customMessage: '⚠️  SKIPPED: Missing auth token or encounter ID',
      testNumber: 32,
      timestamp: new Date().toISOString(),
    });
    console.log('\n⚠️  Test 32: PATCH /patient-encounters/:id/update-with-transcript with missing transcript_text');
    console.log('    ⚠️  SKIPPED: Missing auth token or encounter ID');
  }

  // Test 33: PATCH /patient-encounters/:id/update-with-transcript - valid compound update
  if (realAccessToken && testEncounterId) {
    await runner.test('Test 33: PATCH /patient-encounters/:id/update-with-transcript with valid compound update (should succeed)', {
      method: 'PATCH',
      endpoint: `/api/patient-encounters/${testEncounterId}/update-with-transcript`,
      headers: {
        Authorization: `Bearer ${realAccessToken}`,
      },
      body: {
        name: 'Updated Encounter Name',
        transcript_text: 'Updated transcript text with both fields.',
      },
      expectedStatus: 200,
      validator: (data) => {
        if (!data.success) return { valid: false, reason: 'Expected success: true' };
        if (!data.data) return { valid: false, reason: 'Expected data object' };
        if (!data.data.patientEncounter) return { valid: false, reason: 'Expected patientEncounter in data' };
        if (!data.data.transcript) return { valid: false, reason: 'Expected transcript in data' };
        return { valid: true };
      },
    });
  } else {
    runner.results.push({
      name: 'Test 33: PATCH /patient-encounters/:id/update-with-transcript with valid compound update (should succeed)',
      passed: false,
      endpoint: `/api/patient-encounters/[id]/update-with-transcript`,
      method: 'PATCH',
      status: null,
      expectedStatus: 200,
      body: {},
      customMessage: '⚠️  SKIPPED: Missing auth token or encounter ID',
      testNumber: 33,
      timestamp: new Date().toISOString(),
    });
    console.log('\n⚠️  Test 33: PATCH /patient-encounters/:id/update-with-transcript with valid compound update');
    console.log('    ⚠️  SKIPPED: Missing auth token or encounter ID');
  }

  // Test 34: PATCH /patient-encounters/:id/update-with-transcript - not found
  if (realAccessToken) {
    await runner.test('Test 34: PATCH /patient-encounters/:id/update-with-transcript with non-existent ID (should fail)', {
      method: 'PATCH',
      endpoint: '/api/patient-encounters/99999/update-with-transcript',
      headers: {
        Authorization: `Bearer ${realAccessToken}`,
      },
      body: {
        name: 'Updated Name',
        transcript_text: 'Updated transcript text',
      },
      expectedStatus: 404,
    });
  } else {
    runner.results.push({
      name: 'Test 34: PATCH /patient-encounters/:id/update-with-transcript with non-existent ID (should fail)',
      passed: false,
      endpoint: '/api/patient-encounters/99999/update-with-transcript',
      method: 'PATCH',
      status: null,
      expectedStatus: 404,
      body: {},
      customMessage: '⚠️  SKIPPED: Missing auth token',
      testNumber: 34,
      timestamp: new Date().toISOString(),
    });
    console.log('\n⚠️  Test 34: PATCH /patient-encounters/:id/update-with-transcript with non-existent ID');
    console.log('    ⚠️  SKIPPED: Missing auth token');
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('🧹 Test Suite Cleanup');
  console.log('═══════════════════════════════════════════════════════\n');
  
  if (realAccessToken && createdEncounterIds.length > 0) {
    await cleanupTestEncounters(realAccessToken);
    
    // Verify cleanup worked by checking final count
    try {
      const getFinalResponse = await fetch(`${runner.baseUrl}/api/patient-encounters`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${realAccessToken}`,
        },
      });
      const finalCountData = await getFinalResponse.json();
      const suiteCountAfter = Array.isArray(finalCountData) ? finalCountData.length : 0;
      
      if (suiteCountBefore !== null) {
        console.log('  📊 Suite Encounter Count Verification:');
        console.log(`     Before suite: ${suiteCountBefore}`);
        console.log(`     After suite:  ${suiteCountAfter}`);
        if (suiteCountAfter === suiteCountBefore) {
          console.log('     ✅ Cleanup successful - count restored to original\n');
        } else {
          const orphanedCount = suiteCountAfter - suiteCountBefore;
          console.log(`     ❌ Cleanup FAILED - ${orphanedCount} test encounters still in database\n`);
          console.log('  🔧 Manually delete these test encounter IDs:\n');
          for (const id of createdEncounterIds) {
            console.log(`     - ${id}`);
          }
          console.log('\n  You can delete them by running:');
          console.log(`  curl -X DELETE http://localhost:3001/api/patient-encounters/{id} \\`);
          console.log(`    -H "Authorization: Bearer <access_token>"\n`);
        }
      }
    } catch (error) {
      console.log(`  ❌ Could not verify cleanup: ${error.message}\n`);
      console.log('  🔧 Manually delete these test encounter IDs:\n');
      for (const id of createdEncounterIds) {
        console.log(`     - ${id}`);
      }
      console.log('\n  You can delete them by running:');
      console.log(`  curl -X DELETE http://localhost:3001/api/patient-encounters/{id} \\`);
      console.log(`    -H "Authorization: Bearer <access_token>"\n`);
    }
  } else if (createdEncounterIds.length === 0) {
    console.log('  ℹ️  No test encounters to clean up\n');
  }

  // Print results
  runner.printResults();

  // Save results to file
  const resultsFile = runner.saveResults('patient-encounters-tests.json');
  console.log(`✅ Test results saved to: ${resultsFile}\n`);
  
  // Return summary for master test runner
  return runner.getSummary();
}

// Run tests if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runPatientEncounterTests();
    process.exit(0);
  } catch (error) {
    console.error('Test execution failed:', error);
    process.exit(1);
  }
}

export { runPatientEncounterTests };
