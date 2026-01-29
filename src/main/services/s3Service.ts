import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  type S3ClientConfig,
  type Bucket,
  type _Object,
  type CommonPrefix,
} from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { getProfile, type AwsProfile } from './awsCredentials';

// Default page size for object listing
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;

export interface S3Bucket {
  name: string;
  creationDate?: Date;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified?: Date;
  etag?: string;
  storageClass?: string;
  // Indicates if this is a "folder" (common prefix)
  isPrefix: boolean;
}

export interface ListObjectsResult {
  objects: S3Object[];
  // Common prefixes (folders)
  prefixes: S3Object[];
  // For pagination
  continuationToken?: string;
  isTruncated: boolean;
  // The prefix that was queried
  prefix: string;
  // Total keys returned in this request
  keyCount: number;
}

export interface ListObjectsOptions {
  bucket: string;
  prefix?: string;
  delimiter?: string;
  maxKeys?: number;
  continuationToken?: string;
}

// Cached S3 client instance
let s3Client: S3Client | null = null;
let currentClientProfile: string | null = null;

/**
 * Creates or returns cached S3 client for the given profile
 * @param profileName - The AWS profile name to use
 * @param forceNew - Force creation of a new client even if one exists
 */
export function getS3Client(profileName: string, forceNew = false): S3Client {
  // Return cached client if profile hasn't changed
  if (s3Client && currentClientProfile === profileName && !forceNew) {
    return s3Client;
  }

  const profile = getProfile(profileName);
  if (!profile) {
    throw new Error(`Profile '${profileName}' not found`);
  }

  if (!profile.hasCredentials) {
    throw new Error(`Profile '${profileName}' has no valid credentials`);
  }

  const config: S3ClientConfig = {
    region: profile.region || 'us-east-1',
  };

  // Only set credentials if we have direct credentials (not role assumption)
  if (profile.accessKeyId && profile.secretAccessKey) {
    config.credentials = {
      accessKeyId: profile.accessKeyId,
      secretAccessKey: profile.secretAccessKey,
      sessionToken: profile.sessionToken,
    };
  }

  s3Client = new S3Client(config);
  currentClientProfile = profileName;

  return s3Client;
}

/**
 * Clears the cached S3 client (useful when switching profiles)
 */
export function clearS3Client(): void {
  s3Client = null;
  currentClientProfile = null;
}

/**
 * Gets the currently cached profile name
 */
export function getCurrentClientProfile(): string | null {
  return currentClientProfile;
}

/**
 * Lists all S3 buckets accessible by the current profile
 * @param profileName - The AWS profile name to use
 */
export async function listBuckets(profileName: string): Promise<S3Bucket[]> {
  const client = getS3Client(profileName);

  const command = new ListBucketsCommand({});
  const response = await client.send(command);

  const buckets: S3Bucket[] = (response.Buckets || []).map((bucket: Bucket) => ({
    name: bucket.Name || '',
    creationDate: bucket.CreationDate,
  }));

  // Sort buckets alphabetically
  buckets.sort((a, b) => a.name.localeCompare(b.name));

  return buckets;
}

/**
 * Lists objects in an S3 bucket with support for pagination and prefix filtering
 * @param profileName - The AWS profile name to use
 * @param options - List options including bucket, prefix, delimiter, maxKeys, continuationToken
 */
