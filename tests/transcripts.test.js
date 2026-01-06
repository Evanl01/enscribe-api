/**
 * Test Suite: Transcripts API
 * Tests all transcript CRUD operations: GET, POST, DELETE (PATCH disabled)
 * Requires: npm run test:setup (to create test data with recordings)
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

const runner = new TestRunner('Transcripts API Tests');

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
 * Run all transcript CRUD tests
 */
async function runTranscriptsTests() {
  // Load test data first
  testData = loadTestData();

  // Track graceful error handling
  let gracefullyHandledCount = 0;
  const gracefullyHandledTests = [];

  console.log('Starting Transcripts API tests...');
  console.log('Server: http://localhost:3001\n');
  console.log('Test Data Loaded:');
  console.log(`  Encounters: ${testData.encounters.length}`);
  console.log(`  Recordings: ${testData.recordings.length}\n`);

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

  // Test 1: GET /transcripts without auth
  await runner.test('GET /api/transcripts without auth', {
    method: 'GET',
    endpoint: '/api/transcripts',
    expectedStatus: 401,
    expectedFields: ['error'],
  });

  // Test 2: GET /transcripts with invalid token
  await runner.test('GET /api/transcripts with invalid token', {
    method: 'GET',
    endpoint: '/api/transcripts',
    headers: {
      Authorization: `Bearer ${MOCK_TOKEN}`,
    },
    expectedStatus: 401,
  });

  // Test 3: POST /transcripts without auth
  await runner.test('POST /api/transcripts without auth', {
    method: 'POST',
    endpoint: '/api/transcripts',
    body: {
      transcript_text: 'Test transcript',
      recording_id: 1,
    },
    expectedStatus: 401,
    expectedFields: ['error'],
  });

  // Test 4: POST /transcripts with invalid token
  await runner.test('POST /api/transcripts with invalid token', {
    method: 'POST',
    endpoint: '/api/transcripts',
    headers: {
      Authorization: `Bearer ${MOCK_TOKEN}`,
    },
    body: {
      transcript_text: 'Test transcript',
      recording_id: 1,
    },
    expectedStatus: 401,
  });

  // Test 5: POST /transcripts with missing fields
  if (accessToken) {
    await runner.test('POST /api/transcripts - missing transcript_text', {
      method: 'POST',
      endpoint: '/api/transcripts',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: {
        recording_id: 1,
      },
      expectedStatus: 400,
      expectedFields: ['error'],
    });
  }

  // Test 6: POST /transcripts with missing recording_id
  if (accessToken) {
    await runner.test('POST /api/transcripts - missing recording_id', {
      method: 'POST',
      endpoint: '/api/transcripts',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: {
        transcript_text: 'Test transcript',
      },
      expectedStatus: 400,
      expectedFields: ['error'],
    });
  }

  // Test 7: POST /transcripts with valid data (create)
  // Note: This may fail if transcripts were already created by setup.test.js
  // (duplicate key constraint on recording_id)
  let createdTranscriptId = null;
  if (accessToken && testData.recordings.length > 0) {
    const validRecording = testData.recordings.find(r => r.id !== null);
    if (validRecording) {
      const result = await runner.test('POST /api/transcripts - create transcript', {
        method: 'POST',
        endpoint: '/api/transcripts',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: {
          transcript_text: 'This is a test transcript for the recording.',
          recording_id: validRecording.id,
        },
        expectedStatus: 201,
      });

      // Handle duplicate key error gracefully
      if (!result.passed) {
        if (result.body?.error?.includes('duplicate key') || 
            result.body?.error?.includes('unique constraint')) {
          gracefullyHandledCount++;
          gracefullyHandledTests.push('Test 7 (POST/CREATE)');
          
          console.log('');
          console.log('    ⚠️  GRACEFUL ERROR HANDLING TRIGGERED');
          console.log(`    ℹ️  Transcript already exists (likely created by setup.test.js)`);
          console.log(`    ℹ️  Attempting to fetch existing transcript for DELETE tests...`);
          // Try to fetch existing transcripts and use one for DELETE tests
          try {
            const transcriptsFetch = await fetch('http://localhost:3001/api/transcripts', {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            });
            if (transcriptsFetch.ok) {
              const transcripts = await transcriptsFetch.json();
              if (Array.isArray(transcripts) && transcripts.length > 0) {
                // Use the first existing transcript for delete tests
                createdTranscriptId = transcripts[0].id;
                console.log(`    ✓ Found existing transcript ID: ${createdTranscriptId}`);
                console.log(`    ✓ DELETE tests will use this transcript instead`);
              }
            }
          } catch (e) {
            console.log(`    ⚠️  Could not fetch existing transcripts: ${e.message}`);
          }
          console.log('');
        }
      } else if (result.passed && result.body?.id) {
        createdTranscriptId = result.body.id;
        console.log(`    ✓ Created transcript with ID: ${createdTranscriptId}`);
      }
    }
  }

  // Test 8: GET /transcripts/:id - get single transcript
  if (accessToken && createdTranscriptId) {
    const result = await runner.test('GET /api/transcripts/:id - get single transcript', {
      method: 'GET',
      endpoint: `/api/transcripts/${createdTranscriptId}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 200,
    });

    if (result.passed && result.body?.id === createdTranscriptId) {
      console.log(`    ✓ Retrieved transcript ${createdTranscriptId}`);
    }
  }

  // Test 9: GET /transcripts/:id - not found
  if (accessToken) {
    await runner.test('GET /api/transcripts/:id - not found', {
      method: 'GET',
      endpoint: '/api/transcripts/99999',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 404,
    });
  }

  // Test 10: GET /transcripts - list all
  if (accessToken) {
    const result = await runner.test('GET /api/transcripts - list all', {
      method: 'GET',
      endpoint: '/api/transcripts',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 200,
    });

    if (result.passed && Array.isArray(result.body)) {
      console.log(`    ✓ Retrieved ${result.body.length} transcripts`);
    }
  }

  // PATCH tests DISABLED - Transcripts are immutable after creation
  // Database trigger (prevent_transcript_fk_updates) prevents updating recording_id and user_id
  // The only updateable field (transcript_text) is not practically useful.
  // To fix a transcript, delete and recreate it.
  /*
  // Test 11: PATCH /transcripts/:id without auth
  if (createdTranscriptId) {
    await runner.test('PATCH /api/transcripts/:id without auth', {
      method: 'PATCH',
      endpoint: `/api/transcripts/${createdTranscriptId}`,
      body: {
        transcript_text: 'Updated transcript text',
      },
      expectedStatus: 401,
      expectedFields: ['error'],
    });
  }

  // Test 12: PATCH /transcripts/:id with invalid token
  if (createdTranscriptId) {
    await runner.test('PATCH /api/transcripts/:id with invalid token', {
      method: 'PATCH',
      endpoint: `/api/transcripts/${createdTranscriptId}`,
      headers: {
        Authorization: `Bearer ${MOCK_TOKEN}`,
      },
      body: {
        transcript_text: 'Updated transcript text',
      },
      expectedStatus: 401,
    });
  }

  // Test 13: PATCH /transcripts/:id - missing transcript_text
  if (accessToken && createdTranscriptId) {
    await runner.test('PATCH /api/transcripts/:id - missing transcript_text', {
      method: 'PATCH',
      endpoint: `/api/transcripts/${createdTranscriptId}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: {},
      expectedStatus: 400,
      expectedFields: ['error'],
    });
  }

  // Test 14: PATCH /transcripts/:id - update transcript
  if (accessToken && createdTranscriptId) {
    const updatedText = 'Updated transcript text with more details.';
    const result = await runner.test('PATCH /api/transcripts/:id - update transcript', {
      method: 'PATCH',
      endpoint: `/api/transcripts/${createdTranscriptId}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: {
        transcript_text: updatedText,
      },
      expectedStatus: 200,
    });

    if (result.passed && result.body?.id === createdTranscriptId) {
      console.log(`    ✓ Updated transcript ${createdTranscriptId}`);
    }
  }

  // Test 15: PATCH /transcripts/:id - not found
  if (accessToken) {
    await runner.test('PATCH /api/transcripts/:id - not found', {
      method: 'PATCH',
      endpoint: '/api/transcripts/99999',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: {
        transcript_text: 'Update text',
      },
      expectedStatus: 404,
    });
  }
  */

  // Test 16: DELETE /transcripts/:id without auth
  if (createdTranscriptId) {
    await runner.test('DELETE /api/transcripts/:id without auth', {
      method: 'DELETE',
      endpoint: `/api/transcripts/${createdTranscriptId}`,
      expectedStatus: 401,
      expectedFields: ['error'],
    });
  }

  // Test 17: DELETE /transcripts/:id with invalid token
  if (createdTranscriptId) {
    await runner.test('DELETE /api/transcripts/:id with invalid token', {
      method: 'DELETE',
      endpoint: `/api/transcripts/${createdTranscriptId}`,
      headers: {
        Authorization: `Bearer ${MOCK_TOKEN}`,
      },
      expectedStatus: 401,
    });
  }

  // Test 18: DELETE /transcripts/:id - not found
  if (accessToken) {
    await runner.test('DELETE /api/transcripts/:id - not found', {
      method: 'DELETE',
      endpoint: '/api/transcripts/99999',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 404,
    });
  }

  // Test 19: DELETE /transcripts/:id - delete transcript
  if (accessToken && createdTranscriptId) {
    const result = await runner.test('DELETE /api/transcripts/:id - delete transcript', {
      method: 'DELETE',
      endpoint: `/api/transcripts/${createdTranscriptId}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 200,
    });

    if (result.passed && result.body?.success) {
      console.log(`    ✓ Deleted transcript ${createdTranscriptId}`);
    }
  }

  // Test 20: Verify deleted transcript is gone
  if (accessToken && createdTranscriptId) {
    await runner.test('GET /api/transcripts/:id - verify deleted', {
      method: 'GET',
      endpoint: `/api/transcripts/${createdTranscriptId}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      expectedStatus: 404,
    });
  }

  // Print graceful error handling summary
  if (gracefullyHandledCount > 0) {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║         GRACEFUL ERROR HANDLING SUMMARY                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`  Tests with graceful handling: ${gracefullyHandledCount}`);
    gracefullyHandledTests.forEach(test => {
      console.log(`    • ${test} - Recovered from duplicate key constraint`);
    });
    console.log('  Status: Subsequent tests continue with existing transcript\n');
  }

  // Summary
  runner.saveResults('transcripts-tests.json');
  runner.printResults();
  
  // Return summary for master test runner
  return runner.getSummary();
}

// Run tests if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      await runTranscriptsTests();
    } catch (error) {
      console.error('Test error:', error);
      process.exit(1);
    }
  })();
}

export { runTranscriptsTests };
