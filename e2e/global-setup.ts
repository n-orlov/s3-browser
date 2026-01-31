/**
 * Playwright Global Setup
 * Runs once before all tests to initialize the test environment
 */

import { initializeTestEnvironment, isLocalStackHealthy } from './fixtures/localstack-setup';

async function globalSetup() {
  console.log('\n=== E2E Test Global Setup ===\n');

  // Check if LocalStack is already running
  const alreadyHealthy = await isLocalStackHealthy();
  if (alreadyHealthy) {
    console.log('LocalStack is already running');
  }

  // Initialize test environment (start LocalStack, create buckets, upload test data)
  console.log('Initializing test environment...');
  const success = await initializeTestEnvironment();

  if (!success) {
    console.error('Failed to initialize test environment');
    process.exit(1);
  }

  console.log('\n=== Global Setup Complete ===\n');
}

export default globalSetup;