export async function listObjects(
  profileName: string,
  options: ListObjectsOptions
): Promise<ListObjectsResult> {
  const client = getS3Client(profileName);

  const {
    bucket,
    prefix = '',
    delimiter = '/',
    maxKeys = DEFAULT_PAGE_SIZE,
    continuationToken,
  } = options;

  // Validate and cap maxKeys
  const effectiveMaxKeys = Math.min(Math.max(1, maxKeys), MAX_PAGE_SIZE);

  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix || undefined,
    Delimiter: delimiter || undefined,
    MaxKeys: effectiveMaxKeys,
    ContinuationToken: continuationToken || undefined,
  });

  const response: ListObjectsV2CommandOutput = await client.send(command);

  // Process objects (files)
  const objects: S3Object[] = (response.Contents || [])
    .filter((obj: _Object) => {
      // Filter out the prefix itself if it appears as an object
      return obj.Key && obj.Key !== prefix;
    })
    .map((obj: _Object) => ({
      key: obj.Key || '',
      size: obj.Size || 0,
      lastModified: obj.LastModified,
      etag: obj.ETag?.replace(/"/g, ''), // Remove quotes from ETag
      storageClass: obj.StorageClass,
      isPrefix: false,
    }));

  // Process common prefixes (folders)
  const prefixes: S3Object[] = (response.CommonPrefixes || []).map((cp: CommonPrefix) => ({
    key: cp.Prefix || '',
    size: 0,
    isPrefix: true,
  }));

  return {
    objects,
    prefixes,
    continuationToken: response.NextContinuationToken,
    isTruncated: response.IsTruncated || false,
    prefix: prefix,
    keyCount: response.KeyCount || 0,
  };
}

/**
 * Lists all objects in a bucket/prefix, handling pagination automatically
 * Use with caution for large buckets - prefer listObjects with pagination for lazy loading
 * @param profileName - The AWS profile name to use
 * @param options - List options (continuationToken is ignored)
 * @param onProgress - Optional callback for progress updates (receives objects count so far)
 * @param abortSignal - Optional signal to abort the operation
 */
export async function listAllObjects(
  profileName: string,
  options: Omit<ListObjectsOptions, 'continuationToken'>,
  onProgress?: (count: number) => void,
  abortSignal?: AbortSignal
): Promise<ListObjectsResult> {
  const allObjects: S3Object[] = [];
  const allPrefixes: S3Object[] = [];
  let continuationToken: string | undefined;
  let totalKeyCount = 0;

  do {
    // Check for abort
    if (abortSignal?.aborted) {
      throw new Error('Operation aborted');
    }

    const result = await listObjects(profileName, {
      ...options,
      maxKeys: MAX_PAGE_SIZE, // Use max page size for efficiency
      continuationToken,
    });

    allObjects.push(...result.objects);
    allPrefixes.push(...result.prefixes);
    totalKeyCount += result.keyCount;
    continuationToken = result.continuationToken;

    // Report progress
    onProgress?.(allObjects.length);
  } while (continuationToken);

  return {
    objects: allObjects,
    prefixes: allPrefixes,
    continuationToken: undefined,
    isTruncated: false,
    prefix: options.prefix || '',
    keyCount: totalKeyCount,
  };
}

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

/**
 * Gets the parent prefix for a given key or prefix
 * @param keyOrPrefix - The key or prefix to get the parent of
 * @returns The parent prefix, or empty string if at root
 */
export function getParentPrefix(keyOrPrefix: string): string {
  // Remove trailing slash if present
  const normalized = keyOrPrefix.endsWith('/') ? keyOrPrefix.slice(0, -1) : keyOrPrefix;

  const lastSlashIndex = normalized.lastIndexOf('/');
  if (lastSlashIndex === -1) {
    return '';
  }

  return normalized.substring(0, lastSlashIndex + 1);
}

/**
 * Extracts the name (last segment) from a key or prefix
 * @param keyOrPrefix - The key or prefix to extract the name from
 */
