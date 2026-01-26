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
 * Extract tid from wrapper JWT token (for token rotation validation)
 * Wrapper JWT format: { sub: userId, tid: tokenId, iat, exp }
 * @param {string} wrapperJwt - The wrapper JWT token (wrapper cookie value)
 * @returns {string|null} The tid if extracted, null otherwise
 */
function extractTidFromWrapperJwt(wrapperJwt) {
  if (!wrapperJwt) return null;
  
  try {
    // Split JWT into parts: header.payload.signature
    const parts = wrapperJwt.split('.');
    if (parts.length !== 3) return null;
    
    // Decode payload (second part) from base64
    const payload = parts[1];
    // Add padding if needed for base64 decoding
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    
    return parsed?.tid || null;
  } catch (err) {
    console.error('  ❌ Error extracting tid from wrapper JWT:', err.message);
    return null;
  }
}

/**
 * Run all auth tests
 */
async function runAuthTests() {
  console.log('Starting Authentication API tests...');
  console.log(`Server: ${runner.baseUrl}\n`);

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
    customValidator: (body) => {
      // Expect serialized ZodError format: {error: {name: 'ZodError', message: '[...]'}}
      const isZodError = body?.error?.name === 'ZodError' && body?.error?.message;
      const hasPasswordIssue = /invalid_type.*password/.test(JSON.stringify(body?.error));
      
      return {
        passed: isZodError && hasPasswordIssue,
        message: (isZodError && hasPasswordIssue)
          ? 'Should return ZodError for missing password'
          : `Expected ZodError for missing password. Got: ${JSON.stringify(body?.error)}`
      };
    },
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
    customValidator: (body) => {
      // Expect serialized ZodError format: {error: {name: 'ZodError', message: '[...]'}}
      const isZodError = body?.error?.name === 'ZodError' && body?.error?.message;
      const hasEmailIssue = /invalid_format.*email/.test(JSON.stringify(body?.error));
      
      return {
        passed: isZodError && hasEmailIssue,
        message: (isZodError && hasEmailIssue)
          ? 'Should return ZodError for invalid email format'
          : `Expected ZodError for invalid email. Got: ${JSON.stringify(body?.error)}`
      };
    },
  });

  // Test 3b: Sign-up with password too short (< 8 characters)
  await runner.test('Sign-up with password too short', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'sign-up',
      email: 'valid@example.com',
      password: 'Short1!',
    },
    expectedStatus: 400,
    customValidator: (body) => {
      // Expect serialized ZodError format: {error: {name: 'ZodError', message: '[...]'}}
      const isZodError = body?.error?.name === 'ZodError' && body?.error?.message;
      const hasPasswordIssue = /too_small.*password/.test(JSON.stringify(body?.error));
      
      return {
        passed: isZodError && hasPasswordIssue,
        message: (isZodError && hasPasswordIssue)
          ? 'Should return ZodError for password too short'
          : `Expected ZodError for password too short. Got: ${JSON.stringify(body?.error)}`
      };
    },
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
      expectedFields: ['user', 'token', 'token.access_token', 'tid'],
      customValidator: (body) => {
        const hasTid = body?.tid && typeof body.tid === 'string';
        const tidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body?.tid);
        return {
          passed: hasTid && tidFormat,
          message: hasTid && tidFormat ? 'tid is valid UUID' : `tid missing or invalid format. Got: ${body?.tid}`
        };
      },
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
    customValidator: (body) => {
      // Business error (not Zod) - should be plain error string from Supabase
      return {
        passed: body?.error && typeof body.error === 'string',
        message: body?.error || 'Should return error message for wrong password'
      };
    },
  });

  // Test 5b: Sign-in with empty password
  await runner.test('Sign-in with empty password', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'sign-in',
      email: 'existinguser@example.com',
      password: '',
    },
    expectedStatus: 400,
    customValidator: (body) => {
      // Expect serialized ZodError format: {error: {name: 'ZodError', message: '[...]'}}
      const isZodError = body?.error?.name === 'ZodError' && body?.error?.message;
      const hasPasswordIssue = /too_small.*password/.test(JSON.stringify(body?.error));
      
      return {
        passed: isZodError && hasPasswordIssue,
        message: (isZodError && hasPasswordIssue)
          ? 'Should return ZodError for empty password'
          : `Expected ZodError for empty password. Got: ${JSON.stringify(body?.error)}`
      };
    },
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
    customValidator: (body) => {
      // Expect serialized ZodError format: {error: {name: 'ZodError', message: '[...]'}}
      const isZodError = body?.error?.name === 'ZodError' && body?.error?.message;
      const hasEmailIssue = /invalid_type.*email/.test(JSON.stringify(body?.error));
      
      return {
        passed: isZodError && hasEmailIssue,
        message: (isZodError && hasEmailIssue)
          ? 'Should return ZodError for missing email'
          : `Expected ZodError for missing email. Got: ${JSON.stringify(body?.error)}`
      };
    },
  });

  // Test 12: Invalid action type
  await runner.test('Invalid action type', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'invalid-action',
    },
    expectedStatus: 400,
    customValidator: (body) => {
      // Should return plain error string for unknown action
      return {
        passed: body?.error && typeof body.error === 'string' && body.error.includes('Unknown action'),
        message: body?.error || 'Should return error for unknown action'
      };
    },
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
    customValidator: (body) => {
      // Expect serialized ZodError format: {error: {name: 'ZodError', message: '[...]'}}
      const isZodError = body?.error?.name === 'ZodError' && body?.error?.message;
      
      return {
        passed: isZodError,
        message: isZodError
          ? 'Should return ZodError for missing action'
          : `Expected ZodError for missing action. Got: ${JSON.stringify(body?.error)}`
      };
    },
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

  // Test 14b: Resend with invalid emailRedirectTo URL
  await runner.test('Resend with invalid emailRedirectTo URL', {
    method: 'POST',
    endpoint: '/api/auth',
    body: {
      action: 'resend',
      email: 'testuser@example.com',
      emailRedirectTo: 'not-a-valid-url',
    },
    expectedStatus: 400,
    customValidator: (body) => {
      // Expect serialized ZodError format: {error: {name: 'ZodError', message: '[...]'}}
      const isZodError = body?.error?.name === 'ZodError' && body?.error?.message;
      const hasUrlIssue = /invalid_format.*emailRedirectTo/.test(JSON.stringify(body?.error));
      
      return {
        passed: isZodError && hasUrlIssue,
        message: (isZodError && hasUrlIssue)
          ? 'Should return ZodError for invalid emailRedirectTo URL'
          : `Expected ZodError for invalid emailRedirectTo URL. Got: ${JSON.stringify(body?.error)}`
      };
    },
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
        expectedFields: ['token.access_token', 'user.id', 'user.email', 'tid'],
        customValidator: (body) => {
          const hasTid = body?.tid && typeof body.tid === 'string';
          const tidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body?.tid);
          return {
            passed: hasTid && tidFormat,
            message: hasTid && tidFormat ? 'tid is valid UUID' : `tid missing or invalid format. Got: ${body?.tid}`
          };
        },
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

  // ===========================================
  // NEW: Token Refresh and Cookie Status Tests
  // ===========================================

  if (hasTestAccounts()) {
    const testAccount = getTestAccount('primary');
    
    if (testAccount && testAccount.email && testAccount.password) {
      console.log(`\n✅ Testing token refresh and cookie status endpoints...\n`);

      // First: Sign in to get refresh token cookie
      let refreshTokenCookie = null;
      let newAccessToken = null;

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

        const signInData = await response.json();
        const originalAccessToken = signInData?.token?.access_token;

        // Extract refresh_token cookie from Set-Cookie header
        const setCookieHeader = response.headers.get('set-cookie');
        if (setCookieHeader) {
          const match = setCookieHeader.match(/refresh_token=([^;]+)/);
          if (match) {
            refreshTokenCookie = match[1]; // Keep original encoding, don't decode
          }
        }

        console.log(`  ℹ️  Extracted refresh token: ${refreshTokenCookie ? 'yes' : 'no'}`);
        if (refreshTokenCookie) {
          console.log(`  ℹ️  Cookie preview: ${refreshTokenCookie.slice(0, 50)}...`);
          const initialTid = extractTidFromWrapperJwt(refreshTokenCookie);
          if (initialTid) {
            console.log(`  ℹ️  Initial tid: ${initialTid}`);
          }
        }
        console.log();

        // Test 21: POST /api/auth/refresh without cookie
        await runner.test('POST /api/auth/refresh without token', {
          method: 'POST',
          endpoint: '/api/auth/refresh',
          expectedStatus: 401,
          expectedFields: ['error'],
          customValidator: (body) => {
            const hasError = body?.error && typeof body.error === 'string';
            return {
              passed: hasError,
              message: body?.error || 'Should return error for missing refresh token'
            };
          },
        });

        // Test 22: POST /api/auth/refresh with invalid cookie
        await runner.test('POST /api/auth/refresh with invalid token', {
          method: 'POST',
          endpoint: '/api/auth/refresh',
          headers: {
            'Cookie': 'refresh_token=invalid.jwt.here',
          },
          expectedStatus: 401,
          expectedFields: ['error'],
          customValidator: (body) => {
            const hasError = body?.error && typeof body.error === 'string';
            return {
              passed: hasError,
              message: body?.error || 'Should return error for invalid JWT'
            };
          },
        });

        // Test 23: GET /api/auth/cookie-status with valid cookie (BEFORE refresh to avoid token rotation)
        if (refreshTokenCookie) {
          await runner.test('GET /api/auth/cookie-status with valid cookie', {
            method: 'GET',
            endpoint: '/api/auth/cookie-status',
            headers: {
              'Cookie': `refresh_token=${refreshTokenCookie}`,
            },
            expectedStatus: 200,
            expectedFields: ['cookiePresent'],
            customValidator: (body) => {
              return {
                passed: body?.cookiePresent === true,
                message: body?.cookiePresent === true ? 'Cookie correctly detected' : 'Should return cookiePresent: true'
              };
            },
          });
        }

        // Test 24: GET /api/auth/cookie-status without cookie
        await runner.test('GET /api/auth/cookie-status without cookie', {
          method: 'GET',
          endpoint: '/api/auth/cookie-status',
          expectedStatus: 200,
          expectedFields: ['cookiePresent'],
          customValidator: (body) => {
            return {
              passed: body?.cookiePresent === false,
              message: body?.cookiePresent === false ? 'No cookie correctly detected' : 'Should return cookiePresent: false'
            };
          },
        });

        // Test 25: GET /api/auth/cookie-status with invalid cookie
        await runner.test('GET /api/auth/cookie-status with invalid cookie', {
          method: 'GET',
          endpoint: '/api/auth/cookie-status',
          headers: {
            'Cookie': 'refresh_token=invalid.jwt.here',
          },
          expectedStatus: 200,
          expectedFields: ['cookiePresent'],
          customValidator: (body) => {
            return {
              passed: body?.cookiePresent === false,
              message: body?.cookiePresent === false ? 'Invalid cookie correctly detected' : 'Should return cookiePresent: false'
            };
          },
        });

        // ===== REFRESH TESTS RUN LAST (after cookie-status tests) =====
        // Test 26: POST /api/auth/refresh with valid cookie (NOW RUN AFTER cookie tests)
        if (refreshTokenCookie) {
          const oldTid = extractTidFromWrapperJwt(refreshTokenCookie);
          let newTid = null;

          // Wait 60 seconds to test JWT expiry/regeneration
          console.log(`  ⚠️⚠️⚠️  Please check Supabase: Access token expiry time is  30s`);
          console.log(`  ⏳ Waiting 30 seconds before refresh to test JWT regeneration...`);
          await new Promise(resolve => setTimeout(resolve, 30000));
          console.log(`  ✅ Wait complete, proceeding with refresh test\n`);

          await runner.test('POST /api/auth/refresh with valid token', {
            method: 'POST',
            endpoint: '/api/auth/refresh',
            headers: {
              'Cookie': `refresh_token=${refreshTokenCookie}`,
            },
            expectedStatus: 200,
            expectedFields: ['accessToken'],
            customValidator: (body, response) => {
              const hasAccessToken = body?.accessToken && typeof body.accessToken === 'string';
              newAccessToken = body?.accessToken;
              
              // Extract new tid from Set-Cookie header to validate token rotation
              const setCookieHeader = response?.headers?.['set-cookie'];
              if (setCookieHeader) {
                const cookieMatch = setCookieHeader.match(/refresh_token=([^;]+)/);
                if (cookieMatch) {
                  const newWrapperJwt = cookieMatch[1];
                  newTid = extractTidFromWrapperJwt(newWrapperJwt);
                }
              }

              // Compare access tokens to verify JWT was regenerated
              const jwtChanged = originalAccessToken && originalAccessToken !== newAccessToken;
              
              // Optionally decode JWTs to compare iat timestamps
              let oldIat = null, newIat = null;
              if (originalAccessToken && newAccessToken) {
                try {
                  const oldParts = originalAccessToken.split('.');
                  const newParts = newAccessToken.split('.');
                  if (oldParts.length === 3 && newParts.length === 3) {
                    const oldPayload = oldParts[1];
                    const newPayload = newParts[1];
                    const oldPadded = oldPayload + '='.repeat((4 - (oldPayload.length % 4)) % 4);
                    const newPadded = newPayload + '='.repeat((4 - (newPayload.length % 4)) % 4);
                    const oldDecoded = JSON.parse(Buffer.from(oldPadded, 'base64').toString('utf-8'));
                    const newDecoded = JSON.parse(Buffer.from(newPadded, 'base64').toString('utf-8'));
                    oldIat = oldDecoded?.iat;
                    newIat = newDecoded?.iat;
                  }
                } catch (err) {
                  // Silently fail JWT decoding, not critical
                }
              }

              // Log rotation validation
              console.log(`    ℹ️  Token Rotation Validation:`);
              console.log(`       Old tid: ${oldTid || 'unable to extract'}`);
              console.log(`       New tid: ${newTid || 'unable to extract'}`);
              if (oldTid && newTid) {
                const tidRotated = oldTid !== newTid;
                console.log(`       Tid rotation: ${tidRotated ? '✅ YES (tid changed)' : '❌ NO (tid unchanged)'}`);
              }
              console.log(`       Access Token changed: ${jwtChanged ? '✅ YES (new JWT)' : '❌ NO (same JWT)'}`);
              if (oldIat && newIat) {
                console.log(`       Old iat: ${oldIat}, New iat: ${newIat}`);
              }

              const passed = hasAccessToken && newTid && oldTid && oldTid !== newTid && jwtChanged;
              return {
                passed,
                message: passed 
                  ? '✅ Token rotated successfully (tid + JWT both changed)' 
                  : (!hasAccessToken ? 'No accessToken in response' : 'Token rotation not detected (tid or JWT unchanged or missing)')
              };
            },
          });
        } else {
          console.warn('  ⚠️  Could not extract refresh token, skipping refresh tests');
        }
      } catch (err) {
        console.error('  ❌ Failed to extract tokens for refresh tests:', err.message);
      }
  }
}
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
