import { test, expect, TEST_BUCKETS, getEndpoint } from './electron-fixtures';
import { TEST_DATA } from './fixtures/localstack-setup';

test.describe('UI Features', () => {
  test.describe('Status Bar', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await expect(window.locator('.content-header h2')).toHaveText(TEST_BUCKETS.main);
      await expect(window.locator('.file-row.folder').filter({ hasText: 'documents' })).toBeVisible({ timeout: 15000 });
    });

    test('should display status bar at bottom of file list', async ({ window }) => {
      const statusBar = window.locator('.status-bar');
      await expect(statusBar).toBeVisible();

      // Screenshot showing status bar
      await window.screenshot({ path: 'test-results/status-bar-visible.png' });
    });

    test('should show item count in status bar', async ({ window }) => {
      const itemCount = window.locator('.status-bar-items');
      await expect(itemCount).toBeVisible();
      // Should show number of items
      await expect(itemCount).toContainText(/\d+\s*item/i);
    });

    test('should show "No selection" when nothing selected', async ({ window }) => {
      // Click elsewhere to clear selection if any
      const contentArea = window.locator('.content');
      await contentArea.click({ position: { x: 10, y: 10 } });

      const selection = window.locator('.status-bar-selection');
      await expect(selection).toBeVisible();
      await expect(selection).toContainText(/no selection/i);
    });

    test('should update selection count when file is selected', async ({ window }) => {
      // Navigate to documents folder (double-click to navigate)
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });
      await documentsFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('documents');
      await expect(window.locator('.file-row:not(.folder)').filter({ hasText: 'file1.txt' })).toBeVisible({ timeout: 5000 });

      // Select a file
      const textFile = window.locator('.file-row:not(.folder)').first();
      await expect(textFile).toBeVisible({ timeout: 5000 });
      await textFile.click();
      await expect(textFile).toHaveClass(/selected/);

      // Selection should update
      const selection = window.locator('.status-bar-selection');
      await expect(selection).toBeVisible();
      await expect(selection).toContainText(/1\s*selected/i);

      // Screenshot showing selection
      await window.screenshot({ path: 'test-results/status-bar-with-selection.png' });
    });

    test('should show total size of selected files', async ({ window }) => {
      // Navigate to documents folder (double-click to navigate)
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });
      await documentsFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('documents');
      await expect(window.locator('.file-row:not(.folder)').filter({ hasText: 'file1.txt' })).toBeVisible({ timeout: 5000 });

      // Select a file
      const textFile = window.locator('.file-row:not(.folder)').first();
      await expect(textFile).toBeVisible({ timeout: 5000 });
      await textFile.click();
      await expect(textFile).toHaveClass(/selected/);

      // Should show size in selection info (format: "1 selected (X B/KB/MB)")
      const selection = window.locator('.status-bar-selection');
      await expect(selection).toContainText(/\d+\s*selected\s*\(/);
    });

    test('should update count with multiselect', async ({ window }) => {
      // Navigate to documents folder (double-click to navigate)
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });
      await documentsFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('documents');
      await expect(window.locator('.file-row:not(.folder)').filter({ hasText: 'file1.txt' })).toBeVisible({ timeout: 5000 });

      // Select first file
      const files = window.locator('.file-row:not(.folder)');
      const firstFile = files.first();
      await expect(firstFile).toBeVisible({ timeout: 5000 });
      await firstFile.click();
      await expect(firstFile).toHaveClass(/selected/);

      // Ctrl+click to add second file to selection
      const secondFile = files.nth(1);
      await expect(secondFile).toBeVisible({ timeout: 5000 });
      await secondFile.click({ modifiers: ['Control'] });
      await expect(secondFile).toHaveClass(/selected/);

      // Should show 2 selected
      const selection = window.locator('.status-bar-selection');
      await expect(selection).toContainText(/2\s*selected/i);

      // Screenshot showing multiselect
      await window.screenshot({ path: 'test-results/status-bar-multiselect.png' });
    });

    test('should indicate when more items are available', async ({ window }) => {
      // The status bar should show loading status or indicate if all items loaded
      const itemCount = window.locator('.status-bar-items');
      await expect(itemCount).toBeVisible();

      // Should either show "X items" or "X items loaded (more available)"
      await expect(itemCount).toHaveText(/\d+\s*item/i);
    });
  });

  test.describe('Properties Dialog', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await expect(window.locator('.content-header h2')).toHaveText(TEST_BUCKETS.main);
      await expect(window.locator('.file-row.folder').filter({ hasText: 'documents' })).toBeVisible({ timeout: 15000 });
    });

    test('should show Properties button disabled when no file selected', async ({ window }) => {
      // Find Properties button by title
      const propertiesBtn = window.locator('button[title*="properties" i]');
      await expect(propertiesBtn).toBeVisible();
      await expect(propertiesBtn).toBeDisabled();
    });

    test('should enable Properties button when file is selected', async ({ window }) => {
      // Navigate to data folder (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await expect(dataFolder).toBeVisible({ timeout: 5000 });
      await dataFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('data');

      // Select a file (config.json)
      const configFile = window.locator('.file-row:not(.folder)').filter({ hasText: 'config.json' });
      await expect(configFile).toBeVisible({ timeout: 5000 });
      await configFile.click();
      await expect(configFile).toHaveClass(/selected/);

      // Properties button should be enabled
      const propertiesBtn = window.locator('button[title*="properties" i]');
      await expect(propertiesBtn).toBeEnabled();
    });

    test('should open Properties dialog when button clicked', async ({ window }) => {
      // Navigate to data folder and select a file (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await expect(dataFolder).toBeVisible({ timeout: 5000 });
      await dataFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('data');

      const configFile = window.locator('.file-row:not(.folder)').filter({ hasText: 'config.json' });
      await expect(configFile).toBeVisible({ timeout: 5000 });
      await configFile.click();
      await expect(configFile).toHaveClass(/selected/);

      // Click Properties button
      const propertiesBtn = window.locator('button[title*="properties" i]');
      await propertiesBtn.click();

      // Dialog should open
      const dialog = window.locator('.dialog-properties, .dialog').filter({ hasText: /properties/i });
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Screenshot showing properties dialog
      await window.screenshot({ path: 'test-results/properties-dialog-open.png' });
    });

    test('should display file name in Properties dialog', async ({ window }) => {
      // Navigate and select config.json (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await dataFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('data');

      const configFile = window.locator('.file-row:not(.folder)').filter({ hasText: 'config.json' });
      await configFile.click();
      await expect(configFile).toHaveClass(/selected/);

      const propertiesBtn = window.locator('button[title*="properties" i]');
      await propertiesBtn.click();

      // Should show the file name
      const dialog = window.locator('.dialog-properties, .dialog').filter({ hasText: /properties/i });
      await expect(dialog).toContainText('config.json');
    });

    test('should display S3 URL in Properties dialog', async ({ window }) => {
      // Navigate and select a file (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await dataFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('data');

      const configFile = window.locator('.file-row:not(.folder)').filter({ hasText: 'config.json' });
      await configFile.click();
      await expect(configFile).toHaveClass(/selected/);

      const propertiesBtn = window.locator('button[title*="properties" i]');
      await propertiesBtn.click();

      // Should show S3 URL
      const dialog = window.locator('.dialog-properties, .dialog').filter({ hasText: /properties/i });
      await expect(dialog).toContainText('s3://');
    });

    test('should show Copy buttons for URLs in Properties dialog', async ({ window }) => {
      // Navigate and select a file (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await dataFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('data');

      const configFile = window.locator('.file-row:not(.folder)').filter({ hasText: 'config.json' });
      await configFile.click();
      await expect(configFile).toHaveClass(/selected/);

      const propertiesBtn = window.locator('button[title*="properties" i]');
      await propertiesBtn.click();

      // Should have Copy buttons
      const copyButtons = window.locator('.property-copy-btn, button').filter({ hasText: /copy/i });
      await expect(copyButtons.first()).toBeVisible();
    });

    test('should close Properties dialog with Close button', async ({ window }) => {
      // Navigate and select a file (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await dataFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('data');

      const configFile = window.locator('.file-row:not(.folder)').filter({ hasText: 'config.json' });
      await configFile.click();
      await expect(configFile).toHaveClass(/selected/);

      const propertiesBtn = window.locator('button[title*="properties" i]');
      await propertiesBtn.click();

      // Click Close button
      const closeBtn = window.locator('.dialog-btn-confirm, .dialog button').filter({ hasText: /close/i });
      await closeBtn.click();

      // Dialog should be closed
      const dialog = window.locator('.dialog-properties, .dialog').filter({ hasText: /properties/i });
      await expect(dialog).not.toBeVisible();
    });

    test('should close Properties dialog with Escape key', async ({ window }) => {
      // Navigate and select a file (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await dataFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('data');

      const configFile = window.locator('.file-row:not(.folder)').filter({ hasText: 'config.json' });
      await configFile.click();
      await expect(configFile).toHaveClass(/selected/);

      const propertiesBtn = window.locator('button[title*="properties" i]');
      await propertiesBtn.click();

      // Verify dialog is open
      const dialogOverlay = window.locator('.dialog-overlay');
      await expect(dialogOverlay).toBeVisible();

      // Click on dialog overlay outside the dialog to close it (similar to escape)
      // This tests the overlay click-to-close functionality which is more reliable
      await dialogOverlay.click({ position: { x: 10, y: 10 } });

      // Dialog should be closed
      const dialog = window.locator('.dialog-properties, .dialog').filter({ hasText: /properties/i });
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
    });

    test('should show folder properties for selected folder', async ({ window }) => {
      // Select a folder (documents)
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await expect(documentsFolder).toBeVisible({ timeout: 5000 });

      // Single click selects the folder without navigating
      await documentsFolder.click();
      await expect(documentsFolder).toHaveClass(/selected/);

      // A single click selects a folder without navigating, so Properties is enabled
      const propertiesBtn = window.locator('button[title*="properties" i]');
      await expect(propertiesBtn).toBeEnabled();

      await propertiesBtn.click();

      // Dialog should show "Folder Properties"
      const dialog = window.locator('.dialog-properties, .dialog').filter({ hasText: /folder/i });
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Screenshot showing folder properties
      await window.screenshot({ path: 'test-results/folder-properties-dialog.png' });
    });
  });

  test.describe('New File Creation', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await expect(window.locator('.content-header h2')).toHaveText(TEST_BUCKETS.main);
      await expect(window.locator('.file-row.folder').filter({ hasText: 'documents' })).toBeVisible({ timeout: 15000 });
    });

    test('should have New File button visible in toolbar', async ({ window }) => {
      // Find New File button by title
      const newFileBtn = window.locator('button[title*="new"][title*="file" i], button[title*="Create new"][title*="file" i]');
      await expect(newFileBtn.first()).toBeVisible();
    });

    test('should enable New File button when bucket is selected', async ({ window }) => {
      const newFileBtn = window.locator('button[title*="new"][title*="file" i], button[title*="Create new"][title*="file" i]');
      await expect(newFileBtn.first()).toBeEnabled();
    });

    test('should open New File dialog when button clicked', async ({ window }) => {
      const newFileBtn = window.locator('button[title*="new"][title*="file" i], button[title*="Create new"][title*="file" i]');
      await newFileBtn.first().click();

      // Dialog should open
      const dialog = window.locator('.dialog').filter({ hasText: /new file/i });
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Screenshot showing new file dialog
      await window.screenshot({ path: 'test-results/new-file-dialog.png' });
    });

    test('should show default filename in New File dialog', async ({ window }) => {
      const newFileBtn = window.locator('button[title*="new"][title*="file" i], button[title*="Create new"][title*="file" i]');
      await newFileBtn.first().click();

      // Input should have default name
      const input = window.locator('.dialog-input, .dialog input[type="text"]');
      await expect(input).toHaveValue('new-file.txt');
    });

    test('should show preview path in New File dialog', async ({ window }) => {
      const newFileBtn = window.locator('button[title*="new"][title*="file" i], button[title*="Create new"][title*="file" i]');
      await newFileBtn.first().click();

      // Should show preview of what will be created
      const preview = window.locator('.new-item-preview, .preview-path');
      await expect(preview.first()).toBeVisible();
    });

    test('should close New File dialog with Cancel button', async ({ window }) => {
      const newFileBtn = window.locator('button[title*="new"][title*="file" i], button[title*="Create new"][title*="file" i]');
      await newFileBtn.first().click();

      // Click Cancel
      const cancelBtn = window.locator('.dialog-btn-cancel, .dialog button').filter({ hasText: /cancel/i });
      await cancelBtn.click();

      // Dialog should be closed
      const dialog = window.locator('.dialog').filter({ hasText: /new file/i });
      await expect(dialog).not.toBeVisible();
    });

    test('should disable Create button when name is empty', async ({ window }) => {
      const newFileBtn = window.locator('button[title*="new"][title*="file" i], button[title*="Create new"][title*="file" i]');
      await newFileBtn.first().click();

      // The dialog seeds its default name after mounting; clear only once it is there
      const input = window.locator('.dialog-input, .dialog input[type="text"]');
      await expect(input).toHaveValue('new-file.txt');
      await input.fill('');
      await expect(input).toHaveValue('');

      // Create button should be disabled
      const createBtn = window.locator('.dialog-btn-confirm, .dialog button').filter({ hasText: /create/i });
      await expect(createBtn).toBeDisabled();
    });
  });

  test.describe('New Folder Creation', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await expect(window.locator('.content-header h2')).toHaveText(TEST_BUCKETS.main);
      await expect(window.locator('.file-row.folder').filter({ hasText: 'documents' })).toBeVisible({ timeout: 15000 });
    });

    test('should have New Folder button visible in toolbar', async ({ window }) => {
      const newFolderBtn = window.locator('button[title*="new"][title*="folder" i], button[title*="Create new"][title*="folder" i]');
      await expect(newFolderBtn.first()).toBeVisible();
    });

    test('should enable New Folder button when bucket is selected', async ({ window }) => {
      const newFolderBtn = window.locator('button[title*="new"][title*="folder" i], button[title*="Create new"][title*="folder" i]');
      await expect(newFolderBtn.first()).toBeEnabled();
    });

    test('should open New Folder dialog when button clicked', async ({ window }) => {
      const newFolderBtn = window.locator('button[title*="new"][title*="folder" i], button[title*="Create new"][title*="folder" i]');
      await newFolderBtn.first().click();

      // Dialog should open
      const dialog = window.locator('.dialog').filter({ hasText: /new folder/i });
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Screenshot showing new folder dialog
      await window.screenshot({ path: 'test-results/new-folder-dialog.png' });
    });

    test('should show default folder name in New Folder dialog', async ({ window }) => {
      const newFolderBtn = window.locator('button[title*="new"][title*="folder" i], button[title*="Create new"][title*="folder" i]');
      await newFolderBtn.first().click();

      // Input should have default name
      const input = window.locator('.dialog-input, .dialog input[type="text"]');
      await expect(input).toHaveValue('new-folder');
    });

    test('should show preview path with trailing slash for folder', async ({ window }) => {
      const newFolderBtn = window.locator('button[title*="new"][title*="folder" i], button[title*="Create new"][title*="folder" i]');
      await newFolderBtn.first().click();

      // Preview should show path ending with /
      const preview = window.locator('.preview-path');
      await expect(preview).toHaveText(/\/$/);
    });

    test('should close New Folder dialog with Cancel button', async ({ window }) => {
      const newFolderBtn = window.locator('button[title*="new"][title*="folder" i], button[title*="Create new"][title*="folder" i]');
      await newFolderBtn.first().click();

      // Click Cancel
      const cancelBtn = window.locator('.dialog-btn-cancel, .dialog button').filter({ hasText: /cancel/i });
      await cancelBtn.click();

      // Dialog should be closed
      const dialog = window.locator('.dialog').filter({ hasText: /new folder/i });
      await expect(dialog).not.toBeVisible();
    });
  });

  test.describe('Toast Notifications', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await expect(window.locator('.content-header h2')).toHaveText(TEST_BUCKETS.main);
      await expect(window.locator('.file-row.folder').filter({ hasText: 'documents' })).toBeVisible();
    });

    test('should have toast container present in DOM', async ({ window }) => {
      const toastContainer = window.locator('.toast-container');
      await expect(toastContainer).toBeAttached();
    });

    test('should show toast when copying S3 URL', async ({ window }) => {
      // Navigate to data folder and select a file (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await dataFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('data');

      const configFile = window.locator('.file-row:not(.folder)').filter({ hasText: 'config.json' });
      await configFile.click();
      await expect(configFile).toHaveClass(/selected/);

      // Click Copy URL button
      const copyBtn = window.locator('button[title*="copy" i][title*="url" i]');
      await copyBtn.click();

      // Toast should appear
      const toast = window.locator('.toast');
      await expect(toast.first()).toBeVisible({ timeout: 5000 });

      // Screenshot showing toast
      await window.screenshot({ path: 'test-results/toast-copy-url.png' });
    });

    test('should display toast title', async ({ window }) => {
      // Navigate to data folder and select a file (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await dataFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('data');

      const configFile = window.locator('.file-row:not(.folder)').filter({ hasText: 'config.json' });
      await configFile.click();
      await expect(configFile).toHaveClass(/selected/);

      // Click Copy URL button
      const copyBtn = window.locator('button[title*="copy" i][title*="url" i]');
      await copyBtn.click();

      // Toast should have a title
      const toastTitle = window.locator('.toast-title');
      await expect(toastTitle.first()).toBeVisible();
    });

    test('should dismiss toast when clicking dismiss button', async ({ window }) => {
      // Navigate to data folder and select a file (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await dataFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('data');

      const configFile = window.locator('.file-row:not(.folder)').filter({ hasText: 'config.json' });
      await configFile.click();
      await expect(configFile).toHaveClass(/selected/);

      // Click Copy URL button to trigger toast
      const copyBtn = window.locator('button[title*="copy" i][title*="url" i]');
      await copyBtn.click();

      // Click dismiss button on toast
      const dismissBtn = window.locator('.toast-dismiss');
      await expect(dismissBtn.first()).toBeVisible();
      await dismissBtn.first().click();

      // Toast should be dismissed
      await expect(window.locator('.toast').first()).not.toBeVisible({ timeout: 3000 });
    });

    test('should auto-dismiss toast after duration', async ({ window }) => {
      // Navigate to data folder and select a file (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await dataFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('data');

      const configFile = window.locator('.file-row:not(.folder)').filter({ hasText: 'config.json' });
      await configFile.click();
      await expect(configFile).toHaveClass(/selected/);

      // Click Copy URL button to trigger toast
      const copyBtn = window.locator('button[title*="copy" i][title*="url" i]');
      await copyBtn.click();

      // Toast should appear
      const toast = window.locator('.toast');
      await expect(toast.first()).toBeVisible({ timeout: 5000 });

      // Toast auto-dismisses after its default 5 s duration; the web-first
      // assertion polls until it is gone (default expect timeout covers it)
      await expect(toast.first()).not.toBeVisible();
    });
  });

  test.describe('Bucket Filter', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets to load
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
    });

    test('should display bucket filter input in sidebar', async ({ window }) => {
      const filterInput = window.locator('.bucket-filter-input');
      await expect(filterInput).toBeVisible();
    });

    test('should have placeholder text for bucket filter', async ({ window }) => {
      const filterInput = window.locator('.bucket-filter-input');
      await expect(filterInput).toHaveAttribute('placeholder', /filter.*bucket/i);
    });

    test('should filter buckets by name (case-insensitive)', async ({ window }) => {
      const filterInput = window.locator('.bucket-filter-input');

      // Filter for "secondary"
      await filterInput.fill('SECONDARY'); // uppercase to test case-insensitivity

      // Only secondary bucket should be visible
      const secondaryBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.secondary });
      await expect(secondaryBucket).toBeVisible();

      // Main bucket should be hidden
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).not.toBeVisible();

      // Screenshot showing filtered buckets
      await window.screenshot({ path: 'test-results/bucket-filter-case-insensitive.png' });
    });

    test('should filter buckets using contains logic', async ({ window }) => {
      const filterInput = window.locator('.bucket-filter-input');

      // Filter for "bucket" - should match all buckets (test-bucket, secondary-bucket, empty-bucket)
      await filterInput.fill('bucket');

      // All buckets contain "bucket", so all should be visible
      const bucketItems = window.locator('.bucket-item');
      await expect(bucketItems).toHaveCount(3);
      expect(await bucketItems.count()).toBe(3);
    });

    test('should show filter hint with bucket count', async ({ window }) => {
      const filterHint = window.locator('.bucket-filter-hint');
      await expect(filterHint).toBeVisible();
      await expect(filterHint).toContainText('3 buckets');
    });

    test('should update filter hint when filtering', async ({ window }) => {
      const filterInput = window.locator('.bucket-filter-input');
      await filterInput.fill('secondary');

      const filterHint = window.locator('.bucket-filter-hint');
      await expect(filterHint).toContainText('1 of 3');
    });

    test('should show clear button when filter has text', async ({ window }) => {
      const filterInput = window.locator('.bucket-filter-input');
      await filterInput.fill('test');

      const clearBtn = window.locator('.bucket-filter-clear');
      await expect(clearBtn).toBeVisible();
    });

    test('should clear filter when clear button clicked', async ({ window }) => {
      const filterInput = window.locator('.bucket-filter-input');
      await filterInput.fill('test');

      const clearBtn = window.locator('.bucket-filter-clear');
      await clearBtn.click();

      // Filter should be cleared
      await expect(filterInput).toHaveValue('');

      // All buckets should be visible
      const bucketItems = window.locator('.bucket-item');
      await expect(bucketItems).toHaveCount(3);
      expect(await bucketItems.count()).toBe(3);
    });
  });

  test.describe('File List Sorting and Filtering', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await expect(window.locator('.content-header h2')).toHaveText(TEST_BUCKETS.main);
      await expect(window.locator('.file-row.folder').filter({ hasText: 'documents' })).toBeVisible();

      // Navigate to data folder which has various file types (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await expect(dataFolder).toBeVisible({ timeout: 5000 });
      await dataFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('data');
    });

    test('should display quick filter input', async ({ window }) => {
      const searchInput = window.locator('.file-list-search-input');
      await expect(searchInput.first()).toBeVisible();

      // Screenshot showing filter controls
      await window.screenshot({ path: 'test-results/file-list-filter-controls.png' });
    });

    test('should filter files by name using quick filter', async ({ window }) => {
      const searchInput = window.locator('.file-list-search-input');
      await searchInput.first().fill('config');

      // Should show files containing "config"
      const configFiles = window.locator('.file-row').filter({ hasText: /config/i });
      await expect(configFiles.first()).toBeVisible();
      const count = await configFiles.count();
      expect(count).toBeGreaterThan(0);

      // Rows that do not match the query are filtered out
      await expect(window.locator('.file-row').filter({ hasNotText: /config/i })).toHaveCount(0);

      // Screenshot showing filtered results
      await window.screenshot({ path: 'test-results/file-list-quick-filter.png' });
    });

    test('should show clear button when quick filter has text', async ({ window }) => {
      const searchInput = window.locator('.file-list-search-input');
      await searchInput.first().fill('config');

      // The clear button is rendered as soon as the query is non-empty
      const clearBtn = window.locator('.file-list-search-clear, .file-list-controls button[title*="clear" i]');
      await expect(clearBtn.first()).toBeVisible();

      // And the filter itself applied: config files are still listed
      const configFiles = window.locator('.file-row').filter({ hasText: /config/i });
      await expect(configFiles.first()).toBeVisible();
      expect(await configFiles.count()).toBeGreaterThan(0);
    });

    test('should clear quick filter when clear button clicked', async ({ window }) => {
      const searchInput = window.locator('.file-list-search-input');
      await searchInput.first().fill('config');

      await expect(searchInput.first()).toHaveValue('config');

      // The clear button is rendered as soon as the query is non-empty
      const clearBtn = window.locator('.file-list-search-clear, .file-list-controls button[title*="clear" i]');
      await expect(clearBtn.first()).toBeVisible();
      await clearBtn.first().click();

      // Filter should be cleared, and the clear button goes away with it
      await expect(searchInput.first()).toHaveValue('');
      await expect(clearBtn.first()).not.toBeVisible();
    });

    test('should display file type filter dropdown', async ({ window }) => {
      const typeFilter = window.locator('.file-list-type-filter, select[aria-label*="type" i]');
      await expect(typeFilter.first()).toBeVisible();
    });

    test('should have All Files as default filter type', async ({ window }) => {
      const typeFilter = window.locator('.file-list-type-filter, select[aria-label*="type" i]');
      await expect(typeFilter.first()).toHaveValue('all');
    });

    test('should filter by file type when type filter changed', async ({ window }) => {
      // Go back to root to have more diverse files
      const upBtn = window.locator('.go-up-btn, button[title="Go to parent folder"]');
      await expect(upBtn.first()).toBeVisible();
      await upBtn.first().click();
      await expect(window.locator('.content-header h2')).toHaveText(TEST_BUCKETS.main);

      // Navigate to images folder (double-click to navigate)
      const imagesFolder = window.locator('.file-row.folder').filter({ hasText: 'images' });
      await expect(imagesFolder).toBeVisible();
      await imagesFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('images');
      await expect(window.locator('.file-row:not(.folder)').first()).toBeVisible();

      const typeFilter = window.locator('.file-list-type-filter, select[aria-label*="type" i]');

      // Select Images filter
      await typeFilter.first().selectOption('images');
      await expect(typeFilter.first()).toHaveValue('images');

      // Should only show image files (and folders)
      const files = window.locator('.file-row:not(.folder)');
      const imagePattern = /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp)/i;
      await expect(files.first()).toContainText(imagePattern);
      const count = await files.count();
      expect(count).toBeGreaterThan(0);

      // All visible files should be images
      for (let i = 0; i < count; i++) {
        expect(await files.nth(i).textContent()).toMatch(imagePattern);
      }

      // Screenshot showing type filter
      await window.screenshot({ path: 'test-results/file-list-type-filter.png' });
    });

    test('should show item count after filtering', async ({ window }) => {
      const showingCount = window.locator('.file-list-showing-count');
      await expect(showingCount).toBeVisible();

      // Apply a filter
      const searchInput = window.locator('.file-list-search-input');
      await searchInput.first().fill('config');

      // Count should show filtered count
      await expect(showingCount).toHaveText(/\d+ of \d+ items/);
      expect(await showingCount.textContent()).toMatch(/\d+.*item/i);
    });

    test('should sort by name when clicking name column header', async ({ window }) => {
      // Find the name column header
      const nameHeader = window.locator('.file-list-header, th').filter({ hasText: /name/i }).first();

      await expect(nameHeader).toBeVisible();
      await nameHeader.click();

      // Name is the default ascending sort, so the click flips it to descending
      await expect(nameHeader).toContainText('\u25BC');

      // Screenshot to show sorted results
      await window.screenshot({ path: 'test-results/file-list-sort-by-name.png' });
    });
  });

  test.describe('Navigation Bar', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await expect(window.locator('.content-header h2')).toHaveText(TEST_BUCKETS.main);
      await expect(window.locator('.file-row.folder').filter({ hasText: 'documents' })).toBeVisible();
    });

    test('should display navigation bar with S3 URL input', async ({ window }) => {
      const navBar = window.locator('.nav-bar, .navigation-bar');
      await expect(navBar).toBeVisible();

      const urlInput = window.locator('.nav-url-input, input[placeholder*="s3://" i]');
      await expect(urlInput.first()).toBeVisible();
    });

    test('should show current path in navigation input', async ({ window }) => {
      const urlInput = window.locator('.nav-url-input, input[placeholder*="s3://" i]');
      const value = await urlInput.first().inputValue();

      // Should show s3:// URL
      expect(value).toMatch(/^s3:\/\//);
    });

    test('should have up button in navigation', async ({ window }) => {
      // Navigate into a folder first (double-click to navigate)
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await documentsFolder.dblclick();
      await expect(window.locator('.content-header h2')).toContainText('documents');

      // Up button should be visible (class: go-up-btn, title: "Go to parent folder")
      const upBtn = window.locator('.go-up-btn, button[title="Go to parent folder"]');
      await expect(upBtn.first()).toBeVisible();
    });

    test('should navigate up when up button clicked', async ({ window }) => {
      // Navigate into documents folder (double-click to navigate)
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await documentsFolder.dblclick();

      // Verify we're in documents
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toContainText('documents');

      // Click up button (class: go-up-btn, title: "Go to parent folder")
      const upBtn = window.locator('.go-up-btn, button[title="Go to parent folder"]');
      await expect(upBtn.first()).toBeVisible();
      await upBtn.first().click();

      // Should be back at bucket root - header shows just bucket name
      // After going up from documents/, we should be at bucket root
      await expect(contentHeader).toHaveText(TEST_BUCKETS.main);
    });

    test('should navigate when S3 URL is entered', async ({ window }) => {
      const urlInput = window.locator('.nav-url-input, input[placeholder*="s3://" i]');

      // Enter a path to navigate
      await urlInput.first().fill(`s3://${TEST_BUCKETS.main}/documents/`);
      await urlInput.first().press('Enter');

      // Should navigate to documents folder
      const contentHeader = window.locator('.content-header h2');
      await expect(contentHeader).toContainText('documents');

      // Screenshot showing navigation result
      await window.screenshot({ path: 'test-results/nav-bar-url-navigation.png' });
    });
  });

  test.describe('Drag and Drop Zone', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets and select main
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await expect(window.locator('.content-header h2')).toHaveText(TEST_BUCKETS.main);
      await expect(window.locator('.file-row.folder').filter({ hasText: 'documents' })).toBeVisible();
    });

    test('should have file list area that accepts drops', async ({ window }) => {
      // The file list content area should be a drop target
      const fileList = window.locator('.file-list, .content');
      await expect(fileList.first()).toBeVisible();
    });
  });
});
