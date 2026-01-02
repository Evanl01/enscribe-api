/**
 * Master Test Runner
 * Executes all test suites and generates consolidated report
 */
import fs from 'fs';
import path from 'path';
import { runAuthTests } from './auth.test.js';
import { runDotPhrasesTests } from './dotphrases.test.js';
import { runPatientEncounterTests } from './patient-encounters.test.js';
import { runRecordingsTests } from './recordings.test.js';
import { runTranscriptsTests } from './transcripts.test.js';

/**
 * Run all test suites
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(70));
  console.log('FASTIFY API TEST SUITE - COMPREHENSIVE');
  console.log('='.repeat(70) + '\n');

  const startTime = new Date();
  const results = [];

  // Check if server is running
  try {
    const response = await fetch('http://localhost:3001/health');
    if (!response.ok) throw new Error('Server not responding');
    console.log('✅ Server health check passed\n');
  } catch (error) {
    console.error('❌ Server is not running. Start the server with:');
    console.error('   npm run dev:fastify\n');
    process.exit(1);
  }

  // Run Auth Tests
  try {
    console.log('\n' + '-'.repeat(70));
    console.log('TEST SUITE 1: AUTHENTICATION API');
    console.log('-'.repeat(70) + '\n');
    const authResult = await runAuthTests();
    results.push({ 
      suite: 'Authentication', 
      status: 'completed',
      tests: authResult?.total || 0,
      passed: authResult?.passed || 0,
      failed: authResult?.failed || 0,
      passRate: authResult?.passRate || '0%'
    });
  } catch (error) {
    console.error('❌ Auth tests failed:', error.message);
    results.push({ suite: 'Authentication', status: 'failed', error: error.message });
  }

  // Run Dot Phrases Tests
  try {
    console.log('\n' + '-'.repeat(70));
    console.log('TEST SUITE 2: DOT PHRASES API');
    console.log('-'.repeat(70) + '\n');
    const dotPhrasesResult = await runDotPhrasesTests();
    results.push({ 
      suite: 'Dot Phrases', 
      status: 'completed',
      tests: dotPhrasesResult?.total || 0,
      passed: dotPhrasesResult?.passed || 0,
      failed: dotPhrasesResult?.failed || 0,
      passRate: dotPhrasesResult?.passRate || '0%'
    });
  } catch (error) {
    console.error('❌ Dot Phrases tests failed:', error.message);
    results.push({ suite: 'Dot Phrases', status: 'failed', error: error.message });
  }

  // Run Patient Encounters Tests
  try {
    console.log('\n' + '-'.repeat(70));
    console.log('TEST SUITE 3: PATIENT ENCOUNTERS API');
    console.log('-'.repeat(70) + '\n');
    const peResult = await runPatientEncounterTests();
    results.push({ 
      suite: 'Patient Encounters', 
      status: 'completed',
      tests: peResult?.total || 0,
      passed: peResult?.passed || 0,
      failed: peResult?.failed || 0,
      passRate: peResult?.passRate || '0%'
    });
  } catch (error) {
    console.error('❌ Patient Encounters tests failed:', error.message);
    results.push({ suite: 'Patient Encounters', status: 'failed', error: error.message });
  }

  // Run Recordings Tests
  try {
    console.log('\n' + '-'.repeat(70));
    console.log('TEST SUITE 4: RECORDINGS API');
    console.log('-'.repeat(70) + '\n');
    const recResult = await runRecordingsTests();
    results.push({ 
      suite: 'Recordings', 
      status: 'completed',
      tests: recResult?.total || 0,
      passed: recResult?.passed || 0,
      failed: recResult?.failed || 0,
      passRate: recResult?.passRate || '0%'
    });
  } catch (error) {
    console.error('❌ Recordings tests failed:', error.message);
    results.push({ suite: 'Recordings', status: 'failed', error: error.message });
  }

  // Run Transcripts Tests
  try {
    console.log('\n' + '-'.repeat(70));
    console.log('TEST SUITE 5: TRANSCRIPTS API');
    console.log('-'.repeat(70) + '\n');
    const transResult = await runTranscriptsTests();
    results.push({ 
      suite: 'Transcripts', 
      status: 'completed',
      tests: transResult?.total || 0,
      passed: transResult?.passed || 0,
      failed: transResult?.failed || 0,
      passRate: transResult?.passRate || '0%'
    });
  } catch (error) {
    console.error('❌ Transcripts tests failed:', error.message);
    results.push({ suite: 'Transcripts', status: 'failed', error: error.message });
  }

  // Generate consolidated report
  const duration = new Date() - startTime;
  const completedSuites = results.filter((r) => r.status === 'completed').length;
  const successPercentage = ((completedSuites / results.length) * 100).toFixed(1);
  
  const report = {
    executedAt: new Date().toISOString(),
    totalDuration: `${duration}ms`,
    successRate: `${successPercentage}%`,
    suites: results,
    testResultsLocation: path.resolve(process.cwd(), 'test-results'),
  };

  // Save consolidated report
  const reportFile = path.join(process.cwd(), 'test-results', 'consolidated-report.json');
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

  // Print final summary
  console.log('\n' + '='.repeat(70));
  console.log('TEST EXECUTION SUMMARY');
  console.log('='.repeat(70));
  console.log(`Executed at: ${new Date().toLocaleString()}`);
  console.log(`Total Duration: ${duration}ms`);
  console.log(`Overall Success Rate: ${successPercentage}% (${completedSuites}/${results.length} suites)`);
  console.log(`\nDetailed Results:`);
  results.forEach((result) => {
    const status = result.status === 'completed' ? '✅' : '❌';
    if (result.tests !== undefined) {
      console.log(`  ${status} ${result.suite} - ${result.passed}/${result.tests} passed (${result.passRate})`);
    } else {
      console.log(`  ${status} ${result.suite} - ${result.status}`);
      if (result.error) console.log(`     Error: ${result.error}`);
    }
  });
  console.log(`\nResults Location: ${reportFile}`);
  console.log('='.repeat(70) + '\n');
}

// Run tests if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { runAllTests };
