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
        if (signInResponse?.session?.access_token) {
          realAccessToken = signInResponse.session.access_token;
          console.log('✅ Obtained real access token for validation tests\n');
        }
      } catch (error) {
        console.log('⚠️  Could not get real token, using mock tests only\n');
      }
    }
  }

  // Test 1: Get all patient encounters without auth (should fail)
  await runner.test('Get patient encounters without auth', {
    method: 'GET',
    endpoint: '/api/patient-encounters',
    expectedStatus: 401,
  });

  // Test 2: Get all patient encounters with invalid token (should fail)
  await runner.test('Get patient encounters with invalid token', {
    method: 'GET',
    endpoint: '/api/patient-encounters',
    headers: {
      Authorization: `Bearer ${MOCK_TOKEN}`,
    },
    expectedStatus: 401,
  });

  // Test 3: Create patient encounter without auth (should fail)
  await runner.test('Create patient encounter without auth', {
    method: 'POST',
    endpoint: '/api/patient-encounters',
    body: mockEncounterData,
    expectedStatus: 401,
  });

  // Test 4: Create patient encounter with invalid token (should fail)
  await runner.test('Create patient encounter with invalid token', {
    method: 'POST',
    endpoint: '/api/patient-encounters',
    body: mockEncounterData,
    headers: {
      Authorization: `Bearer ${MOCK_TOKEN}`,
    },
    expectedStatus: 401,
  });

  // Test 5: Create patient encounter with missing required fields (uses real token to test validation)
  await runner.test('Create patient encounter with missing fields', {
    method: 'POST',
    endpoint: '/api/patient-encounters',
    body: {
      name: 'Test Patient',
      // missing other optional fields
    },
    headers: {
      Authorization: realAccessToken ? `Bearer ${realAccessToken}` : `Bearer ${MOCK_TOKEN}`,
    },
    expectedStatus: realAccessToken ? 201 : 401,
  });

  // Test 6: Get single patient encounter without auth (should fail)
  await runner.test('Get specific encounter without auth', {
    method: 'GET',
    endpoint: '/api/patient-encounters/test-id',
    expectedStatus: 401,
  });

  // Test 7: Mark encounter as complete without auth (should fail)
  await runner.test('Mark encounter as complete without auth', {
    method: 'POST',
    endpoint: '/api/patient-encounters/complete',
    body: { encounterId: 'test-id', notes: 'Test notes' },
    expectedStatus: 401,
  });

  // Test 8: Batch operations without auth (should fail)
  await runner.test('Batch patient encounters without auth', {
    method: 'POST',
    endpoint: '/api/patient-encounters/batch',
    body: {
      action: 'delete',
      ids: ['id1', 'id2'],
    },
    expectedStatus: 401,
  });

  // Test 9: Invalid batch action (requires valid token to reach validation)
  await runner.test('Batch with invalid action', {
    method: 'POST',
    endpoint: '/api/patient-encounters/batch',
    body: {
      action: 'invalid-action',
      ids: ['id1'],
    },
    headers: realAccessToken ? {
      Authorization: `Bearer ${realAccessToken}`,
    } : undefined,
    expectedStatus: realAccessToken ? 400 : 401,
  });

  // Test 10: Batch with missing IDs (requires valid token to reach validation)
  await runner.test('Batch with missing IDs', {
    method: 'POST',
    endpoint: '/api/patient-encounters/batch',
    body: {
      action: 'delete',
      // missing ids array
    },
    headers: realAccessToken ? {
      Authorization: `Bearer ${realAccessToken}`,
    } : undefined,
    expectedStatus: realAccessToken ? 400 : 401,
  });

  // ===========================================
  // REAL ACCOUNT TESTS (if configured)
  // ===========================================

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

        if (signInResponse && signInResponse.session && signInResponse.session.access_token) {
          accessToken = signInResponse.session.access_token;
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
        // Test 11: Get patient encounters with real account
        await runner.test('Get patient encounters (authenticated user)', {
          method: 'GET',
          endpoint: '/api/patient-encounters',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          expectedStatus: 200,
        });

        // Test 12: Create patient encounter with real account
        let createdEncounterId = null;
        const createTest = await runner.test('Create patient encounter (authenticated user)', {
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
        });
        
        // Track the created encounter for cleanup
        if (createTest.passed && createTest.body.id) {
          createdEncounterId = createTest.body.id;
          createdEncounterIds.push(createdEncounterId);
        }

        // Test 13: Verify encounter count increases by 1 (independent test)
        console.log('  [Test 13] Verifying encounter count increases...\n');
        
        // Get count before (use large limit to get all)
        const getBeforeTest = await fetch(`${runner.baseUrl}/api/patient-encounters?limit=1000`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const dataBeforeResponse = await getBeforeTest.json();
        const countBefore = Array.isArray(dataBeforeResponse) ? dataBeforeResponse.length : 0;
        console.log(`    Count before: ${countBefore}`);
        
        // Create a new encounter
        const createForCountTest = await fetch(`${runner.baseUrl}/api/patient-encounters`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            name: 'Count Test Patient',
          }),
        });
        const createdForCount = await createForCountTest.json();
        const countTestEncounterId = createdForCount.id;
        
        // Track for cleanup
        if (countTestEncounterId) {
          createdEncounterIds.push(countTestEncounterId);
        }
        
        // Get count after (use large limit to get all)
        const getAfterTest = await fetch(`${runner.baseUrl}/api/patient-encounters?limit=1000`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const dataAfterResponse = await getAfterTest.json();
        const countAfter = Array.isArray(dataAfterResponse) ? dataAfterResponse.length : 0;
        console.log(`    Count after: ${countAfter}`);
        
        // Verify count increased by 1
        const countIncreased = countAfter === countBefore + 1;
        const testResult = {
          name: 'Verify encounter count increased by 1',
          passed: countIncreased,
          endpoint: '/api/patient-encounters',
          method: 'GET + POST + GET',
          status: countIncreased ? 'Pass' : 'Fail',
          expectedStatus: 'count should increase by 1',
          body: { countBefore, countAfter, increased: countIncreased },
          timestamp: new Date().toISOString(),
        };
        
        // Add to results manually
        runner.results.push(testResult);
        
        if (countIncreased) {
          console.log(`    ✅ Count verification passed: ${countBefore} → ${countAfter} (+1)\n`);
        } else {
          console.log(`    ❌ Count verification failed: Expected ${countBefore + 1}, got ${countAfter}\n`);
        }

        // Test 14: Get specific encounter by real ID to verify GET works
        console.log(`  [Test 14] Getting specific encounter ID: ${countTestEncounterId}`);
        const getSpecificResponse = await fetch(`${runner.baseUrl}/api/patient-encounters/${countTestEncounterId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const getSpecificData = await getSpecificResponse.json();
        const getSpecificPassed = getSpecificResponse.ok && getSpecificData.id === countTestEncounterId && getSpecificData.name;
        
        const getSpecificResult = {
          name: 'Get specific encounter by real ID',
          passed: getSpecificPassed,
          endpoint: `/api/patient-encounters/${countTestEncounterId}`,
          method: 'GET',
          status: getSpecificResponse.status,
          expectedStatus: 200,
          body: getSpecificPassed ? { id: getSpecificData.id, name: getSpecificData.name } : getSpecificData,
          timestamp: new Date().toISOString(),
        };
        
        runner.results.push(getSpecificResult);
        console.log(`    ${getSpecificPassed ? '✅' : '❌'} Status: ${getSpecificResponse.status}, ID matches: ${getSpecificData.id === countTestEncounterId}\n`);

        // Test 14B: DELETE diagnostic test - Check if DELETE endpoint works and what it returns
        console.log(`  [Test 14B] DIAGNOSTIC: Attempting DELETE on ID: ${countTestEncounterId}`);
        const deleteResponse = await fetch(`${runner.baseUrl}/api/patient-encounters/${countTestEncounterId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const deleteData = deleteResponse.ok ? await deleteResponse.json() : await deleteResponse.text();
        
        console.log(`    DELETE Response Status: ${deleteResponse.status}`);
        // console.log(`    DELETE Response Body: ${JSON.stringify(deleteData)}`);
        // console.log(`    DELETE Response Headers: ${JSON.stringify(Object.fromEntries(deleteResponse.headers.entries()))}\n`);
        
        const deleteResult = {
          name: 'DELETE diagnostic test',
          passed: deleteResponse.ok,
          endpoint: `/api/patient-encounters/${countTestEncounterId}`,
          method: 'DELETE',
          status: deleteResponse.status,
          expectedStatus: 200,
          fullResponse: {
            status: deleteResponse.status,
            statusText: deleteResponse.statusText,
            headers: Object.fromEntries(deleteResponse.headers.entries()),
            body: deleteData,
          },
          timestamp: new Date().toISOString(),
        };
        runner.results.push(deleteResult);
        
        // Verify if it was actually deleted by trying to GET it again
        console.log(`  [Test 14C] DIAGNOSTIC: Verifying if DELETE actually removed the record`);
        const verifyDeleteResponse = await fetch(`${runner.baseUrl}/api/patient-encounters/${countTestEncounterId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const verifyDeleteData = await verifyDeleteResponse.json();
        const wasActuallyDeleted = verifyDeleteResponse.status === 404;
        
        console.log(`    After DELETE, GET status: ${verifyDeleteResponse.status}`);
        console.log(`    Record still exists: ${!wasActuallyDeleted}`);
        if (!wasActuallyDeleted) {
          console.log(`    Record data: ${JSON.stringify(verifyDeleteData)}\n`);
        } else {
          console.log(`    Record successfully deleted\n`);
        }
        
        const verifyDeleteResult = {
          name: 'DELETE verification - record actually removed',
          passed: wasActuallyDeleted,
          endpoint: `/api/patient-encounters/${countTestEncounterId}`,
          method: 'GET (after DELETE)',
          status: verifyDeleteResponse.status,
          expectedStatus: 404,
          body: wasActuallyDeleted ? { message: 'Record deleted' } : verifyDeleteData,
          timestamp: new Date().toISOString(),
        };
        runner.results.push(verifyDeleteResult);

        // Test 15: Get patient encounters with filters
        await runner.test('Get patient encounters with query params', {
          method: 'GET',
          endpoint: '/api/patient-encounters?limit=5&offset=0',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          expectedStatus: 200,
        });

        // Test 16: Invalid encounter ID format
        await runner.test('Get encounter with invalid ID format', {
          method: 'GET',
          endpoint: '/api/patient-encounters/invalid-id-format',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          expectedStatus: 400,
        });

        // Test 16: Non-existent encounter
        await runner.test('Get non-existent encounter', {
          method: 'GET',
          endpoint: '/api/patient-encounters/999999999999',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          expectedStatus: 404,
        });

        // Test 17: Mark encounter as complete with invalid ID format
        await runner.test('Mark encounter as complete with invalid ID format', {
          method: 'POST',
          endpoint: '/api/patient-encounters/complete',
          body: {
            encounterId: 'invalid-id-format',
            notes: 'Appointment completed successfully',
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          expectedStatus: 400, // Invalid ID format
        });

        // Test 18: Batch delete encounters
        await runner.test('Batch delete encounters (empty list)', {
          method: 'POST',
          endpoint: '/api/patient-encounters/batch',
          body: {
            action: 'delete',
            ids: [],
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          expectedStatus: 400, // Might fail due to empty list validation
        });

        // Test 18: Update patient encounter (using created encounter from Test 12)
        if (createdEncounterId) {
          await runner.test('Update encounter (with valid ID)', {
            method: 'PATCH',
            endpoint: `/api/patient-encounters/${createdEncounterId}`,
            body: {
              name: 'Updated Integration Test Patient',
            },
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            expectedStatus: 200,
          });
        }

        // Test 20: Update patient encounter (non-existent ID - validation test)
        await runner.test('Update encounter (non-existent)', {
          method: 'PATCH',
          endpoint: '/api/patient-encounters/invalid-id',
          body: {
            name: 'Updated Name',
            reason: 'Updated reason',
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          expectedStatus: 400, // Invalid ID format
        });

        // Test 21: Get complete patient encounter (with all linked data)
        // PLACEHOLDER: Full SOAP notes functionality migration pending
        if (createdEncounterId) {
          await runner.test('Get complete patient encounter bundle (with all linked data)', {
            method: 'GET',
            endpoint: `/api/patient-encounters/complete/${createdEncounterId}`,
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            expectedStatus: 200,
            expectedFields: ['patientEncounter', 'recording', 'transcript', 'soapNotes'],
          });
        }

        // Test 22: Get complete patient encounter with invalid ID format
        await runner.test('Get complete patient encounter (invalid ID format)', {
          method: 'GET',
          endpoint: '/api/patient-encounters/complete/invalid-id',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          expectedStatus: 400,
        });

        // Test 23: Get complete patient encounter with non-existent ID
        await runner.test('Get complete patient encounter (non-existent)', {
          method: 'GET',
          endpoint: '/api/patient-encounters/complete/999999',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          expectedStatus: 404,
        });

        // Test 24: Get complete patient encounter without auth
        await runner.test('Get complete patient encounter (no auth)', {
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

  // Cleanup: Delete all test data created during the test run
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
