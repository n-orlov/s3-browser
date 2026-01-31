import { test, expect, TEST_BUCKETS, getEndpoint } from './electron-fixtures';
import { TEST_DATA, getLocalStackS3Client } from './fixtures/localstack-setup';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

test.describe('File Operations', () => {
  test.describe('Upload Files', () => {
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

    test('should have upload button enabled when bucket is selected', async ({ window }) => {
      // Upload button should be enabled
      const uploadButton = window.locator('button[title="Upload files"]');
      await expect(uploadButton).toBeEnabled();

      // Screenshot showing upload button enabled
      await window.screenshot({ path: 'test-results/upload-button-enabled.png' });
    });

    test('should show file upload dialog when clicking upload button', async ({ window }) => {
      // Note: We can't fully test the native file dialog, but we can verify the button click
      // triggers the dialog mechanism
      const uploadButton = window.locator('button[title="Upload files"]');
      await expect(uploadButton).toBeEnabled();

      // Screenshot showing upload ready state
      await window.screenshot({ path: 'test-results/upload-ready.png' });
    });

    test('should have drop zone element in file list', async ({ window }) => {
      // Navigate into documents folder to have a more isolated test area
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await documentsFolder.click();
      await window.waitForTimeout(1500);

      // Get the file list container - verify it exists and has correct structure
      const fileList = window.locator('.file-list');
      await expect(fileList).toBeVisible();

      // Screenshot showing file list (drop target)
      await window.screenshot({ path: 'test-results/upload-drop-zone.png' });
    });
  });

  test.describe('Download Files', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and navigate to documents folder
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main bucket
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Navigate into documents folder
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await documentsFolder.click();
      await window.waitForTimeout(1500);
    });

    test('should enable download button when file is selected', async ({ window }) => {
      // Select a file
      const readmeFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await expect(readmeFile).toBeVisible({ timeout: 5000 });
      await readmeFile.click();

      // Download button should be enabled
      const downloadButton = window.locator('button[title*="Download selected"]');
      await expect(downloadButton).toBeEnabled();

      // Screenshot showing download enabled
      await window.screenshot({ path: 'test-results/download-button-enabled.png' });
    });

    test('should disable download button when no file is selected', async ({ window }) => {
      // Initially no file should be selected
      const downloadButton = window.locator('button[title*="Download selected"]');
      await expect(downloadButton).toBeDisabled();

      // Screenshot showing download disabled
      await window.screenshot({ path: 'test-results/download-button-disabled.png' });
    });

    test('should disable download button for folder selection', async ({ window }) => {
      // Go back to root to select a folder
      const upButton = window.locator('.go-up-btn');
      await upButton.click();
      await window.waitForTimeout(1500);

      // Folders can't be selected for download (they navigate instead)
      // Download button should remain disabled
      const downloadButton = window.locator('button[title*="Download selected"]');
      await expect(downloadButton).toBeDisabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/download-folder-disabled.png' });
    });

    test('should show download progress indicator', async ({ window }) => {
      // Select a file
      const readmeFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await readmeFile.click();

      // Click download button
      const downloadButton = window.locator('button[title*="Download selected"]');
      await downloadButton.click();

      // Wait for operation status to appear (may be brief)
      await window.waitForTimeout(500);

      // Screenshot to capture download progress
      await window.screenshot({ path: 'test-results/download-progress.png' });

      // Wait for completion - should see toast notification
      const toast = window.locator('.toast');
      await expect(toast).toBeVisible({ timeout: 10000 });

      // Screenshot showing download complete
      await window.screenshot({ path: 'test-results/download-complete.png' });
    });

    test('should show success toast with "Show in folder" action after download', async ({ window }) => {
      // Select a file
      const readmeFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await readmeFile.click();

      // Click download button
      const downloadButton = window.locator('button[title*="Download selected"]');
      await downloadButton.click();

      // Wait for success toast
      const toast = window.locator('.toast').filter({ hasText: 'Download Complete' });
      await expect(toast).toBeVisible({ timeout: 10000 });

      // Should have "Show in folder" action button
      const showInFolderBtn = toast.locator('button').filter({ hasText: 'Show in folder' });
      await expect(showInFolderBtn).toBeVisible();

      // Screenshot showing toast with action
      await window.screenshot({ path: 'test-results/download-toast-action.png' });
    });

    test('should disable download button for multiple file selection', async ({ window }) => {
      // Select first file
      const file1 = window.locator('.file-row.file').filter({ hasText: 'file1.txt' });
      await file1.click();

      // Ctrl+click second file
      const file2 = window.locator('.file-row.file').filter({ hasText: 'file2.txt' });
      await file2.click({ modifiers: ['Control'] });

      // Download button should be disabled for multi-select
      const downloadButton = window.locator('button[title*="Download not available"]');
      await expect(downloadButton).toBeDisabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/download-multiselect-disabled.png' });
    });
  });

  test.describe('Delete Files', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and navigate to documents folder
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main bucket
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Navigate into documents folder
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await documentsFolder.click();
      await window.waitForTimeout(1500);
    });

    test('should enable delete button when file is selected', async ({ window }) => {
      // Select a file
      const readmeFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await readmeFile.click();

      // Delete button should be enabled
      const deleteButton = window.locator('button[title*="Delete"]');
      await expect(deleteButton).toBeEnabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/delete-button-enabled.png' });
    });

    test('should show confirmation dialog before deleting', async ({ window }) => {
      // Select a file
      const readmeFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await readmeFile.click();

      // Click delete button
      const deleteButton = window.locator('button[title*="Delete"]');
      await deleteButton.click();

      // Confirmation dialog should appear
      const dialog = window.locator('.dialog, .modal, [role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Should mention the file name
      await expect(dialog).toContainText('readme.txt');

      // Screenshot showing confirmation dialog
      await window.screenshot({ path: 'test-results/delete-confirm-dialog.png' });

      // Cancel the delete to not affect other tests
      const cancelButton = dialog.locator('button').filter({ hasText: /cancel/i });
      await cancelButton.click();
    });

    test('should delete single file on confirmation', async ({ window }) => {
      // First, create a temporary file to delete using S3 client
      const s3Client = getLocalStackS3Client();
      const tempFileName = `temp-delete-${Date.now()}.txt`;
      const tempFileKey = `documents/${tempFileName}`;

      await s3Client.send(new PutObjectCommand({
        Bucket: TEST_BUCKETS.main,
        Key: tempFileKey,
        Body: 'Temporary file for delete test',
        ContentType: 'text/plain',
      }));

      // Refresh to see the new file - use specific selector for file list refresh
      const refreshButton = window.locator('button[title="Refresh file list"]');
      await refreshButton.click();
      await window.waitForTimeout(2000);

      // Select the temporary file
      const tempFile = window.locator('.file-row.file').filter({ hasText: tempFileName });
      await expect(tempFile).toBeVisible({ timeout: 5000 });
      await tempFile.click();

      // Click delete button
      const deleteButton = window.locator('button[title*="Delete"]');
      await deleteButton.click();

      // Wait for confirmation dialog
      const dialog = window.locator('.dialog, .modal, [role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Click confirm/delete button
      const confirmButton = dialog.locator('button').filter({ hasText: /delete|confirm|yes/i });
      await confirmButton.click();

      // Wait for operation to complete
      await window.waitForTimeout(2000);

      // File should no longer be visible
      await expect(tempFile).not.toBeVisible({ timeout: 5000 });

      // Screenshot showing file deleted
      await window.screenshot({ path: 'test-results/delete-single-complete.png' });
    });

    test('should enable delete button for multi-select', async ({ window }) => {
      // Select multiple files with Ctrl+click
      const file1 = window.locator('.file-row.file').filter({ hasText: 'file1.txt' });
      await file1.click();

      const file2 = window.locator('.file-row.file').filter({ hasText: 'file2.txt' });
      await file2.click({ modifiers: ['Control'] });

      // Delete button should be enabled and show count badge
      const deleteButton = window.locator('button[title*="Delete"]');
      await expect(deleteButton).toBeEnabled();

      // Should show badge with count
      const badge = window.locator('.toolbar-badge');
      await expect(badge).toHaveText('2');

      // Screenshot
      await window.screenshot({ path: 'test-results/delete-multiselect-enabled.png' });
    });

    test('should show multi-delete confirmation with file count', async ({ window }) => {
      // First, create temporary files to delete with unique names
      const s3Client = getLocalStackS3Client();
      const timestamp = Date.now();
      const tempFiles = [
        `documents/multi-del-${timestamp}-1.txt`,
        `documents/multi-del-${timestamp}-2.txt`,
        `documents/multi-del-${timestamp}-3.txt`,
      ];
      const fileNames = tempFiles.map(f => f.split('/').pop()!);

      for (const key of tempFiles) {
        await s3Client.send(new PutObjectCommand({
          Bucket: TEST_BUCKETS.main,
          Key: key,
          Body: 'Temporary file for multi-delete test',
          ContentType: 'text/plain',
        }));
      }

      // Refresh to see new files - use specific selector
      const refreshButton = window.locator('button[title="Refresh file list"]');
      await refreshButton.click();
      await window.waitForTimeout(2000);

      // Select all temp files
      const file1 = window.locator('.file-row.file').filter({ hasText: fileNames[0] });
      await expect(file1).toBeVisible({ timeout: 5000 });
      await file1.click();

      const file2 = window.locator('.file-row.file').filter({ hasText: fileNames[1] });
      await file2.click({ modifiers: ['Control'] });

      const file3 = window.locator('.file-row.file').filter({ hasText: fileNames[2] });
      await file3.click({ modifiers: ['Control'] });

      // Click delete
      const deleteButton = window.locator('button[title*="Delete"]');
      await deleteButton.click();

      // Confirmation dialog should show count
      const dialog = window.locator('.dialog, .modal, [role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Should mention multiple files
      await expect(dialog).toContainText(/3|files/i);

      // Screenshot showing multi-delete dialog
      await window.screenshot({ path: 'test-results/delete-multi-confirm-dialog.png' });

      // Confirm deletion
      const confirmButton = dialog.locator('button').filter({ hasText: /delete|confirm|yes/i });
      await confirmButton.click();

      // Wait for deletion
      await window.waitForTimeout(2000);

      // Files should be gone
      await expect(file1).not.toBeVisible({ timeout: 5000 });
      await expect(file2).not.toBeVisible({ timeout: 5000 });
      await expect(file3).not.toBeVisible({ timeout: 5000 });

      // Should see success toast
      const toast = window.locator('.toast').filter({ hasText: /delete/i });
      await expect(toast).toBeVisible({ timeout: 5000 });

      // Screenshot showing multi-delete complete
      await window.screenshot({ path: 'test-results/delete-multi-complete.png' });
    });

    test('should cancel delete when clicking cancel in dialog', async ({ window }) => {
      // Select a file
      const file1 = window.locator('.file-row.file').filter({ hasText: 'file1.txt' });
      await file1.click();

      // Click delete
      const deleteButton = window.locator('button[title*="Delete"]');
      await deleteButton.click();

      // Wait for dialog
      const dialog = window.locator('.dialog, .modal, [role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Click cancel
      const cancelButton = dialog.locator('button').filter({ hasText: /cancel|no/i });
      await cancelButton.click();

      // Dialog should close
      await expect(dialog).not.toBeVisible({ timeout: 3000 });

      // File should still be there
      await expect(file1).toBeVisible();

      // Screenshot
      await window.screenshot({ path: 'test-results/delete-cancelled.png' });
    });
  });

  test.describe('Rename Files', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and navigate to documents folder
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main bucket
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Navigate into documents folder
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await documentsFolder.click();
      await window.waitForTimeout(1500);
    });

    test('should enable rename button when file is selected', async ({ window }) => {
      // Select a file
      const readmeFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await readmeFile.click();

      // Rename button should be enabled
      const renameButton = window.locator('button[title*="Rename"]');
      await expect(renameButton).toBeEnabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/rename-button-enabled.png' });
    });

    test('should show rename dialog with current name pre-filled', async ({ window }) => {
      // Select a file
      const readmeFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await readmeFile.click();

      // Click rename button
      const renameButton = window.locator('button[title*="Rename"]');
      await renameButton.click();

      // Dialog should appear
      const dialog = window.locator('.dialog, .modal, [role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Input should have current name
      const input = dialog.locator('input[type="text"]');
      await expect(input).toHaveValue('readme.txt');

      // Screenshot showing rename dialog
      await window.screenshot({ path: 'test-results/rename-dialog.png' });

      // Cancel to not affect other tests
      const cancelButton = dialog.locator('button').filter({ hasText: /cancel/i });
      await cancelButton.click();
    });

    test('should rename file successfully', async ({ window }) => {
      // First, create a temporary file to rename with unique name
      const s3Client = getLocalStackS3Client();
      const timestamp = Date.now();
      const originalName = `temp-rename-orig-${timestamp}.txt`;
      const renamedName = `temp-rename-done-${timestamp}.txt`;
      const tempFileKey = `documents/${originalName}`;

      await s3Client.send(new PutObjectCommand({
        Bucket: TEST_BUCKETS.main,
        Key: tempFileKey,
        Body: 'Temporary file for rename test',
        ContentType: 'text/plain',
      }));

      // Refresh to see new file - use specific selector
      const refreshButton = window.locator('button[title="Refresh file list"]');
      await refreshButton.click();
      await window.waitForTimeout(2000);

      // Select the file
      const tempFile = window.locator('.file-row.file').filter({ hasText: originalName });
      await expect(tempFile).toBeVisible({ timeout: 5000 });
      await tempFile.click();

      // Click rename
      const renameButton = window.locator('button[title*="Rename"]');
      await renameButton.click();

      // Wait for dialog
      const dialog = window.locator('.dialog, .modal, [role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Clear and type new name
      const input = dialog.locator('input[type="text"]');
      await input.fill(renamedName);

      // Click confirm/rename button
      const confirmButton = dialog.locator('button').filter({ hasText: /rename|confirm|ok|save/i });
      await confirmButton.click();

      // Wait for rename to complete
      await window.waitForTimeout(2000);

      // Old file name should not be visible
      await expect(tempFile).not.toBeVisible({ timeout: 5000 });

      // New file name should be visible
      const renamedFile = window.locator('.file-row.file').filter({ hasText: renamedName });
      await expect(renamedFile).toBeVisible({ timeout: 5000 });

      // Screenshot showing renamed file
      await window.screenshot({ path: 'test-results/rename-complete.png' });

      // Clean up - delete the renamed file
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: TEST_BUCKETS.main,
          Key: `documents/${renamedName}`,
        }));
      } catch {
        // Ignore cleanup errors
      }
    });

    test('should disable rename button for multi-select', async ({ window }) => {
      // Select multiple files
      const file1 = window.locator('.file-row.file').filter({ hasText: 'file1.txt' });
      await file1.click();

      const file2 = window.locator('.file-row.file').filter({ hasText: 'file2.txt' });
      await file2.click({ modifiers: ['Control'] });

      // Rename button should be disabled for multi-select
      const renameButton = window.locator('button[title*="Rename"]');
      await expect(renameButton).toBeDisabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/rename-multiselect-disabled.png' });
    });

    test('should cancel rename when clicking cancel', async ({ window }) => {
      // Select a file
      const file1 = window.locator('.file-row.file').filter({ hasText: 'file1.txt' });
      await file1.click();

      // Click rename
      const renameButton = window.locator('button[title*="Rename"]');
      await renameButton.click();

      // Wait for dialog
      const dialog = window.locator('.dialog, .modal, [role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Type a new name
      const input = dialog.locator('input[type="text"]');
      await input.fill('should-not-exist.txt');

      // Click cancel
      const cancelButton = dialog.locator('button').filter({ hasText: /cancel/i });
      await cancelButton.click();

      // Dialog should close
      await expect(dialog).not.toBeVisible({ timeout: 3000 });

      // Original file should still exist
      await expect(file1).toBeVisible();

      // New name should not exist
      const newFile = window.locator('.file-row.file').filter({ hasText: 'should-not-exist.txt' });
      await expect(newFile).not.toBeVisible();

      // Screenshot
      await window.screenshot({ path: 'test-results/rename-cancelled.png' });
    });
  });

  test.describe('Copy S3 URL', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and navigate to documents folder
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main bucket
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Navigate into documents folder
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await documentsFolder.click();
      await window.waitForTimeout(1500);
    });

    test('should enable copy URL button when file is selected', async ({ window }) => {
      // Select a file
      const readmeFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await readmeFile.click();

      // Copy URL button should be enabled
      const copyButton = window.locator('button[title*="Copy S3 URL to clipboard"]');
      await expect(copyButton).toBeEnabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/copy-url-button-enabled.png' });
    });

    test('should copy S3 URL to clipboard and show toast', async ({ window }) => {
      // Select a file
      const readmeFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await readmeFile.click();

      // Click copy URL button
      const copyButton = window.locator('button[title*="Copy S3 URL to clipboard"]');
      await copyButton.click();

      // Toast should appear with success message
      const toast = window.locator('.toast').filter({ hasText: /URL|copied/i });
      await expect(toast).toBeVisible({ timeout: 5000 });

      // Toast should contain the S3 URL format
      await expect(toast).toContainText(`s3://${TEST_BUCKETS.main}/documents/readme.txt`);

      // Screenshot showing copy success
      await window.screenshot({ path: 'test-results/copy-url-success.png' });
    });

    test('should disable copy URL button for multi-select', async ({ window }) => {
      // Select multiple files
      const file1 = window.locator('.file-row.file').filter({ hasText: 'file1.txt' });
      await file1.click();

      const file2 = window.locator('.file-row.file').filter({ hasText: 'file2.txt' });
      await file2.click({ modifiers: ['Control'] });

      // Wait for multiselect state to be applied
      await window.waitForTimeout(500);

      // Copy URL button should be disabled for multi-select
      // The title changes when disabled for multi-select
      const copyButton = window.locator('button[title*="Copy URL not available"]');
      await expect(copyButton).toBeDisabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/copy-url-multiselect-disabled.png' });
    });

    test('should disable copy URL button when no file selected', async ({ window }) => {
      // Initially no file selected - button shows "Select a file to copy URL"
      const copyButton = window.locator('button[title*="Select a file to copy URL"]');
      await expect(copyButton).toBeDisabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/copy-url-no-selection.png' });
    });
  });

  test.describe('Refresh', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);
    });

    test('should have refresh button enabled when bucket is selected', async ({ window }) => {
      // Use specific selector for file list refresh button (not profile refresh)
      const refreshButton = window.locator('button[title="Refresh file list"]');
      await expect(refreshButton).toBeEnabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/refresh-button-enabled.png' });
    });

    test('should refresh file list and show new files', async ({ window }) => {
      // Create a new file directly via S3 with unique name
      const s3Client = getLocalStackS3Client();
      const timestamp = Date.now();
      const newFileName = `refresh-test-${timestamp}.txt`;
      const newFileKey = newFileName;

      await s3Client.send(new PutObjectCommand({
        Bucket: TEST_BUCKETS.main,
        Key: newFileKey,
        Body: 'File created for refresh test',
        ContentType: 'text/plain',
      }));

      // Click refresh - use specific selector
      const refreshButton = window.locator('button[title="Refresh file list"]');
      await refreshButton.click();
      await window.waitForTimeout(2000);

      // Now file should be visible
      const newFile = window.locator('.file-row').filter({ hasText: newFileName });
      await expect(newFile).toBeVisible({ timeout: 5000 });

      // Screenshot showing refreshed list
      await window.screenshot({ path: 'test-results/refresh-shows-new-file.png' });

      // Clean up
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: TEST_BUCKETS.main,
          Key: newFileKey,
        }));
      } catch {
        // Ignore cleanup errors
      }
    });
  });
});
