# Fastify API Test Suite

Comprehensive testing framework for the Fastify backend migration with permanent storage of test cases and results.

## Directory Structure

```
tests/
├── testUtils.js          # Shared testing utilities and TestRunner class
├── auth.test.js          # Authentication API tests
├── dotphrases.test.js    # Dot Phrases API tests
├── runAll.js             # Master test runner (runs all suites)
└── README.md             # This file

test-results/
├── auth-tests.json              # Auth test results
├── dotphrases-tests.json        # Dot Phrases test results
├── consolidated-report.json     # Summary of all test runs
└── [suite]-[timestamp].json     # Individual test run files
```

## Quick Start

### 1. Start the Fastify Server

In one terminal:
```bash
npm run dev:fastify
```

Wait for the server to start (you should see: `✓ Fastify server running on http://127.0.0.1:3001`)

### 2. Run Tests

In another terminal:

**Run all tests:**
```bash
npm test
```

**Run specific test suite:**
```bash
npm run test:auth
npm run test:dotphrases
```

## Test Suites

### Authentication API Tests (auth.test.js)
Tests for `/api/auth` endpoint with all action types:

- ✅ Sign-up with valid email
- ✅ Sign-up without password (validation)
- ✅ Sign-up with invalid email (validation)
- ✅ Sign-in with credentials
- ✅ Sign-in with wrong password
- ✅ Sign-in with non-existent user
- ✅ Check token validity without auth
- ✅ Check token validity with invalid token
- ✅ Sign-out without auth
- ✅ Resend confirmation email
- ✅ Resend without email
- ✅ Invalid action type
- ✅ Missing action field
- ✅ Resend with redirect URL

**Total: 14 test cases**

### Dot Phrases API Tests (dotphrases.test.js)
Tests for `/api/dotphrases` CRUD operations:

- ✅ GET all without auth
- ✅ GET all with invalid token
- ✅ GET single without auth
- ✅ POST (create) without auth
- ✅ POST with invalid token
- ✅ PATCH (update) without auth
- ✅ DELETE without auth
- ✅ POST missing trigger
- ✅ POST missing expansion
- ✅ GET non-existent record
- ✅ More test cases as needed

**Total: 10+ test cases**

## Test Results

### Result Files

Test results are automatically saved to `test-results/` directory with:

1. **Individual Suite Results**: `{suite}-tests.json`
   ```json
   {
     "testSuite": "Authentication API Tests",
     "summary": {
       "total": 14,
       "passed": 12,
       "failed": 2,
       "passRate": "85.71%",
       "duration": "245ms",
       "timestamp": "2025-12-22T21:30:00.000Z"
     },
     "results": [
       {
         "name": "Sign-up with email",
         "passed": false,
         "endpoint": "/api/auth",
         "method": "POST",
         "status": 201,
         "expectedStatus": 201,
         "body": { ... },
         "timestamp": "2025-12-22T21:30:00.123Z"
       },
       ...
     ]
   }
   ```

2. **Consolidated Report**: `consolidated-report.json`
   ```json
   {
     "executedAt": "2025-12-22T21:30:15.000Z",
     "totalDuration": "450ms",
     "suites": [
       { "suite": "Authentication", "status": "completed" },
       { "suite": "Dot Phrases", "status": "completed" }
     ],
     "testResultsLocation": "/path/to/test-results"
   }
   ```

3. **Timestamped Files**: `{suite}-{timestamp}.json`
   - Each test run creates a timestamped file for historical tracking
   - Useful for comparing results over time

## Understanding Test Results

### Test Result Object

Each test in the results array contains:

```javascript
{
  "name": "Description of test",
  "passed": true/false,           // Did test pass?
  "endpoint": "/api/endpoint",    // API endpoint tested
  "method": "POST/GET/PATCH/DELETE",
  "status": 200,                  // Actual HTTP status
  "expectedStatus": 200,          // Expected HTTP status
  "body": { /* response body */ },
  "timestamp": "ISO timestamp"
}
```

