/**
 * Test Suite: Recordings API
 * Tests recordings/attachments endpoint: query validation, filtering, sorting, pagination
 * Requires: npm run test:setup (to create test data)
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

const runner = new TestRunner('Recordings API Tests');

// Mock token for invalid auth tests
const MOCK_TOKEN = 'invalid.token.here';

// Load test data
const TEST_DATA_FILE = path.resolve(__dirname, 'testData.json');
let testData = null;

function loadTestData() {
  if (!fs.existsSync(TEST_DATA_FILE)) {
    console.error('\n❌ Test data file not found!');
    console.error('Run setup first: npm run test:setup\n');
    process.exit(1);
  }

  try {
    const data = fs.readFileSync(TEST_DATA_FILE, 'utf-8');
    testData = JSON.parse(data);
    
    // Verify test data has required structure
    if (!testData.encounters || !testData.recordings) {
      throw new Error('Invalid test data structure');
    }

    return testData;
  } catch (error) {
    console.error('\n❌ Error reading test data:', error.message);
    console.error('Run setup first: npm run test:setup\n');
    process.exit(1);
  }
}

/**
 * Helper: Validate that array is sorted by field in correct order
 */
function isSortedCorrectly(items, field, ascending = true) {
  if (!items || items.length < 2) return true;

  for (let i = 0; i < items.length - 1; i++) {
    const current = items[i][field];
    const next = items[i + 1][field];

    if (current === null || current === undefined || next === null || next === undefined) {
      continue;
    }

    let comparison;
    if (typeof current === 'string') {
      comparison = current.localeCompare(next);
    } else if (typeof current === 'number') {
      comparison = current - next;
    } else {
      // Handle dates
      comparison = new Date(current) - new Date(next);
    }

    if (ascending && comparison > 0) return false;
    if (!ascending && comparison < 0) return false;
  }

  return true;
}

/**
 * Run all recordings API tests
 */
