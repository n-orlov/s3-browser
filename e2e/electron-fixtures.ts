import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  LOCALSTACK_ENDPOINT,
  MOCK_AWS_CREDENTIALS,
  TEST_BUCKETS,
  isLocalStackHealthy,
  initializeTestEnvironment,
  cleanupTestData,
  getEndpoint,
} from './fixtures/localstack-setup';

/**
 * Create a private, empty user-data directory for one app launch.
 * The app persists its last profile/bucket/prefix under userData and restores it at startup,
 * so a shared directory leaks navigation state from one test into the next. The directory
 * name the app derives from its product name differs per platform, so isolating through
 * --user-data-dir is more reliable than deleting a guessed state file path.
 */
function createIsolatedUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 's3-browser-e2e-userdata-'));
}

/**
 * Extended test fixtures for Electron testing with LocalStack S3 backend
 * Provides electronApp and window fixtures for E2E tests
 */
export type ElectronTestFixtures = {
  electronApp: ElectronApplication;
  window: Page;
  localStackReady: boolean;
};

// Track if LocalStack has been initialized for this test run
let localStackInitialized = false;

/**
 * Custom test fixture that launches the Electron app with LocalStack backend
 */
export const test = base.extend<Omit<ElectronTestFixtures, 'localStackReady'>, Pick<ElectronTestFixtures, 'localStackReady'>>({
  // LocalStack setup fixture - runs once per worker
  // eslint-disable-next-line no-empty-pattern -- Playwright requires destructuring syntax for fixture args
  localStackReady: [async ({}, use) => {
    // Initialize LocalStack if not already done
    if (!localStackInitialized) {
      console.log('Initializing LocalStack test environment...');
      const success = await initializeTestEnvironment();
      if (!success) {
        throw new Error('Failed to initialize LocalStack test environment');
      }
      localStackInitialized = true;
    }

    await use(true);

    // Cleanup is handled globally, not per test
  }, { scope: 'worker' }],

  electronApp: async ({ localStackReady }, use) => {
    if (!localStackReady) {
      throw new Error('LocalStack is not ready');
    }

    // Fresh user-data dir per launch so persisted app state never leaks between tests
    const userDataDir = createIsolatedUserDataDir();

    // Build the app before testing
    const appPath = path.join(__dirname, '..');

    // Get the actual endpoint (may have been updated to container IP)
    const actualEndpoint = getEndpoint();
    console.log(`Using LocalStack endpoint for Electron: ${actualEndpoint}`);

    // Launch Electron with the main script
    // Note: --no-sandbox is required for running in Docker/CI environments
    const electronApp = await electron.launch({
      args: [
        '--no-sandbox',
        '--disable-gpu-sandbox',
        '--disable-setuid-sandbox',
        `--user-data-dir=${userDataDir}`,
        path.join(appPath, 'dist/main/index.js'),
      ],
      cwd: appPath,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        // Disable GPU to prevent issues in headless environment
        ELECTRON_DISABLE_GPU: '1',
        // Use mock AWS credentials for LocalStack
        AWS_ACCESS_KEY_ID: MOCK_AWS_CREDENTIALS.accessKeyId,
        AWS_SECRET_ACCESS_KEY: MOCK_AWS_CREDENTIALS.secretAccessKey,
        AWS_DEFAULT_REGION: MOCK_AWS_CREDENTIALS.region,
        // Point to LocalStack (use dynamic endpoint)
        AWS_ENDPOINT_URL: actualEndpoint,
      },
    });

    // Use the app
    await use(electronApp);

    // Close the app after test
    await electronApp.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  window: async ({ electronApp }, use) => {
    // Wait for the first window to be available
    const window = await electronApp.firstWindow();

    // Wait for the app to be ready (React has mounted)
    await window.waitForSelector('.app', { timeout: 30000 });

    // Use the window
    await use(window);
  },
});

export { expect } from '@playwright/test';

// Re-export test data constants for use in tests
export { TEST_BUCKETS, LOCALSTACK_ENDPOINT, getEndpoint } from './fixtures/localstack-setup';
