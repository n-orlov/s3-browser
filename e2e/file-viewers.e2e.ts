import { test, expect, TEST_BUCKETS } from './electron-fixtures';
import { TEST_DATA, getLocalStackS3Client } from './fixtures/localstack-setup';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

test.describe('File Viewers', () => {
  test.describe('Text Editor (Monaco)', () => {
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

      // Navigate into documents folder (double-click to navigate)
      const documentsFolder = window.locator('.file-row.folder').filter({ hasText: 'documents' });
      await documentsFolder.dblclick();
      await window.waitForTimeout(1500);
    });

    test('should enable edit button when file is selected', async ({ window }) => {
      // Select a text file
      const textFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await expect(textFile).toBeVisible({ timeout: 5000 });
      await textFile.click();

      // Edit button should be enabled
      const editButton = window.locator('button[title="Edit file as text"]');
      await expect(editButton).toBeEnabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/text-editor-button-enabled.png' });
    });

    test('should disable edit button when multiple files selected', async ({ window }) => {
      // Select multiple files
      const file1 = window.locator('.file-row.file').filter({ hasText: 'file1.txt' });
      await file1.click();

      const file2 = window.locator('.file-row.file').filter({ hasText: 'file2.txt' });
      await file2.click({ modifiers: ['Control'] });

      // Edit button should be disabled for multiselect
      const editButton = window.locator('button[title="Select a file to edit"]');
      await expect(editButton).toBeDisabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/text-editor-multiselect-disabled.png' });
    });

    test('should open text editor overlay when clicking edit', async ({ window }) => {
      // Select a text file
      const textFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await textFile.click();

      // Click edit button
      const editButton = window.locator('button[title="Edit file as text"]');
      await editButton.click();

      // Wait for text editor overlay to appear
      const editorOverlay = window.locator('.text-editor-overlay');
      await expect(editorOverlay).toBeVisible({ timeout: 15000 });

      // Screenshot showing editor opening
      await window.screenshot({ path: 'test-results/viewers/text-editor-opening.png' });
    });

    test('should display file content in Monaco editor', async ({ window }) => {
      // Select a text file
      const textFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await textFile.click();

      // Click edit button
      const editButton = window.locator('button[title="Edit file as text"]');
      await editButton.click();

      // Wait for text editor overlay to appear
      const editorOverlay = window.locator('.text-editor-overlay');
      await expect(editorOverlay).toBeVisible({ timeout: 15000 });

      // Wait for content to load (Monaco editor will show the content)
      // Monaco editor uses .monaco-editor class
      const monacoEditor = window.locator('.monaco-editor');
      await expect(monacoEditor).toBeVisible({ timeout: 20000 });

      // Wait for loading spinner to disappear
      const loadingSpinner = window.locator('.text-editor-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Screenshot showing loaded content
      await window.screenshot({ path: 'test-results/viewers/text-editor-with-content.png' });
    });

    test('should show file name in editor header', async ({ window }) => {
      // Select a text file
      const textFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await textFile.click();

      // Click edit button
      const editButton = window.locator('button[title="Edit file as text"]');
      await editButton.click();

      // Wait for text editor overlay
      const editorOverlay = window.locator('.text-editor-overlay');
      await expect(editorOverlay).toBeVisible({ timeout: 15000 });

      // Check file name is displayed in header
      const fileNameDisplay = window.locator('.text-editor-filename');
      await expect(fileNameDisplay).toContainText('readme.txt');

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/text-editor-header.png' });
    });

    test('should have Save and Close buttons', async ({ window }) => {
      // Select a text file
      const textFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await textFile.click();

      // Click edit button
      const editButton = window.locator('button[title="Edit file as text"]');
      await editButton.click();

      // Wait for text editor overlay
      const editorOverlay = window.locator('.text-editor-overlay');
      await expect(editorOverlay).toBeVisible({ timeout: 15000 });

      // Wait for loading to complete
      const loadingSpinner = window.locator('.text-editor-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Save button should be visible (but disabled when no changes)
      const saveButton = window.locator('.text-editor-btn-save');
      await expect(saveButton).toBeVisible();
      await expect(saveButton).toBeDisabled(); // No changes yet

      // Close button should be visible
      const closeButton = window.locator('.text-editor-btn-close');
      await expect(closeButton).toBeVisible();

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/text-editor-buttons.png' });
    });

    test('should close editor when clicking Close button', async ({ window }) => {
      // Select a text file
      const textFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await textFile.click();

      // Click edit button
      const editButton = window.locator('button[title="Edit file as text"]');
      await editButton.click();

      // Wait for text editor overlay
      const editorOverlay = window.locator('.text-editor-overlay');
      await expect(editorOverlay).toBeVisible({ timeout: 15000 });

      // Wait for content to load
      const loadingSpinner = window.locator('.text-editor-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Click close button
      const closeButton = window.locator('.text-editor-btn-close');
      await closeButton.click();

      // Editor should close
      await expect(editorOverlay).not.toBeVisible({ timeout: 5000 });

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/text-editor-closed.png' });
    });

    test('should show S3 path in footer', async ({ window }) => {
      // Select a text file
      const textFile = window.locator('.file-row.file').filter({ hasText: 'readme.txt' });
      await textFile.click();

      // Click edit button
      const editButton = window.locator('button[title="Edit file as text"]');
      await editButton.click();

      // Wait for text editor overlay
      const editorOverlay = window.locator('.text-editor-overlay');
      await expect(editorOverlay).toBeVisible({ timeout: 15000 });

      // Check S3 path is shown in footer
      const pathDisplay = window.locator('.text-editor-path');
      await expect(pathDisplay).toContainText(`s3://${TEST_BUCKETS.main}/documents/readme.txt`);

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/text-editor-footer.png' });
    });
  });

  test.describe('CSV Viewer', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets to load and select main bucket
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Navigate into data folder (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await expect(dataFolder).toBeVisible({ timeout: 15000 });
      await dataFolder.dblclick();
      await window.waitForTimeout(1500);
    });

    test('should enable CSV viewer button for CSV files', async ({ window }) => {
      // Select CSV file
      const csvFile = window.locator('.file-row.file').filter({ hasText: 'users.csv' });
      await expect(csvFile).toBeVisible({ timeout: 5000 });
      await csvFile.click();

      // CSV viewer button should be enabled
      const csvButton = window.locator('button[title="View CSV file"]');
      await expect(csvButton).toBeEnabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/csv-viewer-button-enabled.png' });
    });

    test('should disable CSV viewer button for non-CSV files', async ({ window }) => {
      // Select JSON file
      const jsonFile = window.locator('.file-row.file').filter({ hasText: 'config.json' });
      await expect(jsonFile).toBeVisible({ timeout: 5000 });
      await jsonFile.click();

      // CSV viewer button should be disabled
      const csvButton = window.locator('button[title="Select a CSV file to view"]');
      await expect(csvButton).toBeDisabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/csv-viewer-button-disabled.png' });
    });

    test('should open CSV viewer overlay when clicking view button', async ({ window }) => {
      // Select CSV file
      const csvFile = window.locator('.file-row.file').filter({ hasText: 'users.csv' });
      await csvFile.click();

      // Click CSV viewer button
      const csvButton = window.locator('button[title="View CSV file"]');
      await csvButton.click();

      // Wait for CSV viewer overlay to appear
      const csvOverlay = window.locator('.csv-viewer-overlay');
      await expect(csvOverlay).toBeVisible({ timeout: 15000 });

      // Screenshot showing viewer opening
      await window.screenshot({ path: 'test-results/viewers/csv-viewer-opening.png' });
    });

    test('should display CSV data in table format', async ({ window }) => {
      // Select CSV file
      const csvFile = window.locator('.file-row.file').filter({ hasText: 'users.csv' });
      await csvFile.click();

      // Click CSV viewer button
      const csvButton = window.locator('button[title="View CSV file"]');
      await csvButton.click();

      // Wait for CSV viewer overlay to appear
      const csvOverlay = window.locator('.csv-viewer-overlay');
      await expect(csvOverlay).toBeVisible({ timeout: 15000 });

      // Wait for loading to complete
      const loadingSpinner = window.locator('.csv-viewer-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Check table is displayed
      const table = window.locator('.csv-viewer-table');
      await expect(table).toBeVisible();

      // Check headers are displayed
      const headers = window.locator('.csv-viewer-table thead th');
      await expect(headers.nth(1)).toContainText('id'); // First header after row number

      // Screenshot showing CSV data
      await window.screenshot({ path: 'test-results/viewers/csv-viewer-data.png' });
    });

    test('should display row count and column count in header', async ({ window }) => {
      // Select CSV file
      const csvFile = window.locator('.file-row.file').filter({ hasText: 'users.csv' });
      await csvFile.click();

      // Click CSV viewer button
      const csvButton = window.locator('button[title="View CSV file"]');
      await csvButton.click();

      // Wait for CSV viewer overlay
      const csvOverlay = window.locator('.csv-viewer-overlay');
      await expect(csvOverlay).toBeVisible({ timeout: 15000 });

      // Wait for loading to complete
      const loadingSpinner = window.locator('.csv-viewer-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Check meta info is displayed
      const metaItems = window.locator('.csv-viewer-meta-item');
      // Should show rows count
      await expect(metaItems.first()).toContainText('rows');
      // Should show columns count
      await expect(metaItems.nth(1)).toContainText('columns');

      // Screenshot showing meta info
      await window.screenshot({ path: 'test-results/viewers/csv-viewer-meta.png' });
    });

    test('should have search functionality', async ({ window }) => {
      // Select CSV file
      const csvFile = window.locator('.file-row.file').filter({ hasText: 'users.csv' });
      await csvFile.click();

      // Click CSV viewer button
      const csvButton = window.locator('button[title="View CSV file"]');
      await csvButton.click();

      // Wait for CSV viewer overlay
      const csvOverlay = window.locator('.csv-viewer-overlay');
      await expect(csvOverlay).toBeVisible({ timeout: 15000 });

      // Wait for loading to complete
      const loadingSpinner = window.locator('.csv-viewer-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Check search input is present
      const searchInput = window.locator('.csv-viewer-search-input');
      await expect(searchInput).toBeVisible();

      // Type search term
      await searchInput.fill('John');

      // Check search results count is shown
      const searchCount = window.locator('.csv-viewer-search-count');
      await expect(searchCount).toBeVisible();

      // Screenshot showing search
      await window.screenshot({ path: 'test-results/viewers/csv-viewer-search.png' });
    });

    test('should close CSV viewer when clicking Close button', async ({ window }) => {
      // Select CSV file
      const csvFile = window.locator('.file-row.file').filter({ hasText: 'users.csv' });
      await csvFile.click();

      // Click CSV viewer button
      const csvButton = window.locator('button[title="View CSV file"]');
      await csvButton.click();

      // Wait for CSV viewer overlay
      const csvOverlay = window.locator('.csv-viewer-overlay');
      await expect(csvOverlay).toBeVisible({ timeout: 15000 });

      // Click close button
      const closeButton = window.locator('.csv-viewer-btn-close');
      await closeButton.click();

      // Viewer should close
      await expect(csvOverlay).not.toBeVisible({ timeout: 5000 });

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/csv-viewer-closed.png' });
    });
  });

  test.describe('JSON Viewer', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets to load and select main bucket
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Navigate into data folder (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await expect(dataFolder).toBeVisible({ timeout: 15000 });
      await dataFolder.dblclick();
      await window.waitForTimeout(1500);
    });

    test('should enable JSON viewer button for JSON files', async ({ window }) => {
      // Select JSON file
      const jsonFile = window.locator('.file-row.file').filter({ hasText: 'config.json' });
      await expect(jsonFile).toBeVisible({ timeout: 5000 });
      await jsonFile.click();

      // JSON viewer button should be enabled
      const jsonButton = window.locator('button[title="View JSON file"]');
      await expect(jsonButton).toBeEnabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/json-viewer-button-enabled.png' });
    });

    test('should disable JSON viewer button for non-JSON files', async ({ window }) => {
      // Select CSV file
      const csvFile = window.locator('.file-row.file').filter({ hasText: 'users.csv' });
      await expect(csvFile).toBeVisible({ timeout: 5000 });
      await csvFile.click();

      // JSON viewer button should be disabled
      const jsonButton = window.locator('button[title="Select a JSON file to view"]');
      await expect(jsonButton).toBeDisabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/json-viewer-button-disabled.png' });
    });

    test('should open JSON viewer overlay when clicking view button', async ({ window }) => {
      // Select JSON file
      const jsonFile = window.locator('.file-row.file').filter({ hasText: 'config.json' });
      await jsonFile.click();

      // Click JSON viewer button
      const jsonButton = window.locator('button[title="View JSON file"]');
      await jsonButton.click();

      // Wait for JSON viewer overlay to appear
      const jsonOverlay = window.locator('.json-viewer-overlay');
      await expect(jsonOverlay).toBeVisible({ timeout: 15000 });

      // Screenshot showing viewer opening
      await window.screenshot({ path: 'test-results/viewers/json-viewer-opening.png' });
    });

    test('should display JSON in tree view by default', async ({ window }) => {
      // Select JSON file
      const jsonFile = window.locator('.file-row.file').filter({ hasText: 'config.json' });
      await jsonFile.click();

      // Click JSON viewer button
      const jsonButton = window.locator('button[title="View JSON file"]');
      await jsonButton.click();

      // Wait for JSON viewer overlay to appear
      const jsonOverlay = window.locator('.json-viewer-overlay');
      await expect(jsonOverlay).toBeVisible({ timeout: 15000 });

      // Wait for loading to complete
      const loadingSpinner = window.locator('.json-viewer-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Check tree view is displayed
      const treeView = window.locator('.json-viewer-tree');
      await expect(treeView).toBeVisible();

      // Tree toggle button should show as active for tree view
      const treeToggle = window.locator('.json-viewer-toggle-btn.active').filter({ hasText: 'Tree' });
      await expect(treeToggle).toBeVisible();

      // Screenshot showing tree view
      await window.screenshot({ path: 'test-results/viewers/json-viewer-tree-view.png' });
    });

    test('should switch to text view mode', async ({ window }) => {
      // Select JSON file
      const jsonFile = window.locator('.file-row.file').filter({ hasText: 'config.json' });
      await jsonFile.click();

      // Click JSON viewer button
      const jsonButton = window.locator('button[title="View JSON file"]');
      await jsonButton.click();

      // Wait for JSON viewer overlay to appear
      const jsonOverlay = window.locator('.json-viewer-overlay');
      await expect(jsonOverlay).toBeVisible({ timeout: 15000 });

      // Wait for loading to complete
      const loadingSpinner = window.locator('.json-viewer-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Click Text toggle button
      const textToggle = window.locator('.json-viewer-toggle-btn').filter({ hasText: 'Text' });
      await textToggle.click();

      // Check text view is displayed
      const textView = window.locator('.json-viewer-text');
      await expect(textView).toBeVisible();

      // Screenshot showing text view
      await window.screenshot({ path: 'test-results/viewers/json-viewer-text-view.png' });
    });

    test('should show key count and depth in header', async ({ window }) => {
      // Select JSON file
      const jsonFile = window.locator('.file-row.file').filter({ hasText: 'config.json' });
      await jsonFile.click();

      // Click JSON viewer button
      const jsonButton = window.locator('button[title="View JSON file"]');
      await jsonButton.click();

      // Wait for JSON viewer overlay
      const jsonOverlay = window.locator('.json-viewer-overlay');
      await expect(jsonOverlay).toBeVisible({ timeout: 15000 });

      // Wait for loading to complete
      const loadingSpinner = window.locator('.json-viewer-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Check meta info is displayed
      const metaItems = window.locator('.json-viewer-meta-item');
      // Should show keys count
      await expect(metaItems.first()).toContainText('keys');
      // Should show depth
      await expect(metaItems.nth(1)).toContainText('depth');

      // Screenshot showing meta info
      await window.screenshot({ path: 'test-results/viewers/json-viewer-meta.png' });
    });

    test('should have search functionality', async ({ window }) => {
      // Select JSON file
      const jsonFile = window.locator('.file-row.file').filter({ hasText: 'config.json' });
      await jsonFile.click();

      // Click JSON viewer button
      const jsonButton = window.locator('button[title="View JSON file"]');
      await jsonButton.click();

      // Wait for JSON viewer overlay
      const jsonOverlay = window.locator('.json-viewer-overlay');
      await expect(jsonOverlay).toBeVisible({ timeout: 15000 });

      // Wait for loading to complete
      const loadingSpinner = window.locator('.json-viewer-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Check search input is present
      const searchInput = window.locator('.json-viewer-search-input');
      await expect(searchInput).toBeVisible();

      // Type search term
      await searchInput.fill('test');

      // Screenshot showing search
      await window.screenshot({ path: 'test-results/viewers/json-viewer-search.png' });
    });

    test('should expand/collapse tree nodes', async ({ window }) => {
      // Select JSON file
      const jsonFile = window.locator('.file-row.file').filter({ hasText: 'config.json' });
      await jsonFile.click();

      // Click JSON viewer button
      const jsonButton = window.locator('button[title="View JSON file"]');
      await jsonButton.click();

      // Wait for JSON viewer overlay
      const jsonOverlay = window.locator('.json-viewer-overlay');
      await expect(jsonOverlay).toBeVisible({ timeout: 15000 });

      // Wait for loading to complete
      const loadingSpinner = window.locator('.json-viewer-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Check collapsible node exists
      const collapsibleNode = window.locator('.json-tree-collapsible').first();
      await expect(collapsibleNode).toBeVisible();

      // Screenshot showing tree nodes
      await window.screenshot({ path: 'test-results/viewers/json-viewer-tree-nodes.png' });
    });

    test('should close JSON viewer when clicking Close button', async ({ window }) => {
      // Select JSON file
      const jsonFile = window.locator('.file-row.file').filter({ hasText: 'config.json' });
      await jsonFile.click();

      // Click JSON viewer button
      const jsonButton = window.locator('button[title="View JSON file"]');
      await jsonButton.click();

      // Wait for JSON viewer overlay
      const jsonOverlay = window.locator('.json-viewer-overlay');
      await expect(jsonOverlay).toBeVisible({ timeout: 15000 });

      // Click close button
      const closeButton = window.locator('.json-viewer-btn-close');
      await closeButton.click();

      // Viewer should close
      await expect(jsonOverlay).not.toBeVisible({ timeout: 5000 });

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/json-viewer-closed.png' });
    });
  });

  test.describe('YAML Viewer', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets to load and select main bucket
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Navigate into data folder (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await expect(dataFolder).toBeVisible({ timeout: 15000 });
      await dataFolder.dblclick();
      await window.waitForTimeout(1500);
    });

    test('should enable YAML viewer button for YAML files', async ({ window }) => {
      // Select YAML file
      const yamlFile = window.locator('.file-row.file').filter({ hasText: 'config.yaml' });
      await expect(yamlFile).toBeVisible({ timeout: 5000 });
      await yamlFile.click();

      // YAML viewer button should be enabled
      const yamlButton = window.locator('button[title="View YAML file"]');
      await expect(yamlButton).toBeEnabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/yaml-viewer-button-enabled.png' });
    });

    test('should disable YAML viewer button for non-YAML files', async ({ window }) => {
      // Select JSON file
      const jsonFile = window.locator('.file-row.file').filter({ hasText: 'config.json' });
      await expect(jsonFile).toBeVisible({ timeout: 5000 });
      await jsonFile.click();

      // YAML viewer button should be disabled
      const yamlButton = window.locator('button[title="Select a YAML file to view"]');
      await expect(yamlButton).toBeDisabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/yaml-viewer-button-disabled.png' });
    });

    test('should open YAML viewer overlay when clicking view button', async ({ window }) => {
      // Select YAML file
      const yamlFile = window.locator('.file-row.file').filter({ hasText: 'config.yaml' });
      await yamlFile.click();

      // Click YAML viewer button
      const yamlButton = window.locator('button[title="View YAML file"]');
      await yamlButton.click();

      // Wait for YAML viewer overlay to appear
      const yamlOverlay = window.locator('.yaml-viewer-overlay');
      await expect(yamlOverlay).toBeVisible({ timeout: 15000 });

      // Screenshot showing viewer opening
      await window.screenshot({ path: 'test-results/viewers/yaml-viewer-opening.png' });
    });

    test('should display YAML content with syntax highlighting', async ({ window }) => {
      // Select YAML file
      const yamlFile = window.locator('.file-row.file').filter({ hasText: 'config.yaml' });
      await yamlFile.click();

      // Click YAML viewer button
      const yamlButton = window.locator('button[title="View YAML file"]');
      await yamlButton.click();

      // Wait for YAML viewer overlay to appear
      const yamlOverlay = window.locator('.yaml-viewer-overlay');
      await expect(yamlOverlay).toBeVisible({ timeout: 15000 });

      // Wait for loading to complete
      const loadingSpinner = window.locator('.yaml-viewer-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Check content is displayed with line numbers
      const content = window.locator('.yaml-viewer-text');
      await expect(content).toBeVisible();

      // Check line numbers are present
      const lineNumbers = window.locator('.yaml-line-number');
      await expect(lineNumbers.first()).toBeVisible();

      // Check syntax highlighting classes are present
      const yamlKey = window.locator('.yaml-key').first();
      await expect(yamlKey).toBeVisible();

      // Screenshot showing syntax highlighted content
      await window.screenshot({ path: 'test-results/viewers/yaml-viewer-syntax.png' });
    });

    test('should show line count and key count in header', async ({ window }) => {
      // Select YAML file
      const yamlFile = window.locator('.file-row.file').filter({ hasText: 'config.yaml' });
      await yamlFile.click();

      // Click YAML viewer button
      const yamlButton = window.locator('button[title="View YAML file"]');
      await yamlButton.click();

      // Wait for YAML viewer overlay
      const yamlOverlay = window.locator('.yaml-viewer-overlay');
      await expect(yamlOverlay).toBeVisible({ timeout: 15000 });

      // Wait for loading to complete
      const loadingSpinner = window.locator('.yaml-viewer-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Check meta info is displayed
      const metaItems = window.locator('.yaml-viewer-meta-item');
      // Should show lines count
      await expect(metaItems.first()).toContainText('lines');
      // Should show keys count
      await expect(metaItems.nth(1)).toContainText('keys');

      // Screenshot showing meta info
      await window.screenshot({ path: 'test-results/viewers/yaml-viewer-meta.png' });
    });

    test('should have search functionality', async ({ window }) => {
      // Select YAML file
      const yamlFile = window.locator('.file-row.file').filter({ hasText: 'config.yaml' });
      await yamlFile.click();

      // Click YAML viewer button
      const yamlButton = window.locator('button[title="View YAML file"]');
      await yamlButton.click();

      // Wait for YAML viewer overlay
      const yamlOverlay = window.locator('.yaml-viewer-overlay');
      await expect(yamlOverlay).toBeVisible({ timeout: 15000 });

      // Wait for loading to complete
      const loadingSpinner = window.locator('.yaml-viewer-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Check search input is present
      const searchInput = window.locator('.yaml-viewer-search-input');
      await expect(searchInput).toBeVisible();

      // Type search term
      await searchInput.fill('test');

      // Check search results count is shown
      const searchCount = window.locator('.yaml-viewer-search-count');
      await expect(searchCount).toBeVisible();

      // Screenshot showing search
      await window.screenshot({ path: 'test-results/viewers/yaml-viewer-search.png' });
    });

    test('should close YAML viewer when clicking Close button', async ({ window }) => {
      // Select YAML file
      const yamlFile = window.locator('.file-row.file').filter({ hasText: 'config.yaml' });
      await yamlFile.click();

      // Click YAML viewer button
      const yamlButton = window.locator('button[title="View YAML file"]');
      await yamlButton.click();

      // Wait for YAML viewer overlay
      const yamlOverlay = window.locator('.yaml-viewer-overlay');
      await expect(yamlOverlay).toBeVisible({ timeout: 15000 });

      // Click close button
      const closeButton = window.locator('.yaml-viewer-btn-close');
      await closeButton.click();

      // Viewer should close
      await expect(yamlOverlay).not.toBeVisible({ timeout: 5000 });

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/yaml-viewer-closed.png' });
    });
  });

  test.describe('Image Preview', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets to load and select main bucket
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);

      // Navigate into images folder (double-click to navigate)
      const imagesFolder = window.locator('.file-row.folder').filter({ hasText: 'images' });
      await imagesFolder.dblclick();
      await window.waitForTimeout(1500);
    });

    test('should enable image preview button for image files', async ({ window }) => {
      // Select PNG file
      const imageFile = window.locator('.file-row.file').filter({ hasText: 'test.png' });
      await expect(imageFile).toBeVisible({ timeout: 5000 });
      await imageFile.click();

      // Image preview button should be enabled
      const imageButton = window.locator('button[title="Preview image"]');
      await expect(imageButton).toBeEnabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/image-preview-button-enabled.png' });
    });

    test('should disable image preview button for non-image files', async ({ window }) => {
      // Go back to root
      const upButton = window.locator('.go-up-btn');
      await upButton.click();
      await window.waitForTimeout(1500);

      // Navigate into data folder (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await expect(dataFolder).toBeVisible({ timeout: 15000 });
      await dataFolder.dblclick();
      await window.waitForTimeout(1500);

      // Select JSON file
      const jsonFile = window.locator('.file-row.file').filter({ hasText: 'config.json' });
      await jsonFile.click();

      // Image preview button should be disabled
      const imageButton = window.locator('button[title="Select an image file to preview"]');
      await expect(imageButton).toBeDisabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/image-preview-button-disabled.png' });
    });

    test('should open image preview overlay when clicking view button', async ({ window }) => {
      // Select PNG file
      const imageFile = window.locator('.file-row.file').filter({ hasText: 'test.png' });
      await imageFile.click();

      // Click image preview button
      const imageButton = window.locator('button[title="Preview image"]');
      await imageButton.click();

      // Wait for image preview overlay to appear
      const imageOverlay = window.locator('.image-preview-overlay');
      await expect(imageOverlay).toBeVisible({ timeout: 15000 });

      // Screenshot showing preview opening
      await window.screenshot({ path: 'test-results/viewers/image-preview-opening.png' });
    });

    test('should display image in preview', async ({ window }) => {
      // Select PNG file
      const imageFile = window.locator('.file-row.file').filter({ hasText: 'test.png' });
      await imageFile.click();

      // Click image preview button
      const imageButton = window.locator('button[title="Preview image"]');
      await imageButton.click();

      // Wait for image preview overlay to appear
      const imageOverlay = window.locator('.image-preview-overlay');
      await expect(imageOverlay).toBeVisible({ timeout: 15000 });

      // Wait for loading to complete
      const loadingSpinner = window.locator('.image-preview-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Check image is displayed
      const previewImage = window.locator('.image-preview-image');
      await expect(previewImage).toBeVisible();

      // Screenshot showing image preview
      await window.screenshot({ path: 'test-results/viewers/image-preview-loaded.png' });
    });

    test('should show file name in preview header', async ({ window }) => {
      // Select PNG file
      const imageFile = window.locator('.file-row.file').filter({ hasText: 'test.png' });
      await imageFile.click();

      // Click image preview button
      const imageButton = window.locator('button[title="Preview image"]');
      await imageButton.click();

      // Wait for image preview overlay
      const imageOverlay = window.locator('.image-preview-overlay');
      await expect(imageOverlay).toBeVisible({ timeout: 15000 });

      // Check file name is displayed
      const fileNameDisplay = window.locator('.image-preview-filename');
      await expect(fileNameDisplay).toContainText('test.png');

      // Screenshot showing header
      await window.screenshot({ path: 'test-results/viewers/image-preview-header.png' });
    });

    test('should have zoom controls', async ({ window }) => {
      // Select PNG file
      const imageFile = window.locator('.file-row.file').filter({ hasText: 'test.png' });
      await imageFile.click();

      // Click image preview button
      const imageButton = window.locator('button[title="Preview image"]');
      await imageButton.click();

      // Wait for image preview overlay
      const imageOverlay = window.locator('.image-preview-overlay');
      await expect(imageOverlay).toBeVisible({ timeout: 15000 });

      // Check zoom controls are present
      const zoomIn = window.locator('.image-preview-zoom-btn').filter({ hasText: '+' });
      await expect(zoomIn).toBeVisible();

      const zoomOut = window.locator('.image-preview-zoom-btn').filter({ hasText: '-' });
      await expect(zoomOut).toBeVisible();

      const zoomValue = window.locator('.image-preview-zoom-value');
      await expect(zoomValue).toBeVisible();
      await expect(zoomValue).toContainText('100%');

      // Screenshot showing zoom controls
      await window.screenshot({ path: 'test-results/viewers/image-preview-zoom-controls.png' });
    });

    test('should zoom in when clicking zoom in button', async ({ window }) => {
      // Select PNG file
      const imageFile = window.locator('.file-row.file').filter({ hasText: 'test.png' });
      await imageFile.click();

      // Click image preview button
      const imageButton = window.locator('button[title="Preview image"]');
      await imageButton.click();

      // Wait for image preview overlay
      const imageOverlay = window.locator('.image-preview-overlay');
      await expect(imageOverlay).toBeVisible({ timeout: 15000 });

      // Wait for loading to complete
      const loadingSpinner = window.locator('.image-preview-loading');
      await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });

      // Click zoom in
      const zoomIn = window.locator('.image-preview-zoom-btn').filter({ hasText: '+' });
      await zoomIn.click();

      // Check zoom value increased
      const zoomValue = window.locator('.image-preview-zoom-value');
      await expect(zoomValue).toContainText('125%');

      // Screenshot showing zoomed in
      await window.screenshot({ path: 'test-results/viewers/image-preview-zoomed-in.png' });
    });

    test('should close image preview when clicking Close button', async ({ window }) => {
      // Select PNG file
      const imageFile = window.locator('.file-row.file').filter({ hasText: 'test.png' });
      await imageFile.click();

      // Click image preview button
      const imageButton = window.locator('button[title="Preview image"]');
      await imageButton.click();

      // Wait for image preview overlay
      const imageOverlay = window.locator('.image-preview-overlay');
      await expect(imageOverlay).toBeVisible({ timeout: 15000 });

      // Click close button
      const closeButton = window.locator('.image-preview-btn');
      await closeButton.click();

      // Preview should close
      await expect(imageOverlay).not.toBeVisible({ timeout: 5000 });

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/image-preview-closed.png' });
    });

    test('should show S3 path in footer', async ({ window }) => {
      // Select PNG file
      const imageFile = window.locator('.file-row.file').filter({ hasText: 'test.png' });
      await imageFile.click();

      // Click image preview button
      const imageButton = window.locator('button[title="Preview image"]');
      await imageButton.click();

      // Wait for image preview overlay
      const imageOverlay = window.locator('.image-preview-overlay');
      await expect(imageOverlay).toBeVisible({ timeout: 15000 });

      // Check S3 path is shown in footer
      const pathDisplay = window.locator('.image-preview-path');
      await expect(pathDisplay).toContainText(`s3://${TEST_BUCKETS.main}/images/test.png`);

      // Screenshot showing footer
      await window.screenshot({ path: 'test-results/viewers/image-preview-footer.png' });
    });
  });

  test.describe('Parquet Viewer', () => {
    // Note: For Parquet testing, we need to add a proper parquet file
    // The test data currently has a binary file but not a real parquet file
    // We'll test the button states and UI elements

    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets to load and select main bucket
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);
    });

    test('should disable parquet viewer button for non-parquet files', async ({ window }) => {
      // Navigate into data folder (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await expect(dataFolder).toBeVisible({ timeout: 15000 });
      await dataFolder.dblclick();
      await window.waitForTimeout(1500);

      // Select JSON file
      const jsonFile = window.locator('.file-row.file').filter({ hasText: 'config.json' });
      await jsonFile.click();

      // Parquet viewer button should be disabled
      const parquetButton = window.locator('button[title="Select a parquet file to view"]');
      await expect(parquetButton).toBeDisabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/parquet-viewer-button-disabled.png' });
    });

    test('should enable parquet viewer button for .parquet files', async ({ window }) => {
      // First, create a simple parquet file for testing
      // This is a minimal valid parquet file (the smallest possible)
      const s3Client = getLocalStackS3Client();
      const timestamp = Date.now();
      const parquetFileName = `test-${timestamp}.parquet`;

      // Create a minimal parquet file using raw bytes
      // This is the simplest valid parquet file structure
      const minimalParquet = createMinimalParquetBuffer();

      await s3Client.send(new PutObjectCommand({
        Bucket: TEST_BUCKETS.main,
        Key: parquetFileName,
        Body: minimalParquet,
        ContentType: 'application/octet-stream',
      }));

      // Refresh to see the new file
      const refreshButton = window.locator('button[title="Refresh file list"]');
      await refreshButton.click();
      await window.waitForTimeout(2000);

      // Select the parquet file
      const parquetFile = window.locator('.file-row.file').filter({ hasText: parquetFileName });
      await expect(parquetFile).toBeVisible({ timeout: 5000 });
      await parquetFile.click();

      // Parquet viewer button should be enabled
      const parquetButton = window.locator('button[title="View parquet file"]');
      await expect(parquetButton).toBeEnabled();

      // Screenshot
      await window.screenshot({ path: 'test-results/viewers/parquet-viewer-button-enabled.png' });

      // Clean up
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: TEST_BUCKETS.main,
          Key: parquetFileName,
        }));
      } catch {
        // Ignore cleanup errors
      }
    });
  });

  test.describe('Viewer Toolbar Integration', () => {
    test.beforeEach(async ({ window }) => {
      // Select test profile and main bucket
      const dropdown = window.locator('.profile-dropdown');
      await dropdown.selectOption('test');

      // Wait for buckets to load and select main bucket
      const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
      await expect(mainBucket).toBeVisible({ timeout: 15000 });
      await mainBucket.click();
      await window.waitForTimeout(2000);
    });

    test('should show all viewer buttons in toolbar', async ({ window }) => {
      // Navigate into data folder (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await expect(dataFolder).toBeVisible({ timeout: 15000 });
      await dataFolder.dblclick();
      await window.waitForTimeout(1500);

      // Check all viewer buttons are present in toolbar
      // Edit (title contains "edit" - either "Edit file" or "Select a file to edit")
      const editButton = window.locator('.file-toolbar button[title*="edit"]');
      await expect(editButton).toBeVisible();

      // Parquet (title contains "parquet")
      const parquetButton = window.locator('.file-toolbar button[title*="parquet"]');
      await expect(parquetButton).toBeVisible();

      // CSV
      const csvButton = window.locator('.file-toolbar button[title*="CSV"]');
      await expect(csvButton).toBeVisible();

      // JSON
      const jsonButton = window.locator('.file-toolbar button[title*="JSON"]');
      await expect(jsonButton).toBeVisible();

      // YAML
      const yamlButton = window.locator('.file-toolbar button[title*="YAML"]');
      await expect(yamlButton).toBeVisible();

      // Image (title contains "image")
      const imageButton = window.locator('.file-toolbar button[title*="image"]');
      await expect(imageButton).toBeVisible();

      // Screenshot showing all viewer buttons
      await window.screenshot({ path: 'test-results/viewers/toolbar-all-buttons.png' });
    });

    test('should enable only relevant viewer button based on file type', async ({ window }) => {
      // Navigate into data folder (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await expect(dataFolder).toBeVisible({ timeout: 15000 });
      await dataFolder.dblclick();
      await window.waitForTimeout(1500);

      // Select JSON file
      const jsonFile = window.locator('.file-row.file').filter({ hasText: 'config.json' });
      await jsonFile.click();

      // JSON viewer should be enabled
      const jsonButton = window.locator('button[title="View JSON file"]');
      await expect(jsonButton).toBeEnabled();

      // CSV viewer should be disabled
      const csvButton = window.locator('button[title="Select a CSV file to view"]');
      await expect(csvButton).toBeDisabled();

      // YAML viewer should be disabled
      const yamlButton = window.locator('button[title="Select a YAML file to view"]');
      await expect(yamlButton).toBeDisabled();

      // Screenshot showing correct button states
      await window.screenshot({ path: 'test-results/viewers/toolbar-json-selected.png' });
    });

    test('should change enabled viewer buttons when selecting different file types', async ({ window }) => {
      // Navigate into data folder (double-click to navigate)
      const dataFolder = window.locator('.file-row.folder').filter({ hasText: 'data' });
      await expect(dataFolder).toBeVisible({ timeout: 15000 });
      await dataFolder.dblclick();
      await window.waitForTimeout(1500);

      // First select JSON file
      const jsonFile = window.locator('.file-row.file').filter({ hasText: 'config.json' });
      await jsonFile.click();

      // JSON viewer should be enabled
      let jsonButton = window.locator('button[title="View JSON file"]');
      await expect(jsonButton).toBeEnabled();

      // Now select CSV file
      const csvFile = window.locator('.file-row.file').filter({ hasText: 'users.csv' });
      await csvFile.click();

      // CSV viewer should be enabled
      const csvButton = window.locator('button[title="View CSV file"]');
      await expect(csvButton).toBeEnabled();

      // JSON viewer should be disabled now
      jsonButton = window.locator('button[title="Select a JSON file to view"]');
      await expect(jsonButton).toBeDisabled();

      // Screenshot showing CSV selected state
      await window.screenshot({ path: 'test-results/viewers/toolbar-csv-selected.png' });
    });
  });
});

