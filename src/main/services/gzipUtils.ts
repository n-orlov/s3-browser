import * as zlib from 'zlib';
import { promisify } from 'util';

import { getMaxContentBytes, formatContentLimit } from '../contentLimits';

const gunzipAsync = promisify(zlib.gunzip) as (
  buf: zlib.InputType,
  options: zlib.ZlibOptions,
) => Promise<Buffer>;
const gzipAsync = promisify(zlib.gzip);

/**
 * Check if a file key ends with .gz extension
 */
export function isGzipFile(key: string): boolean {
  return key.toLowerCase().endsWith('.gz');
}

/**
 * Get the base extension of a file (before .gz if present)
 * e.g., 'data.json.gz' -> 'json', 'data.csv.gz' -> 'csv', 'data.json' -> 'json'
 */
export function getBaseExtension(key: string): string {
  const lowerKey = key.toLowerCase();

  // If it ends with .gz, get the extension before .gz
  if (lowerKey.endsWith('.gz')) {
    const withoutGz = key.slice(0, -3);
    const ext = withoutGz.split('.').pop()?.toLowerCase() ?? '';
    return ext;
  }

  // Otherwise just get the last extension
  return key.split('.').pop()?.toLowerCase() ?? '';
}

/** Raised when gunzip output would exceed the configured cap (gzip bomb guard). */
export class GzipOutputTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Decompressed content exceeds the maximum size of ${formatContentLimit(limit)}.`);
    this.name = 'GzipOutputTooLargeError';
  }
}

/**
 * Decompress gzip content to string
 * @param buffer - The gzip compressed buffer
 * @param maxOutputBytes - Maximum decompressed size; defaults to the content cap
 * @returns The decompressed string content
 * @throws GzipOutputTooLargeError when the output would exceed the cap
 */
export async function decompressGzip(
  buffer: Buffer,
  maxOutputBytes: number = getMaxContentBytes(),
): Promise<string> {
  try {
    const decompressed = await gunzipAsync(buffer, { maxOutputLength: maxOutputBytes });
    return decompressed.toString('utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new GzipOutputTooLargeError(maxOutputBytes);
    }
    throw error;
  }
}

/**
 * Compress string content to gzip buffer
 * @param content - The string content to compress
 * @returns The gzip compressed buffer
 */
export async function compressGzip(content: string): Promise<Buffer> {
  const buffer = Buffer.from(content, 'utf-8');
  const compressed = await gzipAsync(buffer);
  return compressed;
}

/**
 * Try to decompress content, returns original if not valid gzip
 * @param buffer - The potentially compressed buffer
 * @returns The decompressed content as string
 */
export async function tryDecompressGzip(
  buffer: Buffer,
  maxOutputBytes: number = getMaxContentBytes(),
): Promise<string> {
  try {
    return await decompressGzip(buffer, maxOutputBytes);
  } catch (error) {
    if (error instanceof GzipOutputTooLargeError) {
      throw error;
    }
    // If decompression fails, return as-is (might be a corrupt file or not actually gzipped)
    return buffer.toString('utf-8');
  }
}
