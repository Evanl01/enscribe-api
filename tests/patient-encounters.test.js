/**
 * Test Suite: Patient Encounters API
 * Tests all patient encounter endpoints: CRUD operations, batch, complete, filtering
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env.local
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env.local');
dotenv.config({ path: envPath });

import { TestRunner } from './testUtils.js';
import { getTestAccount, hasTestAccounts } from './testConfig.js';

const runner = new TestRunner('Patient Encounters API Tests');

// Mock token for invalid auth tests
const MOCK_TOKEN = 'invalid.token.here';

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
  console.log('Server: http://localhost:3001\n');

  // Track suite-level count for cleanup verification
  let suiteCountBefore = null;
  let realAccessToken = null;
  let createdEncounterIds = [];

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

      let accessToken = null;
      let createdEncounterId = null;

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
          accessToken = signInResponse.token.access_token;
          console.log('  ✅ Successfully obtained access token\n');
          
          // Get initial count before any tests create data
          try {
            const getCountResponse = await fetch(`${runner.baseUrl}/api/patient-encounters`, {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${accessToken}`,
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

      if (accessToken) {
        // ===== TEST 7: Get patient encounters (authenticated user) =====
        await runner.test('Test 7: Get patient encounters (authenticated user)', {
          method: 'GET',
          endpoint: '/api/patient-encounters',
          headers: {
            Authorization: `Bearer ${accessToken}`,
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
            Authorization: `Bearer ${accessToken}`,
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
            Authorization: `Bearer ${accessToken}`,
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
              Authorization: `Bearer ${accessToken}`,
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
              Authorization: `Bearer ${accessToken}`,
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
            Authorization: `Bearer ${accessToken}`,
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
            Authorization: `Bearer ${accessToken}`,
          },
          expectedStatus: 404,
        });



        // ===== TEST 14: Create complete patient encounter bundle (with all linked data) =====
        // This test creates a new encounter with recording, transcript, and SOAP note in one request
        const completeBundle = {
          patientEncounter: {
            name: 'Complete Bundle Test Patient',
          },
          recording: {
            recording_file_name: 'test-recording-' + Date.now() + '.wav',
            recording_duration: 300,
            recording_file_size: 2400000,
            recording_file_path: '/test-recordings/test-' + Date.now() + '.wav',
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
            Authorization: `Bearer ${accessToken}`,
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
              Authorization: `Bearer ${accessToken}`,
            },
            expectedStatus: 200,
            expectedFields: ['patientEncounter', 'recording', 'transcript', 'soapNotes'],
            onSuccess: (data) => {
              // Print full response for debugging
              console.log(`\n    📋 Full Test 17 Response:\n${JSON.stringify(data, null, 2)}\n`);
              
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
                console.log(`    ⚠️  WARNING: Found encrypted_name instead of name`);
              }
              if (data.transcript && !data.transcript.transcript_text && data.transcript.encrypted_transcript) {
                console.log(`    ⚠️  WARNING: Found encrypted_transcript instead of transcript_text`);
              }
            },
          });
        }

        // ===== TEST 16: DELETE complete encounter (DEPENDENT ON TEST 15) =====
        if (completeBundleEncounterId) {
          await runner.test('Test 16: DELETE complete encounter (DEPENDENT ON TEST 15)', {
            method: 'DELETE',
            endpoint: `/api/patient-encounters/${completeBundleEncounterId}`,
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            expectedStatus: 200,
          });
        } else {
          console.log('⊘ Test 16: SKIPPED (Test 15 dependency failed - no complete bundle encounter created)\n');
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
            Authorization: `Bearer ${accessToken}`,
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
            Authorization: `Bearer ${accessToken}`,
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
            Authorization: `Bearer ${accessToken}`,
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
            Authorization: `Bearer ${accessToken}`,
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