export function getKeyName(keyOrPrefix: string): string {
  // Remove trailing slash if present for prefixes
  const normalized = keyOrPrefix.endsWith('/') ? keyOrPrefix.slice(0, -1) : keyOrPrefix;

  const lastSlashIndex = normalized.lastIndexOf('/');
  if (lastSlashIndex === -1) {
    return normalized;
  }

  return normalized.substring(lastSlashIndex + 1);
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface DownloadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface FileOperationResult {
  success: boolean;
  error?: string;
}

/**
 * Downloads a file from S3 to local filesystem
 * @param profileName - The AWS profile name to use
 * @param bucket - The S3 bucket name
 * @param key - The S3 object key
 * @param destinationPath - Local path to save the file
 * @param onProgress - Optional callback for download progress
 * @param abortSignal - Optional signal to abort the operation
 */
export async function downloadFile(
  profileName: string,
  bucket: string,
  key: string,
  destinationPath: string,
  onProgress?: (progress: DownloadProgress) => void,
  abortSignal?: AbortSignal
): Promise<FileOperationResult> {
  const client = getS3Client(profileName);

  try {
    // First, get the object metadata to know the total size
    const headCommand = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    const headResponse = await client.send(headCommand);
    const totalSize = headResponse.ContentLength || 0;

    // Download the object
    const getCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await client.send(getCommand, {
      abortSignal,
    });

    if (!response.Body) {
      throw new Error('Empty response body');
    }

    // Ensure the destination directory exists
    const destDir = path.dirname(destinationPath);
    await fs.promises.mkdir(destDir, { recursive: true });

    // Create write stream
    const writeStream = fs.createWriteStream(destinationPath);

    // Track progress
    let loaded = 0;
    const bodyStream = response.Body as Readable;

    bodyStream.on('data', (chunk: Buffer) => {
      loaded += chunk.length;
      if (onProgress && totalSize > 0) {
        onProgress({
          loaded,
          total: totalSize,
          percentage: Math.round((loaded / totalSize) * 100),
        });
      }
    });

    // Use pipeline to properly handle streams
    await pipeline(bodyStream, writeStream);

    return { success: true };
  } catch (error) {
    // Clean up partial file on error
    try {
      await fs.promises.unlink(destinationPath);
    } catch {
      // Ignore cleanup errors
    }

    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, error: message };
  }
}

/**
 * Uploads a file from local filesystem to S3
 * @param profileName - The AWS profile name to use
 * @param bucket - The S3 bucket name
 * @param key - The S3 object key
 * @param sourcePath - Local path of the file to upload
 * @param onProgress - Optional callback for upload progress
 * @param abortSignal - Optional signal to abort the operation
 */
export async function uploadFile(
  profileName: string,
  bucket: string,
  key: string,
  sourcePath: string,
  onProgress?: (progress: UploadProgress) => void,
  abortSignal?: AbortSignal
): Promise<FileOperationResult> {
  const client = getS3Client(profileName);

  try {
    // Check if the source file exists
    const stats = await fs.promises.stat(sourcePath);
    const totalSize = stats.size;

    // Read file content
    const fileContent = await fs.promises.readFile(sourcePath);

    // Determine content type based on extension
    const contentType = getContentType(key);

    // Simple upload for files
    const putCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileContent,
      ContentType: contentType,
    });

    await client.send(putCommand, {
      abortSignal,
    });

    // Report 100% progress
    if (onProgress) {
      onProgress({
        loaded: totalSize,
        total: totalSize,
        percentage: 100,
      });
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, error: message };
  }
}

/**
 * Uploads content directly to S3 (for editor save)
 * @param profileName - The AWS profile name to use
 * @param bucket - The S3 bucket name
 * @param key - The S3 object key
 * @param content - The content to upload
 */
export async function uploadContent(
  profileName: string,
  bucket: string,
  key: string,
  content: string | Buffer
): Promise<FileOperationResult> {
  const client = getS3Client(profileName);

  try {
    const contentType = getContentType(key);

    const putCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: typeof content === 'string' ? Buffer.from(content, 'utf-8') : content,
      ContentType: contentType,
    });

    await client.send(putCommand);

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, error: message };
  }
}

/**
 * Downloads file content directly (for editor load)
 * @param profileName - The AWS profile name to use
 * @param bucket - The S3 bucket name
 * @param key - The S3 object key
 */
