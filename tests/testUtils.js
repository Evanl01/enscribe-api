/**
 * Test utilities for Fastify API testing
 * Handles HTTP requests, result logging, and reporting
 */
import fs from 'fs';
import path from 'path';

/**
 * Make HTTP request to Fastify server
 */
export async function makeRequest(method, url, options = {}) {
  const { headers = {}, body = null, expectedStatus = null } = options;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : null,
    });

    const data = await response.json().catch(() => ({}));

    return {
      status: response.statusCode || response.status,
      headers: Object.fromEntries(response.headers || []),
      body: data,
      ok: response.ok,
      passed: expectedStatus ? response.status === expectedStatus : response.ok,
    };
  } catch (error) {
    return {
      status: null,
      headers: {},
      body: { error: error.message },
      ok: false,
      passed: false,
    };
  }
}

/**
 * Test case executor
 */
export class TestRunner {
  constructor(testName, baseUrl = 'http://localhost:3001') {
    this.testName = testName;
    this.baseUrl = baseUrl;
    this.results = [];
    this.startTime = new Date();
  }

  /**
   * Add a test case
   */
  async test(name, config) {
    const { method, endpoint, body, headers, expectedStatus, expectedFields, customValidator, onSuccess } = config;

    const url = `${this.baseUrl}${endpoint}`;
    const response = await makeRequest(method, url, { body, headers, expectedStatus });

    // Check status and expected fields
    let passed = response.passed &&
      (!expectedFields ||
        expectedFields.every((field) => {
          const keys = field.split('.');
          let value = response.body;
          for (const key of keys) {
            value = value?.[key];
          }
          return value !== undefined && value !== null;
        }));

    // Apply custom validator if provided (always call it to get message even on failure)
    let customMessage = '';
    if (customValidator) {
      const validationResult = customValidator(response.body);
      if (passed) {
        // Only update passed status if test already passed
        passed = passed && validationResult.passed;
      }
      customMessage = validationResult.message || '';
    }

    const result = {
      name,
      passed,
      endpoint,
      method,
      status: response.status,
      expectedStatus,
      body: response.body,
      customMessage,
      timestamp: new Date().toISOString(),
    };

    this.results.push(result);

    // Call onSuccess callback if test passed and callback provided
    if (passed && onSuccess && typeof onSuccess === 'function') {
      try {
        onSuccess(response.body);
      } catch (error) {
        console.error(`Error in onSuccess callback for test "${name}":`, error.message);
      }
    }

    return result;
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.passed).length;
    const failed = total - passed;
    const duration = new Date() - this.startTime;

    return {
      total,
      passed,
      failed,
      passRate: total > 0 ? ((passed / total) * 100).toFixed(2) + '%' : '0%',
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Save results to file
   */
  saveResults(filename = null) {
    const dir = path.resolve(process.cwd(), 'test-results');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const outputFile = path.join(
      dir,
      filename || `${this.testName}-${timestamp}.json`
    );

    const summary = this.getSummary();
    const output = {
      testSuite: this.testName,
      summary,
      results: this.results,
    };

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    return outputFile;
  }

  /**
   * Print results to console
   */
  printResults() {
    const summary = this.getSummary();

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Test Suite: ${this.testName}`);
    console.log(`${'='.repeat(60)}\n`);

    this.results.forEach((result, index) => {
      const status = result.passed ? '✅' : '❌';
      console.log(`${status} Test ${index + 1}: ${result.name}`);
      
      if (result.customMessage) {
        console.log(`   ${result.customMessage}`);
      }
      
      const responseBody = result.body || result.fullResponse || {};
      const responseStr = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
      const truncated = responseStr.substring(0, 500);
      
      if (!result.passed) {
        console.log(`   Expected: ${result.expectedStatus} | Got: ${result.status}`);
      }
      console.log(`   Response: ${truncated}${responseStr.length > 500 ? '...' : ''}`);
      console.log(); // Double space
    });

    console.log(`${'-'.repeat(60)}`);
    console.log(`Total: ${summary.total} | Passed: ${summary.passed} | Failed: ${summary.failed}`);
    console.log(`Pass Rate: ${summary.passRate} | Duration: ${summary.duration}`);
    console.log(`${'='.repeat(60)}\n`);
  }
}
