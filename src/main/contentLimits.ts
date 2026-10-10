/**
 * Size cap for the content-reading IPC handlers (`s3:download-content`,
 * `s3:download-binary-content`). The handlers HEAD the object first and refuse
 * to download a body larger than the cap.
 */
export const DEFAULT_MAX_CONTENT_BYTES = 50 * 1024 * 1024;

/** Environment variable that overrides the cap (positive integer, bytes). */
export const MAX_CONTENT_BYTES_ENV = 'S3_BROWSER_MAX_CONTENT_BYTES';

export function getMaxContentBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[MAX_CONTENT_BYTES_ENV];
  if (raw === undefined || !/^[1-9]\d*$/.test(raw)) {
    return DEFAULT_MAX_CONTENT_BYTES;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : DEFAULT_MAX_CONTENT_BYTES;
}

function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/** Error text for an object whose size exceeds the cap; names the limit. */
export function contentTooLargeMessage(size: number, limit: number): string {
  return `File is too large to open (${formatMegabytes(size)}). Maximum size is ${formatMegabytes(limit)} (${limit} bytes).`;
}
