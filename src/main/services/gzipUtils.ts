import * as zlib from 'zlib';
import { promisify } from 'util';

const gunzipAsync = promisify(zlib.gunzip);
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

/**
 * Decompress gzip content to string
 * @param buffer - The gzip compressed buffer
 * @returns The decompressed string content
 */
export async function decompressGzip(buffer: Buffer): Promise<string> {
  const decompressed = await gunzipAsync(buffer);
  return decompressed.toString('utf-8');
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
export async function tryDecompressGzip(buffer: Buffer): Promise<string> {
  try {
    return await decompressGzip(buffer);
  } catch {
    // If decompression fails, return as-is (might be a corrupt file or not actually gzipped)
    return buffer.toString('utf-8');
  }
}
