/**
 * Pure state derivation for the file toolbar: which buttons are enabled and
 * what their titles/badges say. Kept out of the component so the branch logic
 * is table-testable.
 */

export interface ToolbarSelectedFile {
  key: string;
  isPrefix: boolean;
}

export interface ToolbarButtonState {
  title: string;
  disabled: boolean;
  badge?: string;
}

export interface ToolbarState {
  newFile: ToolbarButtonState;
  newFolder: ToolbarButtonState;
  upload: ToolbarButtonState;
  download: ToolbarButtonState;
  edit: ToolbarButtonState;
  parquet: ToolbarButtonState;
  csv: ToolbarButtonState;
  json: ToolbarButtonState;
  yaml: ToolbarButtonState;
  image: ToolbarButtonState;
  copy: ToolbarButtonState;
  rename: ToolbarButtonState;
  delete: ToolbarButtonState;
  properties: ToolbarButtonState;
  refresh: ToolbarButtonState;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];

/** Last dot-separated segment of a key, lowercased ('' when there is none). */
function lastExtension(key: string): string {
  return key.split('.').pop()?.toLowerCase() ?? '';
}

/**
 * Get the base extension of a file, looking past .gz if present
 * e.g., 'data.json.gz' -> 'json', 'data.csv' -> 'csv'
 */
export function getBaseExtension(key: string): string {
  if (key.toLowerCase().endsWith('.gz')) {
    return lastExtension(key.slice(0, -3));
  }
  return lastExtension(key);
}

/** Parquet files are not supported with .gz compression. */
export function isParquetFile(key: string): boolean {
  return lastExtension(key) === 'parquet';
}

/** CSV or TSV, including .csv.gz. */
export function isCsvFile(key: string): boolean {
  const ext = getBaseExtension(key);
  return ext === 'csv' || ext === 'tsv';
}

/** JSON, including .json.gz. */
export function isJsonFile(key: string): boolean {
  return getBaseExtension(key) === 'json';
}

/** YAML, including .yaml.gz and .yml.gz. */
export function isYamlFile(key: string): boolean {
  const ext = getBaseExtension(key);
  return ext === 'yaml' || ext === 'yml';
}

/** Image that can be previewed. */
export function isImageFile(key: string): boolean {
  return IMAGE_EXTENSIONS.includes(lastExtension(key));
}

/** True when a single non-folder file is selected and its key satisfies the predicate. */
export function singleFileMatches(
  selectedFile: ToolbarSelectedFile | null,
  selectedCount: number,
  predicate: (key: string) => boolean
): boolean {
  if (selectedFile === null || selectedFile.isPrefix || selectedCount > 1) return false;
  return predicate(selectedFile.key);
}

/** Title that picks between an enabled and a disabled wording. */
export function pickTitle(enabled: boolean, whenEnabled: string, whenDisabled: string): string {
  return enabled ? whenEnabled : whenDisabled;
}

/** Title for the delete button. */
export function getDeleteTitle(selectedCount: number, hasFolderSelection: boolean): string {
  if (selectedCount > 1) return `Delete ${selectedCount} items`;
  return pickTitle(hasFolderSelection, 'Delete selected folder', 'Delete selected file');
}

/** Title for the copy-URL button. */
export function getCopyTitle(hasMultipleSelection: boolean, hasSelection: boolean): string {
  if (hasMultipleSelection) return 'Copy URL not available for multiple files';
  return pickTitle(hasSelection, 'Copy S3 URL to clipboard', 'Select a file to copy URL');
}

/** Badge text showing the selection size for multiselect. */
export function getDeleteBadge(selectedCount: number): string | undefined {
  return selectedCount > 1 ? String(selectedCount) : undefined;
}

/** Title for single-file-only actions that are unavailable for multiselect. */
function singleOnlyTitle(hasMultipleSelection: boolean, action: string, normal: string): string {
  return pickTitle(!hasMultipleSelection, normal, `${action} not available for multiple files`);
}

function typedButton(
  allowed: boolean,
  disabled: boolean,
  whenEnabled: string,
  whenDisabled: string
): ToolbarButtonState {
  return { title: pickTitle(allowed, whenEnabled, whenDisabled), disabled: disabled || !allowed };
}

/** Derive every toolbar button's title/disabled/badge from the selection. */
export function getToolbarState(
  selectedBucket: string | null,
  selectedFile: ToolbarSelectedFile | null,
  selectedCount: number,
  disabled: boolean
): ToolbarState {
  const hasSelection = selectedFile !== null && !selectedFile.isPrefix;
  const hasFolderSelection = selectedFile !== null && selectedFile.isPrefix;
  const hasMultiple = selectedCount > 1;
  const single = hasSelection && !hasMultiple;
  const noBucket = disabled || !selectedBucket;
  const singleDisabled = disabled || !single;
  const matches = (predicate: (key: string) => boolean): boolean =>
    singleFileMatches(selectedFile, selectedCount, predicate);

  return {
    newFile: { title: 'Create new empty file', disabled: noBucket },
    newFolder: { title: 'Create new folder', disabled: noBucket },
    upload: { title: 'Upload files', disabled: noBucket },
    download: {
      title: singleOnlyTitle(hasMultiple, 'Download', 'Download selected file'),
      disabled: singleDisabled,
    },
    edit: typedButton(single, disabled, 'Edit file as text', 'Select a file to edit'),
    parquet: typedButton(matches(isParquetFile), disabled, 'View parquet file', 'Select a parquet file to view'),
    csv: typedButton(matches(isCsvFile), disabled, 'View CSV file', 'Select a CSV file to view'),
    json: typedButton(matches(isJsonFile), disabled, 'View JSON file', 'Select a JSON file to view'),
    yaml: typedButton(matches(isYamlFile), disabled, 'View YAML file', 'Select a YAML file to view'),
    image: typedButton(matches(isImageFile), disabled, 'Preview image', 'Select an image file to preview'),
    copy: { title: getCopyTitle(hasMultiple, hasSelection), disabled: singleDisabled },
    rename: {
      title: singleOnlyTitle(hasMultiple, 'Rename', 'Rename selected file'),
      disabled: singleDisabled,
    },
    delete: {
      title: getDeleteTitle(selectedCount, hasFolderSelection),
      disabled: disabled || selectedCount <= 0,
      badge: getDeleteBadge(selectedCount),
    },
    properties: typedButton(
      selectedFile !== null && !hasMultiple,
      disabled,
      'View properties',
      'Select a file or folder to view properties'
    ),
    refresh: { title: 'Refresh file list', disabled: noBucket },
  };
}