### Summary Statistics

- **total**: Total number of tests run
- **passed**: Number of passing tests
- **failed**: Number of failing tests
- **passRate**: Percentage of tests that passed (e.g., "85.71%")
- **duration**: Time taken to run all tests

## Test Cases Format

Each test is defined with:

```javascript
await runner.test('Test name', {
  method: 'POST',              // HTTP method
  endpoint: '/api/auth',       // Endpoint to test
  body: { /* JSON body */ },   // Request body (optional)
  headers: { /* headers */ },  // Custom headers (optional)
  expectedStatus: 201,         // Expected HTTP status code
  expectedFields: [            // Expected fields in response (optional)
    'message',
    'user.id',                 // Nested fields with dot notation
    'session.access_token'
  ]
});
```

## Adding New Test Cases

### 1. Add to existing suite:

```javascript
// In tests/auth.test.js (or any test file)
await runner.test('New test name', {
  method: 'POST',
  endpoint: '/api/auth',
  body: { /* ... */ },
  expectedStatus: 200,
  expectedFields: ['field1', 'field2'],
});
```

### 2. Create new test suite:

```javascript
// Create tests/myapi.test.js
import { TestRunner } from './testUtils.js';

const runner = new TestRunner('My API Tests');

export async function runMyApiTests() {
  // Add test cases...
  runner.printResults();
  const resultsFile = runner.saveResults('myapi-tests.json');
  console.log(`Results saved to: ${resultsFile}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMyApiTests();
}
```

### 3. Register in master runner:

Update `tests/runAll.js`:
```javascript
import { runMyApiTests } from './myapi.test.js';

// In runAllTests():
try {
  console.log('\nTEST SUITE 3: MY API');
  await runMyApiTests();
  results.push({ suite: 'My API', status: 'completed' });
} catch (error) {
  results.push({ suite: 'My API', status: 'failed', error: error.message });
}
```

### 4. Add npm script in package.json:

```json
"scripts": {
  "test:myapi": "node tests/myapi.test.js"
}
```

## Viewing Historical Results

All test results are stored with timestamps:

```bash
# View all results
ls -lah test-results/

# View specific suite results
cat test-results/auth-tests.json | python3 -m json.tool

# View consolidated report
cat test-results/consolidated-report.json | python3 -m json.tool

# Get summary stats
jq '.summary' test-results/auth-tests.json
```

## Test Coverage Status

### Phase 1-2 Complete ✅
- **Authentication API**: 14 test cases
- **Dot Phrases API**: 10+ test cases (auth-protected)

### Phase 3 - To Be Added
- **Patient Encounters API**: Full CRUD tests
- **SOAP Notes API**: Full CRUD tests
- **Recordings API**: Upload/download tests
- **Transcripts API**: Query/list tests
- **Prompt LLM API**: LLM integration tests

## Troubleshooting

### "Server is not running"
Make sure to start the server first:
```bash
npm run dev:fastify
```

### Tests expect invalid tokens
The dotPhrases tests use a mock token. To test with real auth:
1. Get a valid token from sign-in endpoint
2. Update the `MOCK_TOKEN` in `tests/dotphrases.test.js`
3. Re-run tests

### No test results file created
Check that `test-results/` directory exists and has write permissions:
```bash
mkdir -p test-results
chmod 755 test-results
```

## Test Philosophy

- **Non-destructive**: Tests validate API behavior without modifying production data
- **Comprehensive**: Cover happy paths, error cases, and validation
- **Traceable**: All results stored with timestamps for historical comparison
- **Automated**: Run with single command, results automatically saved
- **Scalable**: Easy to add new test suites as APIs are migrated

## Next Steps

As new APIs are migrated from Next.js to Fastify:
1. Create corresponding test file in `tests/`
2. Add test cases using TestRunner
3. Register in `tests/runAll.js`
4. Add npm script to `package.json`
5. Run: `npm test`

This ensures continuous validation during the migration process!
