import type { ObjectMetadata } from '../components/PropertiesDialog';

export interface DetailRow {
  label: string;
  value: string;
  mono: boolean;
}

/**
 * Format bytes into human readable size
 */
export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return '-';
  if (bytes === 0) return '0 bytes';

  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  const base = 1024;
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(base)),
    units.length - 1
  );

  const value = bytes / Math.pow(base, exponent);
  const formatted = exponent === 0 ? value.toString() : value.toFixed(2);

  return `${formatted} ${units[exponent]}`;
}

/**
 * Format date to locale string
 */
export function formatDate(date: Date | string | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString();
}

/**
 * Get the file/folder name from a key
 */
export function getName(key: string): string {
  const normalized = key.endsWith('/') ? key.slice(0, -1) : key;
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? normalized : normalized.substring(lastSlash + 1);
}

/**
 * Basic metadata shown for a folder (no S3 request is made).
 */
export function buildFolderMetadata(bucket: string, fileKey: string): ObjectMetadata {
  return {
    key: fileKey,
    bucket,
    s3Url: `s3://${bucket}/${fileKey}`,
    httpUrl: `https://${bucket}.s3.amazonaws.com/${encodeURIComponent(fileKey)}`,
    tags: {},
    customMetadata: {},
  };
}

/**
 * Message to show for a failed metadata request (falls back when empty).
 */
export function getErrorMessage(message: string | undefined): string {
  return message || 'Failed to load metadata';
}

/**
 * Type column value: folders are always 'Folder', files fall back to 'Unknown'.
 */
export function getTypeLabel(isFolder: boolean, contentType: string | undefined): string {
  if (isFolder) return 'Folder';
  return contentType || 'Unknown';
}

/**
 * The optional "Details" rows, in display order; absent/empty values are omitted.
 */
export function getDetailRows(metadata: ObjectMetadata): DetailRow[] {
  const candidates: Array<{ label: string; value: string | undefined; mono: boolean }> = [
    {
      label: 'Last Modified',
      value: metadata.lastModified ? formatDate(metadata.lastModified) : undefined,
      mono: false,
    },
    { label: 'ETag', value: metadata.etag, mono: true },
    { label: 'Storage Class', value: metadata.storageClass, mono: false },
    { label: 'Version ID', value: metadata.versionId, mono: true },
    { label: 'Encryption', value: metadata.serverSideEncryption, mono: false },
    { label: 'Content Encoding', value: metadata.contentEncoding, mono: false },
    { label: 'Cache Control', value: metadata.cacheControl, mono: false },
    {
      label: 'Expires',
      value: metadata.expires ? formatDate(metadata.expires) : undefined,
      mono: false,
    },
  ];
  const rows: DetailRow[] = [];
  for (const { label, value, mono } of candidates) {
    if (value) rows.push({ label, value, mono });
  }
  return rows;
}
