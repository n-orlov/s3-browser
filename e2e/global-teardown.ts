/**
 * Playwright Global Teardown
 * Runs once after all tests to cleanup the test environment
 */

import { cleanupTestEnvironment } from './fixtures/localstack-setup';

async function globalTeardown() {
  console.log('\n=== E2E Test Global Teardown ===\n');

  // Clean up test data but keep LocalStack running (for faster subsequent runs)
  // Set stopContainer=true to stop LocalStack container as well
  const stopContainer = process.env.E2E_STOP_LOCALSTACK === 'true';

  await cleanupTestEnvironment(stopContainer);

  console.log('\n=== Global Teardown Complete ===\n');
}

export default globalTeardown;