/**
 * Create a minimal valid parquet file buffer
 * This creates the smallest possible valid parquet file for testing
 */
function createMinimalParquetBuffer(): Buffer {
  // A minimal parquet file has:
  // 1. Magic bytes "PAR1" at start
  // 2. File metadata
  // 3. Magic bytes "PAR1" at end

  // For testing purposes, we create a very simple schema with no rows
  // This is a pre-built minimal parquet file that contains just the structure
  // Generated using Apache Arrow/Parquet with a simple int64 column and 0 rows

  // Minimal parquet file bytes (empty table with one int64 column named "id")
  const bytes = [
    0x50, 0x41, 0x52, 0x31, // PAR1 magic bytes
    // Footer metadata (thrift encoded)
    0x15, 0x00, 0x15, 0x10, 0x15, 0x10, 0x2c, 0x15, 0x06, 0x15, 0x00, 0x15, 0x06, 0x15, 0x06,
    0x00, 0x00, 0x28, 0x03, 0x69, 0x64, 0x25, 0x00, 0x26, 0x08, 0x1c, 0x15, 0x04, 0x19, 0x35,
    0x04, 0x00, 0x06, 0x19, 0x18, 0x02, 0x69, 0x64, 0x15, 0x00, 0x16, 0x00, 0x16, 0x00, 0x16,
    0x00, 0x00, 0x00, 0x16, 0x00, 0x16, 0x00, 0x16, 0x00, 0x26, 0x00, 0x28, 0x00, 0x00, 0x19,
    0x2c, 0x18, 0x18, 0x70, 0x79, 0x61, 0x72, 0x72, 0x6f, 0x77, 0x20, 0x76, 0x65, 0x72, 0x73,
    0x69, 0x6f, 0x6e, 0x20, 0x31, 0x34, 0x2e, 0x30, 0x2e, 0x31, 0x00, 0x00, 0x59, 0x00, 0x00,
    0x00, // Footer length
    0x50, 0x41, 0x52, 0x31, // PAR1 magic bytes at end
  ];

  return Buffer.from(bytes);
}