async function runRecordingsTests() {
  // Load test data first
  testData = loadTestData();

  console.log('Starting Recordings API tests...');
  console.log('Server: http://localhost:3001\n');
  console.log('Test Data Loaded:');
  console.log(`  Encounters: ${testData.encounters.length}`);
  console.log(`  Recordings: ${testData.recordings.length} (${testData.recordings.filter(r => r.attached).length} attached, ${testData.recordings.filter(r => !r.attached).length} unattached)\n`);

  // Get valid access token from test account
  let accessToken = null;

  if (hasTestAccounts()) {
    const testAccount = getTestAccount('primary');
    if (testAccount && testAccount.email && testAccount.password) {
      // Sign in to get valid token
      const signInResponse = await fetch(`${runner.baseUrl}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sign-in',
          email: testAccount.email,
          password: testAccount.password,
        }),
      });

      if (signInResponse.ok) {
        const authData = await signInResponse.json();
        accessToken = authData.token.access_token;
        console.log('✓ Obtained valid access token from test account\n');
      } else {
        console.log('⚠️ Could not obtain access token from test account');
      }
    }
  }

  // Test 1: Get recordings without auth
  await runner.test('GET /recordings/attachments without auth', {
    testNumber: 1,
    method: 'GET',
    endpoint: '/api/recordings/attachments?attached=true',
    expectedStatus: 401,
    expectedFields: ['error'],
  });

  // Test 2: Get recordings with invalid token
  await runner.test('GET /recordings/attachments with invalid token', {
    testNumber: 2,
    method: 'GET',
    endpoint: '/api/recordings/attachments?attached=true',
    headers: {
      Authorization: `Bearer ${MOCK_TOKEN}`,
    },
    expectedStatus: 401,
  });

  // Test 3: Missing attached parameter
  if (accessToken) {
    await runner.test('GET /recordings/attachments missing attached parameter', {
      testNumber: 3,
      method: 'GET',
      endpoint: '/api/recordings/attachments',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 400,
      expectedFields: ['error'],
    });
  }

  // Test 4: Invalid attached parameter value
  if (accessToken) {
    await runner.test('GET /recordings/attachments with invalid attached value', {
      testNumber: 4,
      method: 'GET',
      endpoint: '/api/recordings/attachments?attached=maybe',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 400,
      expectedFields: ['error'],
    });
  }

  // Test 5: Invalid sortBy parameter
  if (accessToken) {
    await runner.test('GET /recordings/attachments with invalid sortBy', {
      testNumber: 5,
      method: 'GET',
      endpoint: '/api/recordings/attachments?attached=true&sortBy=invalid_field',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 400,
      expectedFields: ['error'],
    });
  }

  // Test 6: Invalid order parameter
  if (accessToken) {
    await runner.test('GET /recordings/attachments with invalid order', {
      testNumber: 6,
      method: 'GET',
      endpoint: '/api/recordings/attachments?attached=true&order=invalid',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 400,
      expectedFields: ['error'],
    });
  }

  // Test 7: Get attached recordings (valid request)
  if (accessToken) {
    await runner.test('GET /recordings/attachments - attached=true', {
      testNumber: 7,
      method: 'GET',
      endpoint: '/api/recordings/attachments?attached=true',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 200,
    });
  }

  // Test 8: Get unattached recordings (valid request)
  if (accessToken) {
    await runner.test('GET /recordings/attachments - attached=false', {
      testNumber: 8,
      method: 'GET',
      endpoint: '/api/recordings/attachments?attached=false',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 200,
    });
  }

  // Test 9: Pagination with limit parameter
  if (accessToken) {
    await runner.test('GET /recordings/attachments with limit parameter', {
      testNumber: 9,
      method: 'GET',
      endpoint: '/api/recordings/attachments?attached=true&limit=50',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 200,
    });
  }

  // Test 10: Pagination with offset parameter
  if (accessToken) {
    const result = await runner.test('GET /recordings/attachments with offset parameter', {
      testNumber: 10,
      method: 'GET',
      endpoint: '/api/recordings/attachments?attached=true&offset=1',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 200,
    });

    // Validate offset is working - should skip first recording
    if (result.passed && Array.isArray(result.body) && result.body.length > 0) {
      const allResult = await fetch(`${runner.baseUrl}/api/recordings/attachments?attached=true`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }).then(r => r.json());

      const expectedIds = new Set(allResult.slice(1).map(r => r.id));
      const actualIds = new Set(result.body.map(r => r.id));
      
      const offsetWorking = expectedIds.size > 0 && 
        Array.from(expectedIds).every(id => actualIds.has(id));

      if (!offsetWorking) {
        result.passed = false;
        result.body = { error: `Offset not working correctly. Expected ${expectedIds.size} recordings starting from index 1, got ${result.body.length}` };
      }
    }
  }

  // Test 11: Sort by created_at ascending
  if (accessToken) {
    const result = await runner.test('GET /recordings/attachments - sortBy=created_at, order=asc', {
      testNumber: 11,
      method: 'GET',
      endpoint: '/api/recordings/attachments?attached=true&sortBy=created_at&order=asc',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 200,
    });
    
    // Validate actual sort order
    if (result.passed && Array.isArray(result.body) && result.body.length > 0) {
      const isSorted = isSortedCorrectly(result.body, 'db_created_at', true);
      if (!isSorted) {
        result.passed = false;
        result.body = { error: 'Data is not sorted by created_at ascending' };
      }
    }
  }

  // Test 12: Sort by created_at descending
  if (accessToken) {
    const result = await runner.test('GET /recordings/attachments - sortBy=created_at, order=desc', {
      testNumber: 12,
      method: 'GET',
      endpoint: '/api/recordings/attachments?attached=true&sortBy=created_at&order=desc',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 200,
    });
    
    // Validate actual sort order
    if (result.passed && Array.isArray(result.body) && result.body.length > 0) {
      const isSorted = isSortedCorrectly(result.body, 'db_created_at', false);
      if (!isSorted) {
        result.passed = false;
        result.body = { error: 'Data is not sorted by created_at descending' };
      }
    }
  }

  // Test 13: Sort by updated_at ascending
  if (accessToken) {
    const result = await runner.test('GET /recordings/attachments - sortBy=updated_at, order=asc', {
      testNumber: 13,
      method: 'GET',
      endpoint: '/api/recordings/attachments?attached=true&sortBy=updated_at&order=asc',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 200,
    });
    
    // Validate actual sort order
    if (result.passed && Array.isArray(result.body) && result.body.length > 0) {
      const isSorted = isSortedCorrectly(result.body, 'db_updated_at', true);
      if (!isSorted) {
        result.passed = false;
        result.body = { error: 'Data is not sorted by updated_at ascending' };
      }
    }
  }

  // Test 14: Sort by name ascending
  if (accessToken) {
    const result = await runner.test('GET /recordings/attachments - sortBy=name, order=asc', {
      testNumber: 14,
      method: 'GET',
      endpoint: '/api/recordings/attachments?attached=true&sortBy=name&order=asc',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 200,
    });
    
    // Validate actual sort order
    if (result.passed && Array.isArray(result.body) && result.body.length > 0) {
      const isSorted = isSortedCorrectly(result.body, 'path', true);
      if (!isSorted) {
        result.passed = false;
        result.body = { error: 'Data is not sorted by path (name) ascending' };
      }
    }
  }

  // Test 15: Combined - attached with limit, offset, sortBy, order
  if (accessToken) {
    await runner.test('GET /recordings/attachments - combined query parameters', {
      testNumber: 15,
      method: 'GET',
      endpoint: '/api/recordings/attachments?attached=false&limit=25&offset=0&sortBy=created_at&order=desc',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 200,
    });
  }

  // Test 16: Verify attached recordings contain test data
  if (accessToken) {
    const attachedTest = await runner.test('GET /recordings/attachments - verify attached recordings', {
      testNumber: 16,
      method: 'GET',
      endpoint: '/api/recordings/attachments?attached=true',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 200,
    });

    if (attachedTest && attachedTest.status === 200) {
      const attachedRecordings = attachedTest.body || [];
      const apiPaths = new Set(attachedRecordings.map(r => r.path));
      
      // Check 1: All attached recordings from test data are present
      const foundAttached = testData.recordings
        .filter(r => r.attached)
        .every(testRecording => apiPaths.has(testRecording.path));

      // Check 2: No unattached recordings are present (shouldn't be)
      const noUnattachedLeakage = testData.recordings
        .filter(r => !r.attached)
        .every(testRecording => !apiPaths.has(testRecording.path));

      if (foundAttached && noUnattachedLeakage) {
        console.log(`    ✓ All ${testData.recordings.filter(r => r.attached).length} attached recordings found, no unattached leakage`);
        attachedTest.passed = true;
      } else {
        if (!foundAttached) {
          console.log(`    ✗ Missing some attached recordings in response`);
        }
        if (!noUnattachedLeakage) {
          console.log(`    ✗ Unattached recordings leaked into attached response`);
        }
        attachedTest.passed = false;
      }
    }
  }

  // Test 17: Verify unattached recordings contain test data
  if (accessToken) {
    const unattachedTest = await runner.test('GET /recordings/attachments - verify unattached recordings', {
      testNumber: 17,
      method: 'GET',
      endpoint: '/api/recordings/attachments?attached=false',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 200,
    });

    if (unattachedTest && unattachedTest.status === 200) {
      const unattachedRecordings = unattachedTest.body || [];
      const apiPaths = new Set(unattachedRecordings.map(r => r.path));
      
      // Check 1: All unattached recordings from test data are present
      const foundUnattached = testData.recordings
        .filter(r => !r.attached)
        .every(testRecording => apiPaths.has(testRecording.path));

      // Check 2: No attached recordings are present (shouldn't be)
      const noAttachedLeakage = testData.recordings
        .filter(r => r.attached)
        .every(testRecording => !apiPaths.has(testRecording.path));

      if (foundUnattached && noAttachedLeakage) {
        console.log(`    ✓ All ${testData.recordings.filter(r => !r.attached).length} unattached recordings found, no attached leakage`);
        unattachedTest.passed = true;
      } else {
        if (!foundUnattached) {
          console.log(`    ✗ Missing some unattached recordings in response`);
        }
        if (!noAttachedLeakage) {
          console.log(`    ✗ Attached recordings leaked into unattached response`);
        }
        unattachedTest.passed = false;
      }
    }
  }

  // Summary
  runner.printResults(17);
  
  // Save results to file
  const resultsFile = runner.saveResults('recordings-tests.json');
  console.log(`✅ Test results saved to: ${resultsFile}\n`);
  
  // Return summary for master test runner
  return runner.getSummary();
}

/**
 * Run all recordings CRUD tests (get all, get by ID, delete, update)
 */
async function runRecordingsCrudTests() {
  testData = loadTestData();

  console.log('Starting Recordings CRUD tests...');
  console.log('Server: http://localhost:3001\n');

  // Get valid access token from test account
  let accessToken = null;

  if (hasTestAccounts()) {
    const testAccount = getTestAccount('primary');
    if (testAccount && testAccount.email && testAccount.password) {
      const signInResponse = await fetch(`${runner.baseUrl}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sign-in',
          email: testAccount.email,
          password: testAccount.password,
        }),
      });

      if (signInResponse.ok) {
        const authData = await signInResponse.json();
        accessToken = authData.token.access_token;
        console.log('✓ Obtained valid access token from test account\n');
      } else {
        console.log('⚠️ Could not obtain access token from test account');
      }
    }
  }

  if (!accessToken) {
    console.error('❌ Cannot run CRUD tests without valid access token');
    return;
  }

  // Test 18: Get single recording by ID
  if (accessToken && testData.recordings.length > 0) {
    const validRecording = testData.recordings.find(r => r.id !== null);
    if (validRecording) {
      await runner.test('GET /api/recordings/:id - get single with signed URL', {
        testNumber: 18,
        method: 'GET',
        endpoint: `/api/recordings/${validRecording.id}`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        expectedStatus: 200,
      });
    }
  }

  // Test 19: Get non-existent recording
  if (accessToken) {
    await runner.test('GET /api/recordings/:id - not found', {
      testNumber: 19,
      method: 'GET',
      endpoint: '/api/recordings/99999',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 404,
    });
  }

  // ⚠️ Test 4 DISABLED - PATCH endpoint not implemented
  // REASON: Recording schema has no user-editable fields
  //   - 'name': Does NOT exist in database
  //   - 'recording_file_path': Immutable
  //   - 'recording_file_signed_url': Server-generated, not user-updatable
  //   - 'recording_file_signed_url_expiry': Server-generated, not user-updatable
  // TO ENABLE: Add updateable fields to recording schema and database
  // if (accessToken && testData.recordings.length > 0) {
  //   const validRecording = testData.recordings.find(r => r.id !== null);
  //   if (validRecording) {
  //     const recordingId = validRecording.id;
  //     const result = await runner.test('PATCH /api/recordings/:id - update recording', {
  //       method: 'PATCH',
  //       endpoint: `/api/recordings/${recordingId}`,
  //       headers: {
  //         Authorization: `Bearer ${accessToken}`,
  //       },
  //       body: {
  //         // TODO: Add updatable fields once schema is updated
  //       },
  //       expectedStatus: 200,
  //     });
  //   }
  // }

  // Test 20: Delete recording (note: this will delete from test data, so test last)
  if (accessToken && testData.recordings.length > 1) {
    // Use a recording with a valid ID (find one with id !== null)
    const validRecordings = testData.recordings.filter(r => r.id !== null);
    if (validRecordings.length > 0) {
      // Use the last valid recording for deletion to not affect other tests
      const recordingId = validRecordings[validRecordings.length - 1].id;
      const result = await runner.test('DELETE /api/recordings/:id - delete recording', {
        testNumber: 20,
        method: 'DELETE',
        endpoint: `/api/recordings/${recordingId}`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        expectedStatus: 200,
      });

      if (result.passed && result.body?.success) {
        console.log(`    ✓ Recording deleted successfully`);
      }
    }
  }

  // Test 21: Delete non-existent recording
  if (accessToken) {
    await runner.test('DELETE /api/recordings/:id - not found', {
      testNumber: 21,
      method: 'DELETE',
      endpoint: '/api/recordings/99999',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 404,
    });
  }

  // Summary
  runner.printResults(20);
  
  // Save results to file
  const resultsFile = runner.saveResults('recordings-tests.json', true);
  console.log(`✅ Test results saved to: ${resultsFile}\n`);
  
  // Return summary for master test runner
  return runner.getSummary();
}

// Run tests if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      const args = process.argv.slice(2);
      if (args.includes('--attachments')) {
        await runRecordingsTests();
      } else if (args.includes('--crud')) {
        await runRecordingsCrudTests();
      } else if (args.includes('--all')) {
        await runRecordingsTests();
        console.log('\n\n=== PART 2: CRUD TESTS ===\n');
        await runRecordingsCrudTests();
      } else {
        console.log('Recording API Tests\n');
        console.log('Usage: node recordings.test.js [--attachments] [--crud] [--all]');
        console.log('  --attachments: Run GET /api/recordings/attachments tests (17 tests)');
        console.log('  --crud:        Run CRUD tests (get by ID, not found, delete)');
        console.log('  --all:         Run all tests (attachments + CRUD = 20 tests)');
      }
    } catch (error) {
      console.error('Test error:', error);
      process.exit(1);
    }
  })();
}

export { runRecordingsTests, runRecordingsCrudTests };
