import { test, expect, TEST_BUCKETS, getEndpoint } from './electron-fixtures';
import { TEST_DATA, getLocalStackS3Client } from './fixtures/localstack-setup';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

test.describe('File Navigation and Selection', () => {
  test.describe('Folder Navigation', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets to load
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });

      // Select the main bucket
      await mainBucket.click();
      await window.waitForTimeout(2000);
    });

    test('should navigate into folder on double click', async ({ window }) => {
      // Find and double-click on documents folder
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });
      await documentsFolder.dblclick();

      // Wait for navigation
      await window.waitForTimeout(1500);

      // Verify we're inside documents folder - content header should show the path
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toContainText('documents');

      // Breadcrumb should show documents
      const breadcrumb = window.locator('.breadcrumb');
      await expect(breadcrumb).toContainText('documents');

      // Screenshot showing folder navigation
      await window.screenshot({ path: 'test-results/navigation-into-folder.png' });
    });

    test('should navigate into nested folders', async ({ window }) => {
      // Navigate into nested folder structure: nested/level1/level2
      const nestedFolder = window.locator('.file-row.folder').filter({ hasText: 'nested' });
      await expect(nestedFolder).toBeVisible({ timeout: 5000 });
      await nestedFolder.dblclick();
      await window.waitForTimeout(1500);

      // Verify we're in nested folder
      const breadcrumb = window.locator('.breadcrumb');
      await expect(breadcrumb).toContainText('nested');

      // Navigate into level1
      const level1Folder = window.locator('.file-row.folder').filter({ hasText: 'level1' });
      await expect(level1Folder).toBeVisible({ timeout: 5000 });
      await level1Folder.dblclick();
      await window.waitForTimeout(1500);

      // Verify we're in level1
      await expect(breadcrumb).toContainText('level1');

      // Navigate into level2
      const level2Folder = window.locator('.file-row.folder').filter({ hasText: 'level2' });
      await expect(level2Folder).toBeVisible({ timeout: 5000 });
      await level2Folder.dblclick();
      await window.waitForTimeout(1500);

      // Verify we're in level2 and can see the deep file
      await expect(breadcrumb).toContainText('level2');
      const deepFile = window.locator('.file-row').filter({ hasText: 'deep-file.txt' });
      await expect(deepFile).toBeVisible({ timeout: 5000 });

      // Screenshot showing nested navigation
      await window.screenshot({ path: 'test-results/navigation-nested-folders.png' });
    });

    test('should navigate up using "Up" button', async ({ window }) => {
      // Navigate into documents folder first (double-click to navigate)
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });
      await documentsFolder.dblclick();
      await window.waitForTimeout(1500);

      // Verify we're in documents
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toContainText('documents');

      // Click the Up button
      const upButton = window.locator('.go-up-btn');
      await expect(upButton).toBeVisible();
      await upButton.click();
      await window.waitForTimeout(1500);

      // Verify we're back at root
      await expect(contentHeader).toHaveText(TEST_BUCKETS.main);

      // Screenshot showing navigation up
      await window.screenshot({ path: 'test-results/navigation-up-button.png' });
    });

    test('should navigate using breadcrumb clicks', async ({ window }) => {
      // Navigate deep: nested/level1/level2 (double-click to navigate into folders)
      const nestedFolder = window.locator('.file-row.folder').filter({ hasText: 'nested' });
      await nestedFolder.dblclick();
      await window.waitForTimeout(1000);

      const level1Folder = window.locator('.file-row.folder').filter({ hasText: 'level1' });
      await level1Folder.dblclick();
      await window.waitForTimeout(1000);

      const level2Folder = window.locator('.file-row.folder').filter({ hasText: 'level2' });
      await level2Folder.dblclick();
      await window.waitForTimeout(1000);

      // Now click on "nested" breadcrumb to go back
      const nestedBreadcrumb = window.locator('.breadcrumb-item').filter({ hasText: 'nested' });
      await expect(nestedBreadcrumb).toBeVisible();
      await nestedBreadcrumb.click();
      await window.waitForTimeout(1500);

      // Verify we're back in nested folder (should see level1)
      const level1FolderAgain = window.locator('.file-row.folder').filter({ hasText: 'level1' });
      await expect(level1FolderAgain).toBeVisible({ timeout: 5000 });

      // Click on bucket breadcrumb to go to root
      const bucketBreadcrumb = window.locator('.breadcrumb-bucket');
      await bucketBreadcrumb.click();
      await window.waitForTimeout(1500);

      // Verify we're at root (should see all top-level folders)
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });

      // Screenshot showing breadcrumb navigation
      await window.screenshot({ path: 'test-results/navigation-breadcrumb.png' });
    });
  });

  test.describe('File Selection', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and navigate to documents folder
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main bucket
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Navigate into documents folder (double-click to navigate, has multiple files for selection testing)
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await documentsFolder.dblclick();
      await window.waitForTimeout(1500);
    });

    test('should select file on single click', async ({ window }) => {
      // Click on readme.txt file
      const readmeFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await expect(readmeFile).toBeVisible({ timeout: 5000 });
      await readmeFile.click();

      // Verify file is selected (has selected class)
      await expect(readmeFile).toHaveClass(/selected/);

      // Screenshot showing file selection
      await window.screenshot({ path: 'test-results/file-single-selection.png' });
    });

    test('should change selection when clicking another file', async ({ window }) => {
      // Select readme.txt first
      const readmeFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await readmeFile.click();
      await expect(readmeFile).toHaveClass(/selected/);

      // Now select file1.txt
      const file1 = window.locator('.file-row.file').filter({ hasText: 'file1.txt' });
      await file1.click();

      // file1 should be selected
      await expect(file1).toHaveClass(/selected/);

      // readme.txt should no longer be selected
      await expect(readmeFile).not.toHaveClass(/selected/);

      // Screenshot showing selection change
      await window.screenshot({ path: 'test-results/file-selection-change.png' });
    });

    test('should multi-select files with Ctrl+click', async ({ window }) => {
      // Select first file
      const file1 = window.locator('.file-row.file').filter({ hasText: 'file1.txt' });
      await file1.click();
      await expect(file1).toHaveClass(/selected/);

      // Ctrl+click to add second file to selection
      const file2 = window.locator('.file-row.file').filter({ hasText: 'file2.txt' });
      await file2.click({ modifiers: ['Control'] });

      // Both files should be selected (file1 multiselected, file2 selected)
      await expect(file1).toHaveClass(/selected|multiselected/);
      await expect(file2).toHaveClass(/selected|multiselected/);

      // Status bar should show selection count/size
      const statusBar = window.locator('.status-bar');
      await expect(statusBar).toBeVisible();

      // Screenshot showing multi-selection with Ctrl
      await window.screenshot({ path: 'test-results/file-multiselect-ctrl.png' });
    });

    test('should deselect file with Ctrl+click on already selected file', async ({ window }) => {
      // Select two files with Ctrl+click
      const file1 = window.locator('.file-row.file').filter({ hasText: 'file1.txt' });
      const file2 = window.locator('.file-row.file').filter({ hasText: 'file2.txt' });

      await file1.click();
      await file2.click({ modifiers: ['Control'] });

      // Both should be selected
      await expect(file1).toHaveClass(/selected|multiselected/);
      await expect(file2).toHaveClass(/selected|multiselected/);

      // Ctrl+click on file1 to deselect it
      await file1.click({ modifiers: ['Control'] });

      // file1 should no longer be selected
      await expect(file1).not.toHaveClass(/selected/);
      await expect(file1).not.toHaveClass(/multiselected/);

      // file2 should still be selected
      await expect(file2).toHaveClass(/selected/);

      // Screenshot showing deselection
      await window.screenshot({ path: 'test-results/file-multiselect-deselect.png' });
    });

    test('should range-select files with Shift+click', async ({ window }) => {
      // Get all file rows to understand the order
      const file1 = window.locator('.file-row.file').filter({ hasText: 'file1.txt' });
      const file2 = window.locator('.file-row.file').filter({ hasText: 'file2.txt' });
      const file3 = window.locator('.file-row.file').filter({ hasText: 'file3.txt' });
      const file4 = window.locator('.file-row.file').filter({ hasText: 'file4.txt' });

      // Click on file1 first (sets anchor)
      await file1.click();
      await expect(file1).toHaveClass(/selected/);

      // Shift+click on file4 to select range
      await file4.click({ modifiers: ['Shift'] });

      // All files from file1 to file4 should be selected
      await expect(file1).toHaveClass(/selected|multiselected/);
      await expect(file2).toHaveClass(/selected|multiselected/);
      await expect(file3).toHaveClass(/selected|multiselected/);
      await expect(file4).toHaveClass(/selected|multiselected/);

      // Screenshot showing range selection
      await window.screenshot({ path: 'test-results/file-multiselect-shift-range.png' });
    });

    test('should clear multi-selection on single click', async ({ window }) => {
      // Multi-select some files
      const file1 = window.locator('.file-row.file').filter({ hasText: 'file1.txt' });
      const file2 = window.locator('.file-row.file').filter({ hasText: 'file2.txt' });
      const file3 = window.locator('.file-row.file').filter({ hasText: 'file3.txt' });

      await file1.click();
      await file2.click({ modifiers: ['Control'] });
      await file3.click({ modifiers: ['Control'] });

      // All three should be selected
      await expect(file1).toHaveClass(/selected|multiselected/);
      await expect(file2).toHaveClass(/selected|multiselected/);
      await expect(file3).toHaveClass(/selected|multiselected/);

      // Single click on readme.txt (no modifiers)
      const readmeFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await readmeFile.click();

      // Only readme should be selected now
      await expect(readmeFile).toHaveClass(/selected/);
      await expect(file1).not.toHaveClass(/selected/);
      await expect(file1).not.toHaveClass(/multiselected/);
      await expect(file2).not.toHaveClass(/selected/);
      await expect(file3).not.toHaveClass(/selected/);

      // Screenshot showing cleared selection
      await window.screenshot({ path: 'test-results/file-multiselect-cleared.png' });
    });

    test('should select folders on single click without navigating', async ({ window }) => {
      // Go back to root to have both files and folders
      const upButton = window.locator('.go-up-btn');
      await upButton.click();
      await window.waitForTimeout(1500);

      // Find data folder
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await expect(dataFolder).toBeVisible({ timeout: 5000 });

      // Single click on folder selects it (doesn't navigate)
      await dataFolder.click();
      await window.waitForTimeout(500);

      // Folder should be selected
      await expect(dataFolder).toHaveClass(/selected/);

      // We should still be at root (not inside data folder)
      const breadcrumb = window.locator('.breadcrumb');
      // Breadcrumb should NOT contain 'data' as a path segment
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toHaveText(TEST_BUCKETS.main);

      // Screenshot showing folder selection (not navigation)
      await window.screenshot({ path: 'test-results/folder-click-selects.png' });
    });
  });

  test.describe('S3 URL Navigation', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets to load
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
    });

    test('should have navigation bar visible', async ({ window }) => {
      const navBar = window.locator('.navigation-bar');
      await expect(navBar).toBeVisible();

      const navInput = window.locator('.navigation-bar-input');
      await expect(navInput).toBeVisible();

      // Screenshot showing navigation bar
      await window.screenshot({ path: 'test-results/url-navigation-bar.png' });
    });

    test('should navigate to bucket via S3 URL', async ({ window }) => {
      const navInput = window.locator('.navigation-bar-input');
      const goButton = window.locator('.navigation-bar-go-btn');

      // Enter S3 URL for test bucket
      await navInput.fill(`s3://${TEST_BUCKETS.main}/`);

      // Click Go button
      await goButton.click();
      await window.waitForTimeout(2000);

      // Content header should show the bucket name
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toHaveText(TEST_BUCKETS.main);

      // Should see folders in the bucket
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });

      // Screenshot showing URL navigation to bucket
      await window.screenshot({ path: 'test-results/url-navigate-bucket.png' });
    });

    test('should navigate to folder via S3 URL', async ({ window }) => {
      const navInput = window.locator('.navigation-bar-input');
      const goButton = window.locator('.navigation-bar-go-btn');

      // Enter S3 URL for documents folder
      await navInput.fill(`s3://${TEST_BUCKETS.main}/documents/`);

      // Click Go button
      await goButton.click();
      await window.waitForTimeout(2000);

      // Content header should show documents path
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toContainText('documents');

      // Breadcrumb should show documents
      const breadcrumb = window.locator('.breadcrumb');
      await expect(breadcrumb).toContainText('documents');

      // Should see files inside documents
      const readmeFile = window.locator('.file-row').filter({ hasText: 'readme.txt' });
      await expect(readmeFile).toBeVisible({ timeout: 5000 });

      // Screenshot showing URL navigation to folder
      await window.screenshot({ path: 'test-results/url-navigate-folder.png' });
    });

    test('should navigate to file URL and select the file', async ({ window }) => {
      const navInput = window.locator('.navigation-bar-input');
      const goButton = window.locator('.navigation-bar-go-btn');

      // Enter S3 URL for a specific file
      await navInput.fill(`s3://${TEST_BUCKETS.main}/documents/readme.txt`);

      // Click Go button
      await goButton.click();
      await window.waitForTimeout(3000);

      // Should be in documents folder
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toContainText('documents');

      // The file should be visible and selected
      const readmeFile = window.locator('.file-row').filter({ hasText: 'readme.txt' });
      await expect(readmeFile).toBeVisible({ timeout: 5000 });
      await expect(readmeFile).toHaveClass(/selected/);

      // Screenshot showing file URL navigation with selection
      await window.screenshot({ path: 'test-results/url-navigate-file-selected.png' });
    });

    test('should navigate via Enter key in URL input', async ({ window }) => {
      const navInput = window.locator('.navigation-bar-input');

      // Enter S3 URL and press Enter
      await navInput.fill(`s3://${TEST_BUCKETS.main}/data/`);
      await navInput.press('Enter');
      await window.waitForTimeout(2000);

      // Should be in data folder
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toContainText('data');

      // Should see config.json
      const configFile = window.locator('.file-row').filter({ hasText: 'config.json' });
      await expect(configFile).toBeVisible({ timeout: 5000 });

      // Screenshot showing Enter key navigation
      await window.screenshot({ path: 'test-results/url-navigate-enter-key.png' });
    });

    test('should show error for invalid S3 URL', async ({ window }) => {
      const navInput = window.locator('.navigation-bar-input');
      const goButton = window.locator('.navigation-bar-go-btn');

      // Enter invalid URL
      await navInput.focus();
      await navInput.fill('not-a-valid-url');

      // Click Go button - this triggers validation synchronously before blur
      await goButton.click();

      // The error message should appear immediately after clicking Go
      // Wait for it with a short timeout
      const errorMessage = window.locator('.navigation-bar-error');
      await expect(errorMessage).toBeVisible({ timeout: 2000 });
      await expect(errorMessage).toContainText('Invalid');

      // Screenshot showing URL error (need to capture before blur clears it)
      await window.screenshot({ path: 'test-results/url-navigate-error.png' });
    });

    test('should support HTTPS URL format', async ({ window }) => {
      const navInput = window.locator('.navigation-bar-input');
      const goButton = window.locator('.navigation-bar-go-btn');

      // Enter HTTPS S3 URL format
      await navInput.fill(`https://${TEST_BUCKETS.main}.s3.us-east-1.amazonaws.com/documents/`);
      await goButton.click();
      await window.waitForTimeout(2000);

      // Should navigate to documents folder
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toContainText('documents');

      // Screenshot showing HTTPS URL navigation
      await window.screenshot({ path: 'test-results/url-navigate-https.png' });
    });

    test('should update navigation bar URL when navigating', async ({ window }) => {
      // First select a bucket
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Navigation bar should show bucket URL
      const navInput = window.locator('.navigation-bar-input');
      await expect(navInput).toHaveValue(new RegExp(`s3://${TEST_BUCKETS.main}/`));

      // Navigate into documents folder (double-click to navigate)
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await documentsFolder.dblclick();
      await window.waitForTimeout(1500);

      // Navigation bar should update to show documents path
      await expect(navInput).toHaveValue(new RegExp(`s3://${TEST_BUCKETS.main}/documents/`));

      // Screenshot showing URL update on navigation
      await window.screenshot({ path: 'test-results/url-updates-on-navigate.png' });
    });

    test('should cancel URL input with Escape key', async ({ window }) => {
      // First select a bucket so we have a current location
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      const navInput = window.locator('.navigation-bar-input');
      const originalValue = await navInput.inputValue();

      // Start typing a new URL
      await navInput.fill(`s3://${TEST_BUCKETS.secondary}/`);

      // Press Escape to cancel
      await navInput.press('Escape');
      await window.waitForTimeout(500);

      // Should revert to original value
      await expect(navInput).toHaveValue(originalValue);

      // Screenshot showing Escape cancel
      await window.screenshot({ path: 'test-results/url-escape-cancel.png' });
    });
  });

  test.describe('Keyboard Navigation', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and navigate to documents folder
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Navigate into documents folder (double-click to navigate)
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await documentsFolder.dblclick();
      await window.waitForTimeout(1500);
    });

    test('should select file with Enter key', async ({ window }) => {
      // Focus on a file row first
      const file1 = window.locator('.file-row.file').filter({ hasText: 'file1.txt' });
      await file1.focus();

      // Press Enter to select
      await file1.press('Enter');
      await window.waitForTimeout(500);

      // File should be selected
      await expect(file1).toHaveClass(/selected/);

      // Screenshot showing Enter key selection
      await window.screenshot({ path: 'test-results/keyboard-enter-select.png' });
    });
  });

  test.describe('Infinite Scroll / Pagination', () => {
    // This test creates >100 folders (the default page size) and verifies
    // that scrolling loads additional pages, including new prefixes.
    const PAGINATION_PREFIX = 'pagination-test/';
    const FOLDER_COUNT = 120; // More than the default maxKeys of 100

    test.beforeEach(async ({ window }) => {
      const s3Client = getLocalStackS3Client();

      // Create 120 folders by putting a marker file in each
      const putPromises = [];
      for (let i = 0; i < FOLDER_COUNT; i++) {
        const folderName = `folder-${String(i).padStart(4, '0')}`;
        putPromises.push(
          s3Client.send(new PutObjectCommand({
            Bucket: TEST_BUCKETS.main,
            Key: `${PAGINATION_PREFIX}${folderName}/marker.txt`,
            Body: `File in ${folderName}`,
            ContentType: 'text/plain',
          }))
        );
      }
      await Promise.all(putPromises);

      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Navigate into pagination-test folder
      const paginationFolder = window.locator('.file-row.folder').filter({ hasText: 'pagination-test' });
      await expect(paginationFolder).toBeVisible({ timeout: 5000 });
      await paginationFolder.dblclick();
      await window.waitForTimeout(2000);
    });

    test.afterEach(async () => {
      // Clean up the pagination test data
      const s3Client = getLocalStackS3Client();
      const deletePromises = [];
      for (let i = 0; i < FOLDER_COUNT; i++) {
        const folderName = `folder-${String(i).padStart(4, '0')}`;
        deletePromises.push(
          s3Client.send(new DeleteObjectCommand({
            Bucket: TEST_BUCKETS.main,
            Key: `${PAGINATION_PREFIX}${folderName}/marker.txt`,
          })).catch(() => {})
        );
      }
      await Promise.all(deletePromises);
    });

    test('should load all folders via infinite scroll beyond initial page', async ({ window }) => {
      // Initially some folders should be visible
      const firstFolder = window.locator('.file-row.folder').filter({ hasText: 'folder-0000' });
      await expect(firstFolder).toBeVisible({ timeout: 5000 });

      // Check if "Scroll to load more" indicator is present (means there are more items)
      const hasMore = window.locator('.file-list-has-more');
      const loadingMore = window.locator('.file-list-loading-more');

      // Scroll to the bottom to trigger loading more items
      const tableWrapper = window.locator('.file-list-table-wrapper');

      // Keep scrolling until all items are loaded
      let attempts = 0;
      while (attempts < 20) {
        const hasMoreVisible = await hasMore.isVisible().catch(() => false);
        const loadingMoreVisible = await loadingMore.isVisible().catch(() => false);

        if (!hasMoreVisible && !loadingMoreVisible) {
          break; // All loaded
        }

        // Scroll to bottom
        await tableWrapper.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await window.waitForTimeout(1000);
        attempts++;
      }

      // The last folder (folder-0119) should be visible after scrolling through all pages
      const lastFolder = window.locator('.file-row.folder').filter({ hasText: 'folder-0119' });
      await expect(lastFolder).toBeVisible({ timeout: 10000 });

      // Count all visible folder rows to verify all 120 are loaded
      const folderRows = window.locator('.file-row.folder');
      const count = await folderRows.count();
      expect(count).toBe(FOLDER_COUNT);

      // Screenshot showing all items loaded
      await window.screenshot({ path: 'test-results/pagination-all-loaded.png' });
    });
  });
});
