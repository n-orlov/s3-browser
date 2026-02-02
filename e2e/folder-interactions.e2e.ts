import { test, expect, TEST_BUCKETS, getEndpoint } from './electron-fixtures';
import { TEST_DATA, getLocalStackS3Client } from './fixtures/localstack-setup';
import { PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

test.describe('Folder Interactions', () => {
  test.describe('Single Click on Folder (Selection)', () => {
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

    test('should select folder on single click without navigating', async ({ window }) => {
      // Get current breadcrumb content before click
      const breadcrumb = window.locator('.breadcrumb');
      const breadcrumbBefore = await breadcrumb.textContent();

      // Find a folder
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });

      // Single click on the folder
      await documentsFolder.click();
      await window.waitForTimeout(500);

      // Verify the folder is selected (has selected class)
      await expect(documentsFolder).toHaveClass(/selected/);

      // Verify we're still in the same prefix (breadcrumb should not change)
      const breadcrumbAfter = await breadcrumb.textContent();
      expect(breadcrumbAfter).toBe(breadcrumbBefore);

      // Content header should still show bucket name (not folder name)
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toHaveText(TEST_BUCKETS.main);

      // Screenshot showing folder selected without navigation
      await window.screenshot({ path: 'test-results/folder-single-click-select.png' });
    });

    test('should change selection when clicking another folder', async ({ window }) => {
      // Click on documents folder
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });
      await documentsFolder.click();
      await window.waitForTimeout(500);

      // Verify documents is selected
      await expect(documentsFolder).toHaveClass(/selected/);

      // Click on data folder
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await expect(dataFolder).toBeVisible({ timeout: 5000 });
      await dataFolder.click();
      await window.waitForTimeout(500);

      // Verify data folder is now selected
      await expect(dataFolder).toHaveClass(/selected/);

      // Verify documents folder is no longer selected
      await expect(documentsFolder).not.toHaveClass(/selected/);

      // Screenshot showing selection change
      await window.screenshot({ path: 'test-results/folder-selection-change.png' });
    });

    test('should enable properties button when folder is selected', async ({ window }) => {
      // Initially, properties button should be disabled (no selection)
      const propertiesButton = window.locator('button[title*="properties" i]');
      await expect(propertiesButton).toBeDisabled();

      // Select a folder
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });
      await documentsFolder.click();
      await window.waitForTimeout(500);

      // Properties button should now be enabled (shows folder properties)
      await expect(propertiesButton).toBeEnabled();

      // Screenshot showing enabled toolbar
      await window.screenshot({ path: 'test-results/folder-selection-properties-enabled.png' });
    });

    test('should show no selection in status bar when folder is selected', async ({ window }) => {
      // Select a folder
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });
      await documentsFolder.click();
      await window.waitForTimeout(500);

      // Verify folder is selected visually
      await expect(documentsFolder).toHaveClass(/selected/);

      // Status bar shows "No selection" for folders (only files are counted)
      const selection = window.locator('.status-bar-selection');
      await expect(selection).toBeVisible();
      await expect(selection).toContainText(/no selection/i);

      // Screenshot showing status bar with folder selected
      await window.screenshot({ path: 'test-results/folder-selection-status-bar.png' });
    });

    test('should multiselect folders with Ctrl+click', async ({ window }) => {
      // Select first folder
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });
      await documentsFolder.click();
      await window.waitForTimeout(300);

      // Ctrl+click to add second folder to selection
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await expect(dataFolder).toBeVisible({ timeout: 5000 });
      await dataFolder.click({ modifiers: ['Control'] });
      await window.waitForTimeout(300);

      // Both folders should be selected (either selected or multiselected class)
      await expect(documentsFolder).toHaveClass(/selected|multiselected/);
      await expect(dataFolder).toHaveClass(/selected|multiselected/);

      // Status bar shows "No selection" because only files are counted, not folders
      const selection = window.locator('.status-bar-selection');
      await expect(selection).toContainText(/no selection/i);

      // Screenshot showing multiselect
      await window.screenshot({ path: 'test-results/folder-multiselect-ctrl.png' });
    });
  });

  test.describe('Double Click on Folder (Navigation)', () => {
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
      // Find the documents folder
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });

      // Double click on the folder
      await documentsFolder.dblclick();
      await window.waitForTimeout(1500);

      // Verify navigation occurred - content header should show documents
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toContainText('documents');

      // Breadcrumb should show documents
      const breadcrumb = window.locator('.breadcrumb');
      await expect(breadcrumb).toContainText('documents');

      // Should see files inside documents folder
      const readmeFile = window.locator('.file-row').filter({ hasText: 'readme.txt' });
      await expect(readmeFile).toBeVisible({ timeout: 5000 });

      // Screenshot showing navigation result
      await window.screenshot({ path: 'test-results/folder-double-click-navigate.png' });
    });

    test('should clear selection after double click navigation', async ({ window }) => {
      // Find and double click the documents folder
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });
      await documentsFolder.dblclick();
      await window.waitForTimeout(1500);

      // Status bar should show no selection
      const selection = window.locator('.status-bar-selection');
      await expect(selection).toContainText(/no selection/i);

      // Delete button should be disabled (no selection)
      const deleteButton = window.locator('button[title*="Delete"]');
      await expect(deleteButton).toBeDisabled();

      // Screenshot showing cleared selection
      await window.screenshot({ path: 'test-results/folder-double-click-clear-selection.png' });
    });

    test('should navigate into nested folders with double click', async ({ window }) => {
      // Double click on nested folder
      const nestedFolder = window.locator('.file-row.folder').filter({ hasText: 'nested' });
      await expect(nestedFolder).toBeVisible({ timeout: 5000 });
      await nestedFolder.dblclick();
      await window.waitForTimeout(1500);

      // Verify we're in nested folder
      const breadcrumb = window.locator('.breadcrumb');
      await expect(breadcrumb).toContainText('nested');

      // Double click on level1 folder
      const level1Folder = window.locator('.file-row.folder').filter({ hasText: 'level1' });
      await expect(level1Folder).toBeVisible({ timeout: 5000 });
      await level1Folder.dblclick();
      await window.waitForTimeout(1500);

      // Verify we're in level1
      await expect(breadcrumb).toContainText('level1');

      // Screenshot showing nested navigation
      await window.screenshot({ path: 'test-results/folder-double-click-nested.png' });
    });

    test('should update navigation bar URL on double click navigation', async ({ window }) => {
      // Double click on documents folder
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });
      await documentsFolder.dblclick();
      await window.waitForTimeout(1500);

      // Navigation bar should show the new path
      const navInput = window.locator('.navigation-bar-input');
      await expect(navInput).toHaveValue(new RegExp(`s3://${TEST_BUCKETS.main}/documents/`));

      // Screenshot showing URL update
      await window.screenshot({ path: 'test-results/folder-double-click-url-update.png' });
    });
  });

  test.describe('Double Click on File (Download)', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and navigate to documents folder
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main bucket
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Navigate into documents folder (has files for testing)
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });
      await documentsFolder.dblclick();
      await window.waitForTimeout(1500);
    });

    test('should trigger download on file double click', async ({ window }) => {
      // Find a file
      const readmeFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await expect(readmeFile).toBeVisible({ timeout: 5000 });

      // Double click on the file
      await readmeFile.dblclick();

      // Wait for download toast to appear
      const toast = window.locator('.toast').filter({ hasText: /download/i });
      await expect(toast).toBeVisible({ timeout: 10000 });

      // Screenshot showing download toast
      await window.screenshot({ path: 'test-results/file-double-click-download.png' });
    });

    test('should show download complete toast with Show in folder action', async ({ window }) => {
      // Find and double click a file
      const readmeFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await expect(readmeFile).toBeVisible({ timeout: 5000 });
      await readmeFile.dblclick();

      // Wait for success toast
      const toast = window.locator('.toast').filter({ hasText: 'Download Complete' });
      await expect(toast).toBeVisible({ timeout: 10000 });

      // Should have "Show in folder" action button
      const showInFolderBtn = toast.locator('button').filter({ hasText: 'Show in folder' });
      await expect(showInFolderBtn).toBeVisible();

      // Screenshot showing toast with action
      await window.screenshot({ path: 'test-results/file-double-click-download-complete.png' });
    });

    test('should not navigate when double clicking file', async ({ window }) => {
      // Get current breadcrumb
      const breadcrumb = window.locator('.breadcrumb');
      const breadcrumbBefore = await breadcrumb.textContent();

      // Double click on a file
      const readmeFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await expect(readmeFile).toBeVisible({ timeout: 5000 });
      await readmeFile.dblclick();
      await window.waitForTimeout(1000);

      // Breadcrumb should remain the same (no navigation)
      const breadcrumbAfter = await breadcrumb.textContent();
      expect(breadcrumbAfter).toBe(breadcrumbBefore);

      // Should still be in documents folder
      await expect(breadcrumb).toContainText('documents');

      // Screenshot showing no navigation
      await window.screenshot({ path: 'test-results/file-double-click-no-navigate.png' });
    });
  });

  test.describe('Delete Folder Functionality', () => {
    /**
     * Note: The app's delete button is only enabled when the selection includes files.
     * Selecting only folders does not enable delete. To delete a folder, you must select
     * it together with at least one file in the same view.
     * These tests verify the folder warning appears when folders are part of the selection.
     */
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main bucket
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);
    });

    test('should show folder warning when deleting mixed selection of file and folder', async ({ window }) => {
      // Create a temp file at root to enable mixed selection
      const s3Client = getLocalStackS3Client();
      const timestamp = Date.now();
      const tempFileName = `temp-mixed-${timestamp}.txt`;

      await s3Client.send(new PutObjectCommand({
        Bucket: TEST_BUCKETS.main,
        Key: tempFileName,
        Body: 'Temporary file for mixed selection test',
        ContentType: 'text/plain',
      }));

      // Refresh to see the new file
      const refreshButton = window.locator('button[title="Refresh file list"]');
      await refreshButton.click();
      await window.waitForTimeout(2000);

      // Select the temp file first (this enables delete button)
      const tempFile = window.locator('.file-row.file').filter({ hasText: tempFileName });
      await expect(tempFile).toBeVisible({ timeout: 5000 });
      await tempFile.click();
      await window.waitForTimeout(300);

      // Ctrl+click to add a folder to selection
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await documentsFolder.click({ modifiers: ['Control'] });
      await window.waitForTimeout(300);

      // Click delete button
      const deleteButton = window.locator('button[title*="Delete"]');
      await expect(deleteButton).toBeEnabled();
      await deleteButton.click();

      // Confirmation dialog should appear
      const dialog = window.locator('.dialog, .modal, [role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Should show folder warning (because selection includes a folder)
      const folderWarning = dialog.locator('.dialog-warning-folder');
      await expect(folderWarning).toBeVisible();
      await expect(folderWarning).toContainText(/folder|contents/i);

      // Screenshot showing folder warning
      await window.screenshot({ path: 'test-results/delete-folder-warning.png' });

      // Cancel to not affect other tests
      const cancelButton = dialog.locator('button').filter({ hasText: /cancel/i });
      await cancelButton.click();

      // Clean up temp file
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: TEST_BUCKETS.main,
          Key: tempFileName,
        }));
      } catch {
        // Ignore cleanup errors
      }
    });

    test('should delete folder and its contents when confirmed', async ({ window }) => {
      // Create a temporary folder with content and a file at root for selection
      const s3Client = getLocalStackS3Client();
      const timestamp = Date.now();
      const tempFolderName = `temp-del-folder-${timestamp}`;
      const tempFolderKey = `${tempFolderName}/`;
      const tempFileInFolderKey = `${tempFolderName}/test-file.txt`;
      const tempFileAtRoot = `temp-root-file-${timestamp}.txt`;

      // Create folder marker
      await s3Client.send(new PutObjectCommand({
        Bucket: TEST_BUCKETS.main,
        Key: tempFolderKey,
        Body: '',
        ContentType: 'application/x-directory',
      }));

      // Create a file inside the folder
      await s3Client.send(new PutObjectCommand({
        Bucket: TEST_BUCKETS.main,
        Key: tempFileInFolderKey,
        Body: 'Temporary file inside folder for delete test',
        ContentType: 'text/plain',
      }));

      // Create a file at root (to enable delete button when selecting the folder)
      await s3Client.send(new PutObjectCommand({
        Bucket: TEST_BUCKETS.main,
        Key: tempFileAtRoot,
        Body: 'Temporary root file for delete test',
        ContentType: 'text/plain',
      }));

      // Refresh to see the new items
      const refreshButton = window.locator('button[title="Refresh file list"]');
      await refreshButton.click();
      await window.waitForTimeout(2000);

      // Select the root file first
      const tempRootFile = window.locator('.file-row.file').filter({ hasText: tempFileAtRoot.replace('.txt', '') });
      await expect(tempRootFile).toBeVisible({ timeout: 5000 });
      await tempRootFile.click();
      await window.waitForTimeout(300);

      // Ctrl+click to add the folder to selection
      const tempFolder = window.locator('.file-row.folder').filter({ hasText: tempFolderName });
      await expect(tempFolder).toBeVisible({ timeout: 5000 });
      await tempFolder.click({ modifiers: ['Control'] });
      await window.waitForTimeout(300);

      // Click delete button
      const deleteButton = window.locator('button[title*="Delete"]');
      await expect(deleteButton).toBeEnabled();
      await deleteButton.click();

      // Wait for confirmation dialog
      const dialog = window.locator('.dialog, .modal, [role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Verify folder warning is shown
      const folderWarning = dialog.locator('.dialog-warning-folder');
      await expect(folderWarning).toBeVisible();

      // Click confirm/delete button
      const confirmButton = dialog.locator('button').filter({ hasText: /delete|confirm|yes/i });
      await confirmButton.click();

      // Wait for operation to complete
      await window.waitForTimeout(3000);

      // Both folder and file should no longer be visible
      await expect(tempFolder).not.toBeVisible({ timeout: 5000 });
      await expect(tempRootFile).not.toBeVisible({ timeout: 5000 });

      // Screenshot showing items deleted
      await window.screenshot({ path: 'test-results/delete-folder-complete.png' });

      // Verify folder contents are actually deleted in S3
      const listResult = await s3Client.send(new ListObjectsV2Command({
        Bucket: TEST_BUCKETS.main,
        Prefix: tempFolderKey,
      }));
      expect(listResult.Contents?.length ?? 0).toBe(0);
    });

    test('should show count badge when multiple items including folders are selected', async ({ window }) => {
      // Create temp files at root level
      const s3Client = getLocalStackS3Client();
      const timestamp = Date.now();
      const tempFile1 = `temp-badge-1-${timestamp}.txt`;
      const tempFile2 = `temp-badge-2-${timestamp}.txt`;

      await s3Client.send(new PutObjectCommand({
        Bucket: TEST_BUCKETS.main,
        Key: tempFile1,
        Body: 'Temp file 1',
        ContentType: 'text/plain',
      }));

      await s3Client.send(new PutObjectCommand({
        Bucket: TEST_BUCKETS.main,
        Key: tempFile2,
        Body: 'Temp file 2',
        ContentType: 'text/plain',
      }));

      // Refresh
      const refreshButton = window.locator('button[title="Refresh file list"]');
      await refreshButton.click();
      await window.waitForTimeout(2000);

      // Select first file
      const file1 = window.locator('.file-row.file').filter({ hasText: tempFile1.replace('.txt', '') });
      await expect(file1).toBeVisible({ timeout: 5000 });
      await file1.click();
      await window.waitForTimeout(300);

      // Ctrl+click second file
      const file2 = window.locator('.file-row.file').filter({ hasText: tempFile2.replace('.txt', '') });
      await expect(file2).toBeVisible({ timeout: 5000 });
      await file2.click({ modifiers: ['Control'] });
      await window.waitForTimeout(300);

      // Ctrl+click a folder
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await documentsFolder.click({ modifiers: ['Control'] });
      await window.waitForTimeout(300);

      // Delete button should show badge with count (only counts files, not folders)
      // The badge shows count of files in the selection
      const badge = window.locator('.toolbar-badge');
      await expect(badge).toHaveText('2');

      // Screenshot showing badge
      await window.screenshot({ path: 'test-results/delete-multiselect-badge.png' });

      // Clean up
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: TEST_BUCKETS.main,
          Key: tempFile1,
        }));
        await s3Client.send(new DeleteObjectCommand({
          Bucket: TEST_BUCKETS.main,
          Key: tempFile2,
        }));
      } catch {
        // Ignore cleanup errors
      }
    });

    test('should recursively delete folder with deeply nested subfolders', async ({ window }) => {
      // Create a deeply nested folder structure to test recursive deletion
      const s3Client = getLocalStackS3Client();
      const timestamp = Date.now();
      const rootFolderName = `deep-nested-${timestamp}`;

      // Create folder structure: rootFolder/level1/level2/level3/ with files at each level
      const keysToCreate = [
        `${rootFolderName}/`,                                    // Root folder marker
        `${rootFolderName}/root-file.txt`,                      // File at root
        `${rootFolderName}/level1/`,                            // Level 1 folder marker
        `${rootFolderName}/level1/level1-file.txt`,             // File at level 1
        `${rootFolderName}/level1/level2/`,                     // Level 2 folder marker
        `${rootFolderName}/level1/level2/level2-file.txt`,      // File at level 2
        `${rootFolderName}/level1/level2/level3/`,              // Level 3 folder marker
        `${rootFolderName}/level1/level2/level3/level3-file.txt`, // File at level 3
        `${rootFolderName}/level1/sibling/`,                    // Sibling folder at level 1
        `${rootFolderName}/level1/sibling/sibling-file.txt`,    // File in sibling
      ];

      // Create all objects in S3
      for (const key of keysToCreate) {
        await s3Client.send(new PutObjectCommand({
          Bucket: TEST_BUCKETS.main,
          Key: key,
          Body: key.endsWith('/') ? '' : `Content of ${key}`,
          ContentType: key.endsWith('/') ? 'application/x-directory' : 'text/plain',
        }));
      }

      // Also create a file at root level to enable delete button
      const enablerFile = `enabler-file-${timestamp}.txt`;
      await s3Client.send(new PutObjectCommand({
        Bucket: TEST_BUCKETS.main,
        Key: enablerFile,
        Body: 'Enabler file',
        ContentType: 'text/plain',
      }));

      // Refresh to see the new items
      const refreshButton = window.locator('button[title="Refresh file list"]');
      await refreshButton.click();
      await window.waitForTimeout(2000);

      // Select the enabler file first (enables delete button)
      const enablerFileRow = window.locator('.file-row.file').filter({ hasText: enablerFile.replace('.txt', '') });
      await expect(enablerFileRow).toBeVisible({ timeout: 5000 });
      await enablerFileRow.click();
      await window.waitForTimeout(300);

      // Ctrl+click to add the deep nested folder to selection
      const deepFolder = window.locator('.file-row.folder').filter({ hasText: rootFolderName });
      await expect(deepFolder).toBeVisible({ timeout: 5000 });
      await deepFolder.click({ modifiers: ['Control'] });
      await window.waitForTimeout(300);

      // Click delete button
      const deleteButton = window.locator('button[title*="Delete"]');
      await expect(deleteButton).toBeEnabled();
      await deleteButton.click();

      // Wait for confirmation dialog
      const dialog = window.locator('.dialog, .modal, [role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Click confirm/delete button
      const confirmButton = dialog.locator('button').filter({ hasText: /delete|confirm|yes/i });
      await confirmButton.click();

      // Wait for operation to complete
      await window.waitForTimeout(5000);

      // Both folder and enabler file should no longer be visible
      await expect(deepFolder).not.toBeVisible({ timeout: 5000 });
      await expect(enablerFileRow).not.toBeVisible({ timeout: 5000 });

      // Screenshot showing items deleted
      await window.screenshot({ path: 'test-results/delete-deeply-nested-folder-complete.png' });

      // Verify ALL nested objects are actually deleted in S3
      const listResult = await s3Client.send(new ListObjectsV2Command({
        Bucket: TEST_BUCKETS.main,
        Prefix: `${rootFolderName}/`,
      }));

      // Should be completely empty - all nested levels should be deleted
      expect(listResult.Contents?.length ?? 0).toBe(0);

      // Clean up enabler file if it wasn't deleted
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: TEST_BUCKETS.main,
          Key: enablerFile,
        }));
      } catch {
        // Ignore - may already be deleted
      }
    });

    test('should cancel folder delete when clicking cancel', async ({ window }) => {
      // Create a temp file to enable delete button
      const s3Client = getLocalStackS3Client();
      const timestamp = Date.now();
      const tempFileName = `temp-cancel-${timestamp}.txt`;

      await s3Client.send(new PutObjectCommand({
        Bucket: TEST_BUCKETS.main,
        Key: tempFileName,
        Body: 'Temporary file for cancel delete test',
        ContentType: 'text/plain',
      }));

      // Refresh
      const refreshButton = window.locator('button[title="Refresh file list"]');
      await refreshButton.click();
      await window.waitForTimeout(2000);

      // Select the temp file first
      const tempFile = window.locator('.file-row.file').filter({ hasText: tempFileName.replace('.txt', '') });
      await expect(tempFile).toBeVisible({ timeout: 5000 });
      await tempFile.click();
      await window.waitForTimeout(300);

      // Ctrl+click to add a folder
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await documentsFolder.click({ modifiers: ['Control'] });
      await window.waitForTimeout(300);

      // Click delete button
      const deleteButton = window.locator('button[title*="Delete"]');
      await expect(deleteButton).toBeEnabled();
      await deleteButton.click();

      // Wait for dialog
      const dialog = window.locator('.dialog, .modal, [role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Click cancel
      const cancelButton = dialog.locator('button').filter({ hasText: /cancel|no/i });
      await cancelButton.click();

      // Dialog should close
      await expect(dialog).not.toBeVisible({ timeout: 3000 });

      // Both items should still be there
      await expect(tempFile).toBeVisible();
      await expect(documentsFolder).toBeVisible();

      // Screenshot showing cancelled delete
      await window.screenshot({ path: 'test-results/delete-folder-cancelled.png' });

      // Clean up temp file
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: TEST_BUCKETS.main,
          Key: tempFileName,
        }));
      } catch {
        // Ignore cleanup errors
      }
    });
  });
});
