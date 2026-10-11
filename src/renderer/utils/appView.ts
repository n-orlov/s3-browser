import type { S3Object } from '../components/FileList';

/** Header path shown above the file list: "Files", the bucket, or bucket/prefix. */
export function getDisplayPath(bucket: string | null, prefix: string): string {
  if (!bucket) return 'Files';
  if (!prefix) return bucket;
  return `${bucket}/${prefix}`;
}

/** Last path segment of a key (for display of a selected file). Empty string for an empty key. */
export function getLastSegment(key: string): string {
  return key.split('/').pop() ?? '';
}

/** Last segment of a key, falling back to the whole key when the last segment is empty. */
export function getFileNameOrKey(key: string): string {
  return getLastSegment(key) || key;
}

/** Initial name offered in the rename dialog: the selected file's last segment, or '' with no selection. */
export function getRenameName(file: S3Object | null): string {
  return file ? getLastSegment(file.key) : '';
}

/** Name listed in the delete confirmation: last non-empty segment, with a trailing slash for folders. */
export function getDeleteDisplayName(file: Pick<S3Object, 'key' | 'isPrefix'>): string {
  const name = file.key.split('/').filter(Boolean).pop() || '';
  return file.isPrefix ? `${name}/` : name;
}

/** Key to auto-select after creating an item: folders get a trailing slash. */
export function getNewItemSelectionKey(key: string, itemType: 'file' | 'folder'): string {
  if (itemType !== 'folder') return key;
  return key.endsWith('/') ? key : `${key}/`;
}

/** Object key for a newly created item under the current prefix. */
export function buildNewItemKey(prefix: string, name: string): string {
  return prefix ? `${prefix}${name}` : name;
}
