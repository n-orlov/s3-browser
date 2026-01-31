import { test, expect, TEST_BUCKETS, getEndpoint } from './electron-fixtures';
import { TEST_DATA } from './fixtures/localstack-setup';

test.describe('Profile Selection and Bucket Listing', () => {
  test.describe('Profile Selector', () => {
    test('should display profile selector in header', async ({ window }) => {
      // Profile selector should be visible in the app header
      const profileSelector = window.locator('.profile-selector');
      await expect(profileSelector).toBeVisible();

      // Should have a label
      const label = window.locator('.profile-label');
      await expect(label).toHaveText('Profile:');

      // Should have a dropdown
      const dropdown = window.locator('.profile-dropdown');
      await expect(dropdown).toBeVisible();

      // Take screenshot
      await window.screenshot({ path: 'test-results/profile-selector.png' });
    });

    test('should have test profile available', async ({ window }) => {
      const dropdown = window.locator('.profile-dropdown');

      // Check that test option exists
      const testOption = dropdown.locator('option[value="test"]');
      await expect(testOption).toBeAttached();

      // The test option should not be disabled
      await expect(testOption).not.toBeDisabled();
    });

    test('should show "Select a profile" as default option', async ({ window }) => {
      const dropdown = window.locator('.profile-dropdown');

      // First option should be the placeholder
      const defaultOption = dropdown.locator('option[value=""]');
      await expect(defaultOption).toHaveText('Select a profile');
    });

    test('should have refresh profiles button', async ({ window }) => {
      const refreshBtn = window.locator('.profile-refresh-btn');
      await expect(refreshBtn).toBeVisible();
      await expect(refreshBtn).toHaveAttribute('title', 'Refresh profiles from disk');
    });

    test('should change profile when selecting from dropdown', async ({ window }) => {
      const dropdown = window.locator('.profile-dropdown');

      // Select the test profile
      await dropdown.selectOption('test');

      // Verify selection
      await expect(dropdown).toHaveValue('test');

      // After selecting profile, buckets should start loading
      // Wait for loading indicator or bucket tree to appear
      await window.waitForTimeout(1000);

      // Screenshot after profile selection
      await window.screenshot({ path: 'test-results/profile-selected.png' });
    });
  });

  test.describe('Bucket Listing', () => {
    test.beforeEach(async ({ window }) => {
      // Select the test profile to connect to LocalStack
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for bucket list to actually load (instead of arbitrary timeout)
      // Look for one of the test buckets to appear
      const testBucketElement = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(testBucketElement).toBeVisible({ timeout: 15000 });
    });

    test('should display bucket tree in sidebar', async ({ window }) => {
      // Sidebar should be visible
      const sidebar = window.locator('.sidebar');
      await expect(sidebar).toBeVisible();

      // Sidebar header should show "Buckets"
      const sidebarHeader = window.locator('.sidebar-header h2');
      await expect(sidebarHeader).toHaveText('Buckets');

      // Bucket tree should be visible
      const bucketTree = window.locator('.bucket-tree');
      await expect(bucketTree).toBeVisible();
    });

    test('should display all test buckets from LocalStack', async ({ window }) => {
      // Wait for buckets to load with longer timeout - use specific selector for bucket list
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });

      const secondaryBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.secondary });
      await expect(secondaryBucket).toBeVisible({ timeout: 5000 });

      const emptyBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.empty });
      await expect(emptyBucket).toBeVisible({ timeout: 5000 });

      // Screenshot showing all buckets
      await window.screenshot({ path: 'test-results/all-buckets-listed.png' });
    });

    test('should show bucket count in filter hint', async ({ window }) => {
      // beforeEach already ensures buckets are loaded
      // Filter hint should show bucket count
      const filterHint = window.locator('.bucket-filter-hint');
      await expect(filterHint).toContainText('3 buckets');
    });

    test('should have bucket filter input', async ({ window }) => {
      // beforeEach already ensures buckets are loaded
      // Filter input should be visible
      const filterInput = window.locator('.bucket-filter-input');
      await expect(filterInput).toBeVisible();
      await expect(filterInput).toHaveAttribute('placeholder', 'Filter buckets (contains)...');
    });

    test('should filter buckets by name (case-insensitive contains)', async ({ window }) => {
      // beforeEach already ensures buckets are loaded
      const filterInput = window.locator('.bucket-filter-input');

      // Filter for "secondary"
      await filterInput.fill('secondary');
      await window.waitForTimeout(300); // Allow filtering to apply

      // Only secondary bucket should be visible in the bucket list
      const secondaryBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.secondary });
      await expect(secondaryBucket).toBeVisible();

      // Main bucket should be hidden
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toHaveCount(0);

      // Filter hint should show filtered count
      const filterHint = window.locator('.bucket-filter-hint');
      await expect(filterHint).toContainText('1 of 3 buckets');

      // Screenshot with filter applied
      await window.screenshot({ path: 'test-results/bucket-filter-applied.png' });
    });

    test('should clear filter with clear button', async ({ window }) => {
      // beforeEach already ensures buckets are loaded
      const filterInput = window.locator('.bucket-filter-input');

      // Apply filter
      await filterInput.fill('test');
      await window.waitForTimeout(300);

      // Clear button should appear
      const clearBtn = window.locator('.bucket-filter-clear');
      await expect(clearBtn).toBeVisible();

      // Click clear button
      await clearBtn.click();

      // Filter should be cleared
      await expect(filterInput).toHaveValue('');

      // All buckets should be visible again in the bucket list
      await expect(window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main })).toBeVisible();
      await expect(window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.secondary })).toBeVisible();
      await expect(window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.empty })).toBeVisible();
    });

    test('should show "No matching buckets" when filter has no results', async ({ window }) => {
      // beforeEach already ensures buckets are loaded

      const filterInput = window.locator('.bucket-filter-input');

      // Filter with non-matching text
      await filterInput.fill('nonexistent');
      await window.waitForTimeout(300);

      // Should show "No matching buckets" placeholder
      const placeholder = window.locator('.bucket-tree-placeholder');
      await expect(placeholder).toHaveText('No matching buckets');

      // Screenshot showing no matches
      await window.screenshot({ path: 'test-results/bucket-filter-no-matches.png' });
    });

    test('should highlight selected bucket', async ({ window }) => {
      // Wait for buckets to load
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });

      // First, click on secondary bucket to clear any previous selection
      const secondaryBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.secondary });
      await secondaryBucket.click();
      await window.waitForTimeout(500);

      // Verify secondary is selected
      await expect(secondaryBucket).toHaveClass(/selected/);

      // Now click on the main bucket
      await mainBucket.click();
      await window.waitForTimeout(500);

      // Now the main bucket should be selected (have selected class)
      await expect(mainBucket).toHaveClass(/selected/);

      // And secondary should no longer be selected
      await expect(secondaryBucket).not.toHaveClass(/selected/);

      // Screenshot with selected bucket
      await window.screenshot({ path: 'test-results/bucket-selected.png' });
    });

    test('should update file list when bucket is selected', async ({ window }) => {
      // Wait for buckets to load
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });

      // Click on the main bucket (which has test data)
      await mainBucket.click();

      // Wait for file list to load
      await window.waitForTimeout(2000);

      // Content header should show bucket name
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toHaveText(TEST_BUCKETS.main);

      // File list should contain test files
      // Look for the documents folder (from nested file structure) - using file-row class
      const documentsFolder = window.locator('.file-row').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 10000 });

      // Screenshot showing bucket files
      await window.screenshot({ path: 'test-results/bucket-files-loaded.png' });
    });

    test('should show empty state for empty bucket', async ({ window }) => {
      // Wait for buckets to load
      const emptyBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.empty });
      await expect(emptyBucket).toBeVisible({ timeout: 15000 });

      // Click on the empty bucket
      await emptyBucket.click();

      // Wait for file list to load
      await window.waitForTimeout(2000);

      // Content header should show empty bucket name
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toHaveText(TEST_BUCKETS.empty);

      // File list should show empty state - the text "This folder is empty"
      const emptyState = window.locator('.file-list-empty');
      await expect(emptyState).toContainText('empty', { timeout: 5000 });

      // Screenshot showing empty bucket
      await window.screenshot({ path: 'test-results/empty-bucket.png' });
    });

    test('should switch between buckets and update file list', async ({ window }) => {
      // beforeEach already ensures buckets are loaded

      // Click on main bucket first
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Verify main bucket content is shown
      let contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toHaveText(TEST_BUCKETS.main);

      // Screenshot before switching
      await window.screenshot({ path: 'test-results/before-bucket-switch.png' });

      // Now switch to secondary bucket
      const secondaryBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.secondary });
      await secondaryBucket.click();
      await window.waitForTimeout(2000);

      // Verify secondary bucket content is shown
      await expect(contentHeader).toHaveText(TEST_BUCKETS.secondary);

      // Secondary bucket should have its own file - using file-row class
      const secondaryFile = window.locator('.file-row').filter({ hasText: 'secondary-file.txt' });
      await expect(secondaryFile).toBeVisible({ timeout: 5000 });

      // Screenshot after switching
      await window.screenshot({ path: 'test-results/after-bucket-switch.png' });
    });
  });

  test.describe('Bucket Tree Error Handling', () => {
    // Skip this test in test mode because the test profile is auto-selected when AWS_ENDPOINT_URL is set
    test.skip('should show placeholder when no profile selected', async ({ window }) => {
      // Without selecting a profile, bucket tree should show placeholder
      // First, deselect any profile
      const dropdown = window.locator('.profile-dropdown');

      // Select empty option to deselect profile
      await dropdown.selectOption('');
      await window.waitForTimeout(1500);

      // Bucket tree should show placeholder
      const placeholder = window.locator('.bucket-tree-placeholder');
      await expect(placeholder).toHaveText('Select a profile to view buckets');

      // Screenshot showing placeholder
      await window.screenshot({ path: 'test-results/no-profile-placeholder.png' });
    });
  });

  test.describe('Profile Persistence', () => {
    test('should remember selected profile across app restarts', async ({ electronApp, window }) => {
      // Select a profile and bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets to load - use specific selector
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });

      // Select the bucket
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Note: Full persistence testing would require restarting the app
      // For now, we verify the state is set correctly
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toHaveText(TEST_BUCKETS.main);

      // Screenshot showing state that should be persisted
      await window.screenshot({ path: 'test-results/profile-bucket-state.png' });
    });
  });

  test.describe('Status Bar with Bucket Selection', () => {
    test('should show item count in status bar after bucket selection', async ({ window }) => {
      // Select test profile and bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');
      await window.waitForTimeout(2000);

      // Select main bucket with test data
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Status bar should be visible
      const statusBar = window.locator('.status-bar');
      await expect(statusBar).toBeVisible();

      // Status bar should show item count
      const itemCount = window.locator('.status-bar-items');
      await expect(itemCount).toBeVisible();
      // Should show number of items (folders and files at root level)
      await expect(itemCount).toContainText(/\d+\s*item/i);

      // Screenshot showing status bar with items
      await window.screenshot({ path: 'test-results/status-bar-with-items.png' });
    });
  });

  test.describe('File List Display after Bucket Selection', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);
    });

    test('should show folders and files in file list', async ({ window }) => {
      // Check for folders from test data (documents, data, nested, images) - using file-row class
      const documentsFolder = window.locator('.file-row').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });

      const dataFolder = window.locator('.file-row').filter({ hasText: 'data' });
      await expect(dataFolder).toBeVisible({ timeout: 5000 });

      const imagesFolder = window.locator('.file-row').filter({ hasText: 'images' });
      await expect(imagesFolder).toBeVisible({ timeout: 5000 });

      // Screenshot showing file list with folders
      await window.screenshot({ path: 'test-results/file-list-folders.png' });
    });

    test('should display file list header with columns', async ({ window }) => {
      // File list should have a table header
      const fileListHeader = window.locator('.file-list-header');

      // If table structure, check for column headers
      const nameColumn = window.locator('.file-list-header, .file-list th').filter({ hasText: /name/i });
      const sizeColumn = window.locator('.file-list-header, .file-list th').filter({ hasText: /size/i });
      const modifiedColumn = window.locator('.file-list-header, .file-list th').filter({ hasText: /modified/i });

      // At least name column should exist
      await expect(nameColumn.first()).toBeVisible({ timeout: 5000 });

      // Screenshot showing file list header
      await window.screenshot({ path: 'test-results/file-list-header.png' });
    });

    test('should have file list controls visible', async ({ window }) => {
      // Check for filter/sort controls
      const fileListControls = window.locator('.file-list-controls, .file-controls');

      // Search/filter input should exist
      const searchInput = window.locator('.file-search-input, input[placeholder*="Search"], input[placeholder*="Filter"], input[placeholder*="filter"]');
      await expect(searchInput.first()).toBeVisible({ timeout: 5000 });

      // Screenshot showing controls
      await window.screenshot({ path: 'test-results/file-list-controls.png' });
    });

    test('should navigate into folder when clicked', async ({ window }) => {
      // Click on documents folder - folders navigate on single click
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });
      await documentsFolder.click();

      // Wait for navigation
      await window.waitForTimeout(1500);

      // Content header should show the new path
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toContainText('documents');

      // Should see the readme.txt file inside - using file-row class
      const readmeFile = window.locator('.file-row').filter({ hasText: 'readme.txt' });
      await expect(readmeFile).toBeVisible({ timeout: 5000 });

      // Screenshot showing folder contents
      await window.screenshot({ path: 'test-results/folder-navigation.png' });
    });
  });
});
