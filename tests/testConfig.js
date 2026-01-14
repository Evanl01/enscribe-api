/**
 * Test Configuration
 * Loads test account credentials from environment variables
 * All credentials should be in .env.local (which is gitignored)
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env.local automatically
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env.local');
dotenv.config({ path: envPath });

/**
 * Get test account credentials from environment
 */
export function getTestAccounts() {
  return {
    primary: {
      email: process.env.TEST_ACCOUNT_EMAIL,
      password: process.env.TEST_ACCOUNT_PASSWORD,
      description: 'Primary test account for sign-in/auth tests'
    }
  };
}

/**
 * Get single test account
 */
export function getTestAccount(name = 'primary') {
  const accounts = getTestAccounts();
  const account = accounts[name];
  
  if (!account || !account.email || !account.password) {
    console.warn(`⚠️  Test account '${name}' not configured in .env.local`);
    console.warn(`   Add these to .env.local:`);
    console.warn(`   TEST_ACCOUNT_EMAIL=your@email.com`);
    console.warn(`   TEST_ACCOUNT_PASSWORD=yourpassword`);
    return null;
  }
  
  return account;
}

/**
 * Check if test accounts are configured
 */
export function hasTestAccounts() {
  const primary = getTestAccount('primary');
  return !!primary;
}

/**
 * Get API base URL for tests
 * Can be overridden with API_BASE_URL environment variable
 * Default: http://localhost:3001 (local testing)
 * Production: https://api.enscribe.sjpedgi.doctor
 * 
 * Usage: API_BASE_URL=https://api.enscribe.sjpedgi.doctor npm test
 */
export function getApiBaseUrl() {
  return process.env.API_BASE_URL || 'http://localhost:3001';
}

/**
 * Log test account status (safe - only shows email prefix)
 */
export function logTestAccountStatus() {
  const account = getTestAccount('primary');
  if (!account) {
    console.log('❌ Test accounts not configured');
    return false;
  }
  
  const emailPrefix = account.email.split('@')[0];
  console.log(`✅ Test account configured: ${emailPrefix}@...`);
  return true;
}
