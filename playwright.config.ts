import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for S3 Browser E2E tests
 * @see https://playwright.dev/docs/api/class-electronapplication
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Electron tests should run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for Electron tests
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],

  // Global setup/teardown for LocalStack
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  // Global timeout for tests
  timeout: 60000,

  // Expect timeout
  expect: {
    timeout: 10000,
  },

  // Output directory for screenshots and videos
  outputDir: 'test-results',

  use: {
    // Capture screenshot on failure and always
    screenshot: 'on',

    // Record video for each test
    video: 'on',

    // Trace on first retry
    trace: 'on-first-retry',

    // Base URL (not used for Electron but kept for reference)
    baseURL: 'http://localhost:5173',
  },

  // No web server needed - we'll launch Electron directly
  // webServer: undefined,

  projects: [
    {
      name: 'electron',
      testMatch: '**/*.e2e.ts',
      use: {
        // Electron-specific settings will be handled in test fixtures
      },
    },
  ],
});
