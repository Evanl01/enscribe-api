/**
 * Test Suite: Dot Phrases API
 * Tests CRUD operations: GET all, GET single, POST, PATCH, DELETE
 * Note: Requires valid JWT token for authentication
 */
import { TestRunner } from './testUtils.js';

const runner = new TestRunner('Dot Phrases API Tests');

// Mock token for testing (replace with actual valid token from sign-in)
const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.token';

/**
 * Run all dotPhrases tests
 */
async function runDotPhrasesTests() {
  console.log('Starting Dot Phrases API tests...');
  console.log('Server: http://localhost:3001');
  console.log('Note: These tests require valid JWT authentication\n');

  // Test 1: Get all dot phrases without auth
  await runner.test('GET /dot-phrases without auth', {
    method: 'GET',
    endpoint: '/api/dot-phrases',
    expectedStatus: 401,
    expectedFields: ['error'],
  });

  // Test 2: Get all dot phrases with invalid token
  await runner.test('GET /dot-phrases with invalid token', {
    method: 'GET',
    endpoint: '/api/dot-phrases',
    headers: {
      Authorization: `Bearer ${MOCK_TOKEN}`,
    },
    expectedStatus: 401,
  });

  // Test 3: Get single dot phrase without auth
  await runner.test('GET /dot-phrases/:id without auth', {
    method: 'GET',
    endpoint: '/api/dot-phrases/test-id-123',
    expectedStatus: 401,
  });

  // Test 4: Create dot phrase without auth
  await runner.test('POST /dot-phrases without auth', {
    method: 'POST',
    endpoint: '/api/dot-phrases',
    body: {
      trigger: 'hpi',
      expansion: 'History of Present Illness',
    },
    expectedStatus: 401,
  });

  // Test 5: Create dot phrase with invalid token
  await runner.test('POST /dot-phrases with invalid token', {
    method: 'POST',
    endpoint: '/api/dot-phrases',
    headers: {
      Authorization: `Bearer ${MOCK_TOKEN}`,
    },
    body: {
      trigger: 'hpi',
      expansion: 'History of Present Illness',
    },
    expectedStatus: 401,
  });

  // Test 6: Update dot phrase without auth
  await runner.test('PATCH /dot-phrases/:id without auth', {
    method: 'PATCH',
    endpoint: '/api/dot-phrases/test-id-123',
    body: {
      trigger: 'updated',
      expansion: 'Updated expansion',
    },
    expectedStatus: 401,
  });

  // Test 7: Delete dot phrase without auth
  await runner.test('DELETE /dot-phrases/:id without auth', {
    method: 'DELETE',
    endpoint: '/api/dot-phrases/test-id-123',
    expectedStatus: 401,
  });

  // Test 8: Create dot phrase with missing trigger (with token)
  await runner.test('POST /dot-phrases missing trigger (auth failed)', {
    method: 'POST',
    endpoint: '/api/dot-phrases',
    headers: {
      Authorization: `Bearer ${MOCK_TOKEN}`,
    },
    body: {
      expansion: 'Missing trigger field',
    },
    expectedStatus: 401, // Will fail on auth first
  });

  // Test 9: Create dot phrase with missing expansion (with token)
  await runner.test('POST /dot-phrases missing expansion (auth failed)', {
    method: 'POST',
    endpoint: '/api/dot-phrases',
    headers: {
      Authorization: `Bearer ${MOCK_TOKEN}`,
    },
    body: {
      trigger: 'test',
    },
    expectedStatus: 401,
  });

  // Test 10: Get non-existent dot phrase (with token)
  await runner.test('GET /dot-phrases/:id not found (auth failed)', {
    method: 'GET',
    endpoint: '/api/dot-phrases/non-existent-id',
    headers: {
      Authorization: `Bearer ${MOCK_TOKEN}`,
    },
    expectedStatus: 401,
  });

  // Print results
  runner.printResults();

  // Save results to file
  const resultsFile = runner.saveResults('dot-phrases-tests.json');
  console.log(`✅ Test results saved to: ${resultsFile}\n`);

  console.log('⚠️  Note: Most tests expect 401 (auth failure) because MOCK_TOKEN is invalid.');
  console.log('To run full tests with auth:');
  console.log('  1. Get valid JWT from sign-in endpoint');
  console.log('  2. Replace MOCK_TOKEN in auth.test.js with valid token');
  console.log('  3. Run: npm run test:dot-phrases\n');
  
  // Return summary for master test runner
  return runner.getSummary();
}

// Run tests if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runDotPhrasesTests();
    process.exit(0);
  } catch (error) {
    console.error('Test execution failed:', error);
    process.exit(1);
  }
}

export { runDotPhrasesTests };
