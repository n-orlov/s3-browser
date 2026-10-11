/**
 * Extracts bucket name and key from an S3 URL
 * Supports both s3:// and https:// formats
 * @param url - The S3 URL to parse
 * @returns Object with bucket and key, or null if invalid
 */
export function parseS3Url(url: string): { bucket: string; key: string } | null {
  // Handle s3:// format
  const s3Match = url.match(/^s3:\/\/([^/]+)\/?(.*)$/);
  if (s3Match) {
    return {
      bucket: s3Match[1],
      key: s3Match[2] || '',
    };
  }

  // Handle https://bucket.s3.region.amazonaws.com/key format
  const virtualHostMatch = url.match(/^https?:\/\/([^.]+)\.s3\.([^.]+\.)?amazonaws\.com\/?(.*)$/);
  if (virtualHostMatch) {
    return {
      bucket: virtualHostMatch[1],
      key: virtualHostMatch[3] || '',
    };
  }

  // Handle https://s3.region.amazonaws.com/bucket/key format
  const pathStyleMatch = url.match(/^https?:\/\/s3\.([^.]+\.)?amazonaws\.com\/([^/]+)\/?(.*)$/);
  if (pathStyleMatch) {
    return {
      bucket: pathStyleMatch[2],
      key: pathStyleMatch[3] || '',
    };
  }

  return null;
}
