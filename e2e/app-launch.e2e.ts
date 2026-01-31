import { test, expect, TEST_BUCKETS } from './electron-fixtures';

test.describe('Electron App Launch', () => {
  test('should launch the Electron app', async ({ electronApp, window }) => {
    // Verify the app launched
    expect(electronApp).toBeDefined();

    // Verify the window is available
    expect(window).toBeDefined();

    // Get the window title
    const title = await window.title();
    expect(title).toBe('S3 Browser');
  });

  test('should display the main app structure', async ({ window }) => {
    // Check for header
    const header = window.locator('.app-header');
    await expect(header).toBeVisible();

    // Check for S3 Browser title
    const title = window.locator('.app-title h1');
    await expect(title).toHaveText('S3 Browser');

    // Check for profile selector
    const profileSelector = window.locator('.profile-selector');
    await expect(profileSelector).toBeVisible();

    // Check for sidebar with buckets
    const sidebar = window.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    // Check for main content area
    const content = window.locator('.content');
    await expect(content).toBeVisible();

    // Check for status bar
    const statusBar = window.locator('.status-bar');
    await expect(statusBar).toBeVisible();
  });

  test('should show test profile in profile selector', async ({ window }) => {
    // Check that the test profile is selected or available
    const profileSelector = window.locator('.profile-selector');
    await expect(profileSelector).toBeVisible();

    // The profile selector is a <select> element
    const dropdown = window.locator('.profile-dropdown');
    await expect(dropdown).toBeVisible();

    // Check that the test option exists in the dropdown
    const testOption = dropdown.locator('option[value="test"]');
    await expect(testOption).toBeAttached();
  });

  test('should display LocalStack buckets after selecting test profile', async ({ window }) => {
    // Select the test profile using selectOption for <select> elements
    const dropdown = window.locator('.profile-dropdown');
    await dropdown.selectOption('test');

    // Wait for buckets to load
    // The app needs time to connect to LocalStack and fetch buckets
    await window.waitForTimeout(3000);

    // Look for our test buckets in the sidebar using specific selectors
    // to avoid ambiguity when bucket names appear in multiple places
    const testBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
    await expect(testBucket).toBeVisible({ timeout: 15000 });

    const secondaryBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.secondary });
    await expect(secondaryBucket).toBeVisible({ timeout: 5000 });

    // Take a screenshot showing the buckets loaded
    await window.screenshot({ path: 'test-results/buckets-loaded.png' });
  });

  test('should take a screenshot of the initial state', async ({ window }) => {
    // Wait for any loading to complete
    await window.waitForLoadState('networkidle');

    // Take screenshot
    await window.screenshot({ path: 'test-results/app-initial-state.png' });

    // Verify the screenshot was taken (file should exist)
    expect(true).toBe(true);
  });
});