export async function downloadContent(
  profileName: string,
  bucket: string,
  key: string
): Promise<{ success: boolean; content?: string; error?: string }> {
  const client = getS3Client(profileName);

  try {
    const getCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await client.send(getCommand);

    if (!response.Body) {
      throw new Error('Empty response body');
    }

    // Convert stream to string
    const chunks: Buffer[] = [];
    const bodyStream = response.Body as Readable;

    for await (const chunk of bodyStream) {
      chunks.push(Buffer.from(chunk));
    }

    const content = Buffer.concat(chunks).toString('utf-8');

    return { success: true, content };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, error: message };
  }
}

/**
 * Deletes a file from S3
 * @param profileName - The AWS profile name to use
 * @param bucket - The S3 bucket name
 * @param key - The S3 object key
 */
export async function deleteFile(
  profileName: string,
  bucket: string,
  key: string
): Promise<FileOperationResult> {
  const client = getS3Client(profileName);

  try {
    const deleteCommand = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await client.send(deleteCommand);

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, error: message };
  }
}

/**
 * Renames (copies then deletes) a file in S3
 * @param profileName - The AWS profile name to use
 * @param bucket - The S3 bucket name
 * @param sourceKey - The current S3 object key
 * @param destinationKey - The new S3 object key
 */
export async function renameFile(
  profileName: string,
  bucket: string,
  sourceKey: string,
  destinationKey: string
): Promise<FileOperationResult> {
  const client = getS3Client(profileName);

  try {
    // Copy to new location
    const copyCommand = new CopyObjectCommand({
      Bucket: bucket,
      Key: destinationKey,
      CopySource: encodeURIComponent(`${bucket}/${sourceKey}`),
    });

    await client.send(copyCommand);

    // Delete original
    const deleteCommand = new DeleteObjectCommand({
      Bucket: bucket,
      Key: sourceKey,
    });

    await client.send(deleteCommand);

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, error: message };
  }
}

/**
 * Copies a file within S3
 * @param profileName - The AWS profile name to use
 * @param sourceBucket - The source S3 bucket name
 * @param sourceKey - The source S3 object key
 * @param destinationBucket - The destination S3 bucket name
 * @param destinationKey - The destination S3 object key
 */
export async function copyFile(
  profileName: string,
  sourceBucket: string,
  sourceKey: string,
  destinationBucket: string,
  destinationKey: string
): Promise<FileOperationResult> {
  const client = getS3Client(profileName);

  try {
    const copyCommand = new CopyObjectCommand({
      Bucket: destinationBucket,
      Key: destinationKey,
      CopySource: encodeURIComponent(`${sourceBucket}/${sourceKey}`),
    });

    await client.send(copyCommand);

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, error: message };
  }
}

/**
 * Gets the content type based on file extension
 */
function getContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  const contentTypes: Record<string, string> = {
    // Text
    txt: 'text/plain',
    html: 'text/html',
    css: 'text/css',
    csv: 'text/csv',
    // Code
    js: 'application/javascript',
    json: 'application/json',
    xml: 'application/xml',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    ts: 'text/typescript',
    tsx: 'text/typescript',
    py: 'text/x-python',
    java: 'text/x-java',
    md: 'text/markdown',
    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    // Binary
    pdf: 'application/pdf',
    zip: 'application/zip',
    gz: 'application/gzip',
    tar: 'application/x-tar',
    parquet: 'application/x-parquet',
  };

  return contentTypes[ext] || 'application/octet-stream';
}

/**
 * Gets the file size from S3 without downloading
 */
export async function getFileSize(
  profileName: string,
  bucket: string,
  key: string
): Promise<{ success: boolean; size?: number; error?: string }> {
  const client = getS3Client(profileName);

  try {
    const headCommand = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await client.send(headCommand);

    return { success: true, size: response.ContentLength || 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, error: message };
  }
}
