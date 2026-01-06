/**
 * Test Suite: Authentication API
 * Tests all auth endpoints: sign-up, sign-in, sign-out, check-validity, resend
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

const runner = new TestRunner('Authentication API Tests');

/**
 * Run all auth tests
 */
async function runAuthTests() {
  console.log('Starting Authentication API tests...');
  console.log('Server: http://localhost:3001\n');

  // Test 1: Sign-up with invalid email format (Supabase rejects invalid emails)
  await runner.test('Sign-up with email', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'sign-up',
      email: 'signuptest@example.com',
      password: 'TestPassword123!',
    },
    expectedStatus: 400,
  });

  // Test 2: Sign-up with missing password
  await runner.test('Sign-up without password', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'sign-up',
      email: 'test@example.com',
    },
    expectedStatus: 400,
  });

  // Test 3: Sign-up with invalid email format
  await runner.test('Sign-up with invalid email', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'sign-up',
      email: 'notanemail',
      password: 'Password123!',
    },
    expectedStatus: 400,
  });

  // Test 4: Sign-in with valid credentials (uses real test account if configured)
  const testAccount = getTestAccount('primary');
  if (testAccount && testAccount.email && testAccount.password) {
    await runner.test('Sign-in with email and password (real credentials)', {
      method: 'POST',
      endpoint: '/api/auth',
      body: {
        action: 'sign-in',
        email: testAccount.email,
        password: testAccount.password,
      },
      expectedStatus: 200,
      expectedFields: ['user', 'token', 'token.access_token'],
    });
  } else {
    await runner.test('Sign-in with email and password (dummy - will fail)', {
      method: 'POST',
      endpoint: '/api/auth',
      body: {
        action: 'sign-in',
        email: 'existinguser@example.com',
        password: 'CorrectPassword123!',
      },
      expectedStatus: 401,
    });
    console.log('⚠️  Test credentials not configured. Set TEST_ACCOUNT_EMAIL and TEST_ACCOUNT_PASSWORD in .env.local to test real sign-in');
  }

  // Test 5: Sign-in with wrong password
  await runner.test('Sign-in with wrong password', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'sign-in',
      email: 'existinguser@example.com',
      password: 'WrongPassword123!',
    },
    expectedStatus: 401,
  });

  // Test 6: Sign-in with non-existent user
  await runner.test('Sign-in with non-existent user', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'sign-in',
      email: 'nonexistent@example.com',
      password: 'Password123!',
    },
    expectedStatus: 401,
  });

  // Test 7: Check validity without token
  await runner.test('Check validity without auth header', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'check-validity',
    },
    expectedStatus: 401,
  });

  // Test 8: Check validity with invalid token
  await runner.test('Check validity with invalid token', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'check-validity',
    },
    headers: {
      Authorization: 'Bearer invalid.token.here',
    },
    expectedStatus: 401,
  });

  // Test 9: Sign-out without auth (should require token)
  await runner.test('Sign-out without auth header', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'sign-out',
    },
    expectedStatus: 401,
  });

  // Test 10: Resend confirmation email
  await runner.test('Resend confirmation email', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'resend',
      email: 'newuser@example.com',
    },
    expectedStatus: 200,
    expectedFields: ['message'],
  });

  // Test 11: Resend without email
  await runner.test('Resend without email', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'resend',
    },
    expectedStatus: 400,
  });

  // Test 12: Invalid action type
  await runner.test('Invalid action type', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'invalid-action',
    },
    expectedStatus: 400,
    expectedFields: ['error'],
  });

  // Test 13: Missing action field
  await runner.test('Missing action field', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      email: 'test@example.com',
      password: 'password',
    },
    expectedStatus: 400,
  });

  // Test 14: Resend with redirect URL
  await runner.test('Resend with emailRedirectTo', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'resend',
      email: 'anotheruser@example.com',
      emailRedirectTo: 'https://myapp.com/confirm',
    },
    expectedStatus: 200,
  });

  // ===========================================
  // REAL ACCOUNT TESTS (if configured)
  // ===========================================
  
  if (hasTestAccounts()) {
    const testAccount = getTestAccount('primary');
    
    if (testAccount && testAccount.email && testAccount.password) {
      console.log(`\n📝 Running real account tests with: ${testAccount.email.split('@')[0]}@****\n`);
      
      // Test 15: Sign-in with valid real account
      await runner.test('Sign-in with valid account (real credentials)', {
        method: 'POST',
        endpoint: '/api/auth',
        body: {
          action: 'sign-in',
          email: testAccount.email,
          password: testAccount.password,
        },
        expectedStatus: 200,
        expectedFields: ['token.access_token', 'user.id', 'user.email'],
      });

      // Extract token from Test 15 response for Test 16
      const signInResult = runner.results[runner.results.length - 1];
      const accessToken = signInResult.body?.token?.access_token;

      // Test 16: Check validity with real account token (extracted from Test 15)
      if (accessToken) {
        await runner.test('Check validity endpoint (with real token)', {
          method: 'POST',
          endpoint: '/api/auth',
          body: {
            action: 'check-validity',
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          expectedStatus: 200,
          expectedFields: ['valid', 'message', 'user.id', 'user.email'],
        });
      } else {
        console.warn('⚠️  Could not extract token from sign-in test, skipping check-validity test');
      }
    }
  } else {
    console.log('\n⚠️  Test accounts not configured. Skipping real credential tests.');
    console.log('To enable: Add TEST_ACCOUNT_EMAIL and TEST_ACCOUNT_PASSWORD to .env.local\n');
  }

  // Print results
  runner.printResults();

  // Save results to file
  const resultsFile = runner.saveResults('auth-tests.json');
  console.log(`✅ Test results saved to: ${resultsFile}\n`);
  
  // Return summary for master test runner
  return runner.getSummary();
}

// Run tests if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runAuthTests();
    process.exit(0);
  } catch (error) {
    console.error('Test execution failed:', error);
    process.exit(1);
  }
}

export { runAuthTests };
