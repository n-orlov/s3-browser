/**
 * Integration Tests for S3 Service with Mocked AWS SDK
 *
 * These tests use aws-sdk-client-mock to deeply mock the S3 backend.
 * They test all S3 operations without requiring real AWS credentials.
 *
 * Test Coverage:
 * - Bucket listing
 * - Object listing with pagination
 * - File operations (upload, download, delete, rename)
 * - Error handling scenarios
 * - Edge cases and boundary conditions
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { Readable } from 'stream';
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  GetObjectTaggingCommand,
  NoSuchKey,
  NoSuchBucket,
} from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';

// Mock the awsCredentials module
vi.mock('../main/services/awsCredentials', () => ({
  getProfile: vi.fn((name: string) => {
    if (name === 'test-profile' || name === 'mock-profile') {
      return {
        name,
        hasCredentials: true,
        profileType: 'static',
        region: 'us-east-1',
        accessKeyId: 'MOCK_ACCESS_KEY',
        secretAccessKey: 'MOCK_SECRET_KEY',
      };
    }
    if (name === 'invalid-profile') {
      return {
        name,
        hasCredentials: false,
        profileType: 'static',
      };
    }
    return undefined;
  }),
  loadAwsProfiles: vi.fn(() => ({
    profiles: [
      { name: 'test-profile', hasCredentials: true, profileType: 'static' },
      { name: 'mock-profile', hasCredentials: true, profileType: 'static' },
    ],
    defaultRegion: 'us-east-1',
  })),
}));

// Import after mocking
import {
  listBuckets,
  listObjects,
  listAllObjects,
  downloadContent,
  downloadBinaryContent,
  uploadContent,
  deleteFile,
  deleteFiles,
  deletePrefix,
  renameFile,
  copyFile,
  getFileSize,
  getObjectMetadata,
  createEmptyFile,
  createFolder,
  clearS3Client,
  getS3Client,
  parseS3Url,
  getParentPrefix,
  getKeyName,
} from '../main/services/s3Service';

// Create the mock
const s3Mock = mockClient(S3Client);

// Helper to create a mock Readable stream from string/buffer
function createMockStream(content: string | Buffer): Readable {
  const stream = new Readable();
  stream.push(content);
  stream.push(null);
  return sdkStreamMixin(stream);
}

describe('S3 Service Mock Integration Tests', () => {
  beforeEach(() => {
    // Reset mocks before each test
    s3Mock.reset();
    clearS3Client();
  });

  afterEach(() => {
    s3Mock.reset();
    clearS3Client();
  });

  describe('Bucket Listing', () => {
    it('should list all buckets', async () => {
      s3Mock.on(ListBucketsCommand).resolves({
        Buckets: [
          { Name: 'bucket-a', CreationDate: new Date('2024-01-01') },
          { Name: 'bucket-b', CreationDate: new Date('2024-02-01') },
          { Name: 'bucket-c', CreationDate: new Date('2024-03-01') },
        ],
      });

      const buckets = await listBuckets('test-profile');

      expect(buckets).toHaveLength(3);
      expect(buckets[0].name).toBe('bucket-a');
      expect(buckets[1].name).toBe('bucket-b');
      expect(buckets[2].name).toBe('bucket-c');
    });

    it('should handle empty bucket list', async () => {
      s3Mock.on(ListBucketsCommand).resolves({
        Buckets: [],
      });

      const buckets = await listBuckets('test-profile');

      expect(buckets).toHaveLength(0);
    });

    it('should sort buckets alphabetically', async () => {
      s3Mock.on(ListBucketsCommand).resolves({
        Buckets: [
          { Name: 'zebra-bucket' },
          { Name: 'alpha-bucket' },
          { Name: 'mega-bucket' },
        ],
      });

      const buckets = await listBuckets('test-profile');

      expect(buckets[0].name).toBe('alpha-bucket');
      expect(buckets[1].name).toBe('mega-bucket');
      expect(buckets[2].name).toBe('zebra-bucket');
    });

    it('should handle access denied error', async () => {
      s3Mock.on(ListBucketsCommand).rejects({
        name: 'AccessDenied',
        message: 'Access Denied',
      });

      await expect(listBuckets('test-profile')).rejects.toThrow('Access Denied');
    });
  });

  describe('Object Listing', () => {
    it('should list objects in a bucket', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'file1.txt', Size: 100, LastModified: new Date() },
          { Key: 'file2.json', Size: 200, LastModified: new Date() },
        ],
        CommonPrefixes: [
          { Prefix: 'folder1/' },
          { Prefix: 'folder2/' },
        ],
        IsTruncated: false,
        KeyCount: 4,
      });

      const result = await listObjects('test-profile', { bucket: 'test-bucket' });

      expect(result.objects).toHaveLength(2);
      expect(result.prefixes).toHaveLength(2);
      expect(result.objects[0].key).toBe('file1.txt');
      expect(result.objects[0].isPrefix).toBe(false);
      expect(result.prefixes[0].key).toBe('folder1/');
      expect(result.prefixes[0].isPrefix).toBe(true);
    });

    it('should handle pagination correctly', async () => {
      // First page
      s3Mock.on(ListObjectsV2Command, { ContinuationToken: undefined }).resolves({
        Contents: [
          { Key: 'file1.txt', Size: 100 },
          { Key: 'file2.txt', Size: 200 },
        ],
        CommonPrefixes: [],
        IsTruncated: true,
        NextContinuationToken: 'token-page-2',
        KeyCount: 2,
      });

      // Second page
      s3Mock.on(ListObjectsV2Command, { ContinuationToken: 'token-page-2' }).resolves({
        Contents: [
          { Key: 'file3.txt', Size: 300 },
          { Key: 'file4.txt', Size: 400 },
        ],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 2,
      });

      // Get first page
      const page1 = await listObjects('test-profile', { bucket: 'test-bucket' });
      expect(page1.objects).toHaveLength(2);
      expect(page1.isTruncated).toBe(true);
      expect(page1.continuationToken).toBe('token-page-2');

      // Get second page
      const page2 = await listObjects('test-profile', {
        bucket: 'test-bucket',
        continuationToken: 'token-page-2',
      });
      expect(page2.objects).toHaveLength(2);
      expect(page2.isTruncated).toBe(false);
    });

    it('should list objects with prefix filter', async () => {
      s3Mock.on(ListObjectsV2Command, { Prefix: 'data/' }).resolves({
        Contents: [
          { Key: 'data/file1.csv', Size: 1000 },
          { Key: 'data/file2.csv', Size: 2000 },
        ],
        CommonPrefixes: [
          { Prefix: 'data/subfolder/' },
        ],
        IsTruncated: false,
        KeyCount: 3,
      });

      const result = await listObjects('test-profile', {
        bucket: 'test-bucket',
        prefix: 'data/',
      });

      expect(result.objects).toHaveLength(2);
      expect(result.prefixes).toHaveLength(1);
      expect(result.objects[0].key).toBe('data/file1.csv');
    });

    it('should respect maxKeys parameter', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'file1.txt', Size: 100 },
        ],
        CommonPrefixes: [],
        IsTruncated: true,
        NextContinuationToken: 'next-token',
        KeyCount: 1,
      });

      const result = await listObjects('test-profile', {
        bucket: 'test-bucket',
        maxKeys: 1,
      });

      expect(result.objects).toHaveLength(1);
      expect(result.isTruncated).toBe(true);
    });

    it('should handle empty bucket', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 0,
      });

      const result = await listObjects('test-profile', { bucket: 'empty-bucket' });

      expect(result.objects).toHaveLength(0);
      expect(result.prefixes).toHaveLength(0);
    });

    it('should filter out the prefix itself from objects', async () => {
      s3Mock.on(ListObjectsV2Command, { Prefix: 'folder/' }).resolves({
        Contents: [
          { Key: 'folder/', Size: 0 }, // The prefix itself
          { Key: 'folder/file1.txt', Size: 100 },
        ],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 2,
      });

      const result = await listObjects('test-profile', {
        bucket: 'test-bucket',
        prefix: 'folder/',
      });

      expect(result.objects).toHaveLength(1);
      expect(result.objects[0].key).toBe('folder/file1.txt');
    });
  });

  describe('List All Objects', () => {
    it('should list all objects across multiple pages', async () => {
      let callCount = 0;
      s3Mock.on(ListObjectsV2Command).callsFake(() => {
        callCount++;
        if (callCount === 1) {
          return {
            Contents: [{ Key: 'file1.txt', Size: 100 }],
            IsTruncated: true,
            NextContinuationToken: 'token-2',
            KeyCount: 1,
          };
        } else if (callCount === 2) {
          return {
            Contents: [{ Key: 'file2.txt', Size: 200 }],
            IsTruncated: true,
            NextContinuationToken: 'token-3',
            KeyCount: 1,
          };
        } else {
          return {
            Contents: [{ Key: 'file3.txt', Size: 300 }],
            IsTruncated: false,
            KeyCount: 1,
          };
        }
      });

      const progressCounts: number[] = [];
      const result = await listAllObjects(
        'test-profile',
        { bucket: 'test-bucket' },
        (count) => progressCounts.push(count)
      );

      expect(result.objects).toHaveLength(3);
      expect(progressCounts).toContain(1);
      expect(progressCounts).toContain(2);
      expect(progressCounts).toContain(3);
    });

    it('should abort when signal is triggered', async () => {
      const controller = new AbortController();

      s3Mock.on(ListObjectsV2Command).callsFake(() => {
        // Abort after first call
        controller.abort();
        return {
          Contents: [{ Key: 'file1.txt', Size: 100 }],
          IsTruncated: true,
          NextContinuationToken: 'next-token',
          KeyCount: 1,
        };
      });

      await expect(
        listAllObjects(
          'test-profile',
          { bucket: 'test-bucket' },
          undefined,
          controller.signal
        )
      ).rejects.toThrow('Operation aborted');
    });
  });

  describe('Download Operations', () => {
    it('should download text content successfully', async () => {
      const content = 'Hello, World! This is test content.';
      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(content),
      });

      const result = await downloadContent('test-profile', 'test-bucket', 'test.txt');

      expect(result.success).toBe(true);
      expect(result.content).toBe(content);
    });

    it('should download binary content successfully', async () => {
      const binaryData = Buffer.from([0x50, 0x41, 0x52, 0x31]); // PAR1 magic bytes
      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(binaryData),
      });

      const result = await downloadBinaryContent('test-profile', 'test-bucket', 'data.parquet');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.length).toBe(4);
      expect(result.data?.[0]).toBe(0x50);
    });

    it('should handle empty response body', async () => {
      s3Mock.on(GetObjectCommand).resolves({
        Body: undefined,
      });

      const result = await downloadContent('test-profile', 'test-bucket', 'test.txt');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Empty response body');
    });

    it('should handle file not found error', async () => {
      s3Mock.on(GetObjectCommand).rejects(
        new NoSuchKey({ message: 'The specified key does not exist.', $metadata: {} })
      );

      const result = await downloadContent('test-profile', 'test-bucket', 'nonexistent.txt');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle bucket not found error', async () => {
      s3Mock.on(GetObjectCommand).rejects(
        new NoSuchBucket({ message: 'The specified bucket does not exist.', $metadata: {} })
      );

      const result = await downloadContent('test-profile', 'nonexistent-bucket', 'test.txt');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Upload Operations', () => {
    it('should upload text content successfully', async () => {
      s3Mock.on(PutObjectCommand).resolves({});

      const result = await uploadContent(
        'test-profile',
        'test-bucket',
        'upload.txt',
        'Test content to upload'
      );

      expect(result.success).toBe(true);
    });

    it('should upload buffer content successfully', async () => {
      s3Mock.on(PutObjectCommand).resolves({});

      const buffer = Buffer.from('Binary content');
      const result = await uploadContent('test-profile', 'test-bucket', 'upload.bin', buffer);

      expect(result.success).toBe(true);
    });

    it('should handle upload error', async () => {
      s3Mock.on(PutObjectCommand).rejects({
        name: 'AccessDenied',
        message: 'Access Denied',
      });

      const result = await uploadContent('test-profile', 'test-bucket', 'upload.txt', 'content');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Access Denied');
    });

    it('should create empty file', async () => {
      s3Mock.on(PutObjectCommand).resolves({});

      const result = await createEmptyFile('test-profile', 'test-bucket', 'new-file.txt');

      expect(result.success).toBe(true);
    });

    it('should create folder', async () => {
      s3Mock.on(PutObjectCommand).resolves({});

      const result = await createFolder('test-profile', 'test-bucket', 'new-folder');

      expect(result.success).toBe(true);
    });

    it('should ensure folder ends with slash', async () => {
      let capturedKey: string | undefined;
      s3Mock.on(PutObjectCommand).callsFake((input) => {
        capturedKey = input.Key;
        return {};
      });

      await createFolder('test-profile', 'test-bucket', 'folder-without-slash');

      expect(capturedKey).toBe('folder-without-slash/');
    });
  });

  describe('Delete Operations', () => {
    it('should delete file successfully', async () => {
      s3Mock.on(DeleteObjectCommand).resolves({});

      const result = await deleteFile('test-profile', 'test-bucket', 'file-to-delete.txt');

      expect(result.success).toBe(true);
    });

    it('should handle delete error', async () => {
      s3Mock.on(DeleteObjectCommand).rejects({
        name: 'AccessDenied',
        message: 'Access Denied',
      });

      const result = await deleteFile('test-profile', 'test-bucket', 'protected-file.txt');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Access Denied');
    });

    it('should delete multiple files', async () => {
      s3Mock.on(DeleteObjectCommand).resolves({});

      const result = await deleteFiles('test-profile', 'test-bucket', [
        'file1.txt',
        'file2.txt',
        'file3.txt',
      ]);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);
      expect(result.failedCount).toBe(0);
    });

    it('should report partial failure in batch delete', async () => {
      let callCount = 0;
      s3Mock.on(DeleteObjectCommand).callsFake(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Failed to delete');
        }
        return {};
      });

      const result = await deleteFiles('test-profile', 'test-bucket', [
        'file1.txt',
        'file2.txt',
        'file3.txt',
      ]);

      expect(result.success).toBe(false);
      expect(result.deletedCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.results[1].success).toBe(false);
    });
  });

  describe('Delete Prefix Operations', () => {
    it('should delete a prefix with multiple nested objects', async () => {
      // listObjects returns nested objects
      s3Mock.on(ListObjectsV2Command, { Prefix: 'folder/' }).resolves({
        Contents: [
          { Key: 'folder/file1.txt', Size: 100 },
          { Key: 'folder/file2.txt', Size: 200 },
          { Key: 'folder/subfolder/file3.txt', Size: 300 },
        ],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 3,
      });
      // All deletes succeed
      s3Mock.on(DeleteObjectCommand).resolves({});

      const result = await deletePrefix('test-profile', 'test-bucket', 'folder/');

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);
      expect(result.failedCount).toBe(0);
    });

    it('should delete an empty prefix (just the marker)', async () => {
      // listObjects returns empty
      s3Mock.on(ListObjectsV2Command, { Prefix: 'empty-folder/' }).resolves({
        Contents: [],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 0,
      });
      // Delete of prefix marker succeeds
      s3Mock.on(DeleteObjectCommand).resolves({});

      const result = await deletePrefix('test-profile', 'test-bucket', 'empty-folder/');

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(1);
      expect(result.failedCount).toBe(0);
    });

    it('should handle partial failure when deleting objects', async () => {
      // listObjects returns two objects
      s3Mock.on(ListObjectsV2Command, { Prefix: 'folder/' }).resolves({
        Contents: [
          { Key: 'folder/file1.txt', Size: 100 },
          { Key: 'folder/file2.txt', Size: 200 },
        ],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 2,
      });

      // First delete succeeds, second fails
      let deleteCount = 0;
      s3Mock.on(DeleteObjectCommand).callsFake((input) => {
        deleteCount++;
        if (input.Key === 'folder/file2.txt') {
          throw new Error('Access denied');
        }
        return {};
      });

      const result = await deletePrefix('test-profile', 'test-bucket', 'folder/');

      expect(result.success).toBe(false);
      expect(result.deletedCount).toBe(1);
      expect(result.failedCount).toBe(1);
    });

    it('should handle abort signal before listing objects', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await deletePrefix(
        'test-profile',
        'test-bucket',
        'folder/',
        undefined,
        controller.signal
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Operation aborted');
      expect(result.deletedCount).toBe(0);
      expect(result.failedCount).toBe(0);
    });

    it('should handle abort signal during object deletion', async () => {
      // listObjects returns objects
      s3Mock.on(ListObjectsV2Command, { Prefix: 'folder/' }).resolves({
        Contents: [
          { Key: 'folder/file1.txt', Size: 100 },
          { Key: 'folder/file2.txt', Size: 200 },
          { Key: 'folder/file3.txt', Size: 300 },
        ],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 3,
      });

      const controller = new AbortController();
      let deleteCount = 0;

      // Abort after first deletion
      s3Mock.on(DeleteObjectCommand).callsFake(() => {
        deleteCount++;
        if (deleteCount === 1) {
          controller.abort();
        }
        return {};
      });

      const result = await deletePrefix(
        'test-profile',
        'test-bucket',
        'folder/',
        undefined,
        controller.signal
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Operation aborted');
      expect(result.deletedCount).toBeGreaterThanOrEqual(1);
    });

    it('should call progress callback during deletion', async () => {
      // listObjects returns objects
      s3Mock.on(ListObjectsV2Command, { Prefix: 'folder/' }).resolves({
        Contents: [
          { Key: 'folder/file1.txt', Size: 100 },
          { Key: 'folder/file2.txt', Size: 200 },
        ],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 2,
      });
      s3Mock.on(DeleteObjectCommand).resolves({});

      const progressCalls: Array<{ deleted: number; total: number }> = [];
      await deletePrefix('test-profile', 'test-bucket', 'folder/', (deleted, total) => {
        progressCalls.push({ deleted, total });
      });

      expect(progressCalls).toHaveLength(2);
      expect(progressCalls[0]).toEqual({ deleted: 1, total: 2 });
      expect(progressCalls[1]).toEqual({ deleted: 2, total: 2 });
    });

    it('should handle pagination when listing objects', async () => {
      let listCallCount = 0;
      s3Mock.on(ListObjectsV2Command, { Prefix: 'folder/' }).callsFake(() => {
        listCallCount++;
        if (listCallCount === 1) {
          return {
            Contents: [{ Key: 'folder/file1.txt', Size: 100 }],
            CommonPrefixes: [],
            IsTruncated: true,
            NextContinuationToken: 'page2token',
            KeyCount: 1,
          };
        } else {
          return {
            Contents: [{ Key: 'folder/file2.txt', Size: 200 }],
            CommonPrefixes: [],
            IsTruncated: false,
            KeyCount: 1,
          };
        }
      });
      s3Mock.on(DeleteObjectCommand).resolves({});

      const result = await deletePrefix('test-profile', 'test-bucket', 'folder/');

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
      expect(result.failedCount).toBe(0);
    });

    it('should include common prefixes (subfolders) in deletion', async () => {
      // listObjects returns objects and common prefixes
      s3Mock.on(ListObjectsV2Command, { Prefix: 'folder/' }).resolves({
        Contents: [{ Key: 'folder/file1.txt', Size: 100 }],
        CommonPrefixes: [{ Prefix: 'folder/subfolder/' }],
        IsTruncated: false,
        KeyCount: 1,
      });
      s3Mock.on(DeleteObjectCommand).resolves({});

      const result = await deletePrefix('test-profile', 'test-bucket', 'folder/');

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2); // file + subfolder prefix
      expect(result.failedCount).toBe(0);
    });

    it('should handle error when deleting empty prefix marker fails', async () => {
      // listObjects returns empty
      s3Mock.on(ListObjectsV2Command, { Prefix: 'empty-folder/' }).resolves({
        Contents: [],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 0,
      });
      // Delete of prefix marker fails
      s3Mock.on(DeleteObjectCommand).rejects(new Error('Access denied'));

      const result = await deletePrefix('test-profile', 'test-bucket', 'empty-folder/');

      expect(result.success).toBe(false);
      expect(result.deletedCount).toBe(0);
      expect(result.failedCount).toBe(1);
    });

    it('should handle unexpected error during listing', async () => {
      s3Mock.on(ListObjectsV2Command, { Prefix: 'folder/' }).rejects(new Error('Network error'));

      const result = await deletePrefix('test-profile', 'test-bucket', 'folder/');

      expect(result.success).toBe(false);
      expect(result.deletedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.error).toBe('Network error');
    });

    it('should handle deeply nested folder structure', async () => {
      s3Mock.on(ListObjectsV2Command, { Prefix: 'a/' }).resolves({
        Contents: [
          { Key: 'a/b/c/d/file1.txt', Size: 100 },
          { Key: 'a/b/c/file2.txt', Size: 200 },
          { Key: 'a/b/file3.txt', Size: 300 },
          { Key: 'a/file4.txt', Size: 400 },
        ],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 4,
      });
      s3Mock.on(DeleteObjectCommand).resolves({});

      const result = await deletePrefix('test-profile', 'test-bucket', 'a/');

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(4);
      expect(result.failedCount).toBe(0);
    });

    it('should use empty delimiter to list all nested objects recursively', async () => {
      // Track the delimiter used in ListObjectsV2Command
      let capturedDelimiter: string | undefined = 'NOT_SET';
      s3Mock.on(ListObjectsV2Command).callsFake((input) => {
        capturedDelimiter = input.Delimiter;
        return {
          Contents: [
            { Key: 'folder/level1/level2/level3/deep-file.txt', Size: 100 },
            { Key: 'folder/level1/level2/mid-file.txt', Size: 200 },
            { Key: 'folder/level1/shallow-file.txt', Size: 300 },
          ],
          CommonPrefixes: [],
          IsTruncated: false,
          KeyCount: 3,
        };
      });
      s3Mock.on(DeleteObjectCommand).resolves({});

      const result = await deletePrefix('test-profile', 'test-bucket', 'folder/');

      // Verify that no delimiter was used (undefined means no grouping by prefix, returns all nested objects)
      // The listObjects function converts empty string to undefined via `delimiter || undefined`
      expect(capturedDelimiter).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);
    });

    it('should delete all objects across multiple pages when deeply nested', async () => {
      // Simulate pagination with deeply nested objects
      let listCallCount = 0;
      s3Mock.on(ListObjectsV2Command).callsFake((input) => {
        listCallCount++;
        // Verify delimiter is undefined for recursive listing (empty string is converted to undefined)
        expect(input.Delimiter).toBeUndefined();

        if (listCallCount === 1) {
          return {
            Contents: [
              { Key: 'parent/child1/grandchild1/file1.txt', Size: 100 },
              { Key: 'parent/child1/grandchild1/file2.txt', Size: 200 },
            ],
            CommonPrefixes: [],
            IsTruncated: true,
            NextContinuationToken: 'page2',
            KeyCount: 2,
          };
        } else if (listCallCount === 2) {
          return {
            Contents: [
              { Key: 'parent/child1/grandchild2/file3.txt', Size: 300 },
              { Key: 'parent/child2/file4.txt', Size: 400 },
            ],
            CommonPrefixes: [],
            IsTruncated: true,
            NextContinuationToken: 'page3',
            KeyCount: 2,
          };
        } else {
          return {
            Contents: [
              { Key: 'parent/child2/grandchild3/file5.txt', Size: 500 },
              { Key: 'parent/file6.txt', Size: 600 },
            ],
            CommonPrefixes: [],
            IsTruncated: false,
            KeyCount: 2,
          };
        }
      });

      const deletedKeys: string[] = [];
      s3Mock.on(DeleteObjectCommand).callsFake((input) => {
        deletedKeys.push(input.Key as string);
        return {};
      });

      const result = await deletePrefix('test-profile', 'test-bucket', 'parent/');

      expect(listCallCount).toBe(3); // Should have paginated through 3 pages
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(6);
      expect(result.failedCount).toBe(0);

      // Verify all nested files were deleted
      expect(deletedKeys).toContain('parent/child1/grandchild1/file1.txt');
      expect(deletedKeys).toContain('parent/child1/grandchild1/file2.txt');
      expect(deletedKeys).toContain('parent/child1/grandchild2/file3.txt');
      expect(deletedKeys).toContain('parent/child2/file4.txt');
      expect(deletedKeys).toContain('parent/child2/grandchild3/file5.txt');
      expect(deletedKeys).toContain('parent/file6.txt');
    });

    it('should continue deletion after individual file failures', async () => {
      s3Mock.on(ListObjectsV2Command, { Prefix: 'folder/' }).resolves({
        Contents: [
          { Key: 'folder/file1.txt', Size: 100 },
          { Key: 'folder/file2.txt', Size: 200 },
          { Key: 'folder/file3.txt', Size: 300 },
        ],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 3,
      });

      let deleteCount = 0;
      s3Mock.on(DeleteObjectCommand).callsFake((input) => {
        deleteCount++;
        // Fail on second file only
        if (input.Key === 'folder/file2.txt') {
          throw new Error('Failed');
        }
        return {};
      });

      const result = await deletePrefix('test-profile', 'test-bucket', 'folder/');

      // Should have attempted all 3 files plus the prefix marker
      expect(result.deletedCount).toBe(2); // file1 and file3 succeed
      expect(result.failedCount).toBe(1); // file2 fails
      expect(result.success).toBe(false);
    });
  });

  describe('Rename and Copy Operations', () => {
    it('should rename file successfully', async () => {
      s3Mock.on(CopyObjectCommand).resolves({});
      s3Mock.on(DeleteObjectCommand).resolves({});

      const result = await renameFile(
        'test-profile',
        'test-bucket',
        'old-name.txt',
        'new-name.txt'
      );

      expect(result.success).toBe(true);
    });

    it('should handle rename failure on copy', async () => {
      s3Mock.on(CopyObjectCommand).rejects({
        name: 'AccessDenied',
        message: 'Access Denied',
      });

      const result = await renameFile(
        'test-profile',
        'test-bucket',
        'old-name.txt',
        'new-name.txt'
      );

      expect(result.success).toBe(false);
    });

    it('should copy file successfully', async () => {
      s3Mock.on(CopyObjectCommand).resolves({});

      const result = await copyFile(
        'test-profile',
        'source-bucket',
        'source.txt',
        'dest-bucket',
        'dest.txt'
      );

      expect(result.success).toBe(true);
    });
  });

  describe('File Size and Metadata Operations', () => {
    it('should get file size successfully', async () => {
      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: 12345,
      });

      const result = await getFileSize('test-profile', 'test-bucket', 'test.txt');

      expect(result.success).toBe(true);
      expect(result.size).toBe(12345);
    });

    it('should handle file size error for non-existent file', async () => {
      s3Mock.on(HeadObjectCommand).rejects(
        new NoSuchKey({ message: 'The specified key does not exist.', $metadata: {} })
      );

      const result = await getFileSize('test-profile', 'test-bucket', 'nonexistent.txt');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should get object metadata with tags', async () => {
      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: 5000,
        ContentType: 'application/json',
        LastModified: new Date('2024-06-15'),
        ETag: '"abc123"',
        StorageClass: 'STANDARD',
        ServerSideEncryption: 'AES256',
        Metadata: {
          'custom-key': 'custom-value',
        },
      });

      s3Mock.on(GetObjectTaggingCommand).resolves({
        TagSet: [
          { Key: 'Environment', Value: 'Production' },
          { Key: 'Owner', Value: 'TeamA' },
        ],
      });

      const result = await getObjectMetadata('test-profile', 'test-bucket', 'data.json');

      expect(result.success).toBe(true);
      expect(result.metadata?.contentLength).toBe(5000);
      expect(result.metadata?.contentType).toBe('application/json');
      expect(result.metadata?.storageClass).toBe('STANDARD');
      expect(result.metadata?.tags['Environment']).toBe('Production');
      expect(result.metadata?.customMetadata['custom-key']).toBe('custom-value');
      expect(result.metadata?.s3Url).toBe('s3://test-bucket/data.json');
    });

    it('should handle metadata without tags access', async () => {
      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: 1000,
      });

      s3Mock.on(GetObjectTaggingCommand).rejects({
        name: 'AccessDenied',
        message: 'Access Denied',
      });

      const result = await getObjectMetadata('test-profile', 'test-bucket', 'file.txt');

      expect(result.success).toBe(true);
      expect(result.metadata?.contentLength).toBe(1000);
      expect(result.metadata?.tags).toEqual({});
    });
  });

  describe('URL Parsing Utilities', () => {
    it('should parse s3:// URLs', () => {
      expect(parseS3Url('s3://my-bucket/path/to/file.txt')).toEqual({
        bucket: 'my-bucket',
        key: 'path/to/file.txt',
      });
    });

    it('should parse s3:// URLs without key', () => {
      expect(parseS3Url('s3://my-bucket/')).toEqual({
        bucket: 'my-bucket',
        key: '',
      });

      expect(parseS3Url('s3://my-bucket')).toEqual({
        bucket: 'my-bucket',
        key: '',
      });
    });

    it('should parse virtual-hosted HTTPS URLs', () => {
      expect(parseS3Url('https://my-bucket.s3.us-west-2.amazonaws.com/file.txt')).toEqual({
        bucket: 'my-bucket',
        key: 'file.txt',
      });

      expect(parseS3Url('https://my-bucket.s3.amazonaws.com/folder/file.txt')).toEqual({
        bucket: 'my-bucket',
        key: 'folder/file.txt',
      });
    });

    it('should parse path-style HTTPS URLs', () => {
      expect(parseS3Url('https://s3.amazonaws.com/my-bucket/file.txt')).toEqual({
        bucket: 'my-bucket',
        key: 'file.txt',
      });

      expect(parseS3Url('https://s3.eu-west-1.amazonaws.com/my-bucket/folder/file.txt')).toEqual({
        bucket: 'my-bucket',
        key: 'folder/file.txt',
      });
    });

    it('should return null for invalid URLs', () => {
      expect(parseS3Url('https://example.com/file.txt')).toBeNull();
      expect(parseS3Url('ftp://my-bucket/file.txt')).toBeNull();
      expect(parseS3Url('not-a-url')).toBeNull();
      expect(parseS3Url('')).toBeNull();
    });
  });

  describe('Path Utilities', () => {
    it('should get parent prefix', () => {
      expect(getParentPrefix('folder/subfolder/file.txt')).toBe('folder/subfolder/');
      expect(getParentPrefix('folder/subfolder/')).toBe('folder/');
      expect(getParentPrefix('folder/')).toBe('');
      expect(getParentPrefix('file.txt')).toBe('');
    });

    it('should get key name', () => {
      expect(getKeyName('folder/subfolder/file.txt')).toBe('file.txt');
      expect(getKeyName('folder/subfolder/')).toBe('subfolder');
      expect(getKeyName('file.txt')).toBe('file.txt');
      expect(getKeyName('folder/')).toBe('folder');
    });
  });

  describe('Client Management', () => {
    it('should throw error for non-existent profile', () => {
      expect(() => getS3Client('nonexistent-profile')).toThrow("Profile 'nonexistent-profile' not found");
    });

    it('should throw error for profile without credentials', () => {
      expect(() => getS3Client('invalid-profile')).toThrow(
        "Profile 'invalid-profile' has no valid credentials"
      );
    });

    it('should clear and recreate client', () => {
      // First, get a client
      const client1 = getS3Client('test-profile');
      expect(client1).toBeDefined();

      // Clear it
      clearS3Client();

      // Get another client - should be a new instance
      const client2 = getS3Client('test-profile');
      expect(client2).toBeDefined();
    });
  });

  describe('Large File Handling', () => {
    it('should handle large file content (simulated)', async () => {
      // Create a 1MB chunk of data
      const largeContent = 'x'.repeat(1024 * 1024);
      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(largeContent),
      });

      const result = await downloadContent('test-profile', 'test-bucket', 'large-file.txt');

      expect(result.success).toBe(true);
      expect(result.content?.length).toBe(1024 * 1024);
    });

    it('should handle large binary file (simulated)', async () => {
      // Create a 100KB buffer
      const largeBuffer = Buffer.alloc(100 * 1024, 0x42);
      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(largeBuffer),
      });

      const result = await downloadBinaryContent('test-profile', 'test-bucket', 'large.bin');

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(100 * 1024);
    });
  });

  describe('Special Characters in Keys', () => {
    it('should handle keys with special characters', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'folder/file with spaces.txt', Size: 100 },
          { Key: 'folder/file+plus.txt', Size: 200 },
          { Key: 'folder/file%percent.txt', Size: 300 },
        ],
        IsTruncated: false,
        KeyCount: 3,
      });

      const result = await listObjects('test-profile', { bucket: 'test-bucket' });

      expect(result.objects).toHaveLength(3);
      expect(result.objects.some((o) => o.key.includes(' '))).toBe(true);
      expect(result.objects.some((o) => o.key.includes('+'))).toBe(true);
    });

    it('should handle Unicode characters in keys', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'folder/文件.txt', Size: 100 },
          { Key: 'folder/файл.txt', Size: 200 },
          { Key: 'folder/αρχείο.txt', Size: 300 },
        ],
        IsTruncated: false,
        KeyCount: 3,
      });

      const result = await listObjects('test-profile', { bucket: 'test-bucket' });

      expect(result.objects).toHaveLength(3);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent list operations', async () => {
      s3Mock.on(ListBucketsCommand).resolves({
        Buckets: [{ Name: 'bucket-1' }],
      });

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'file.txt', Size: 100 }],
        IsTruncated: false,
        KeyCount: 1,
      });

      // Run operations concurrently
      const [buckets, objects] = await Promise.all([
        listBuckets('test-profile'),
        listObjects('test-profile', { bucket: 'test-bucket' }),
      ]);

      expect(buckets).toHaveLength(1);
      expect(objects.objects).toHaveLength(1);
    });
  });

  describe('Storage Classes', () => {
    it('should include storage class in object listing', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'standard.txt', Size: 100, StorageClass: 'STANDARD' },
          { Key: 'glacier.txt', Size: 200, StorageClass: 'GLACIER' },
          { Key: 'ia.txt', Size: 300, StorageClass: 'STANDARD_IA' },
        ],
        IsTruncated: false,
        KeyCount: 3,
      });

      const result = await listObjects('test-profile', { bucket: 'test-bucket' });

      expect(result.objects[0].storageClass).toBe('STANDARD');
      expect(result.objects[1].storageClass).toBe('GLACIER');
      expect(result.objects[2].storageClass).toBe('STANDARD_IA');
    });
  });

  describe('ETag Processing', () => {
    it('should strip quotes from ETag', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'file.txt', Size: 100, ETag: '"abc123def456"' },
        ],
        IsTruncated: false,
        KeyCount: 1,
      });

      const result = await listObjects('test-profile', { bucket: 'test-bucket' });

      expect(result.objects[0].etag).toBe('abc123def456');
    });
  });
});

describe('Error Scenarios', () => {
  beforeEach(() => {
    s3Mock.reset();
    clearS3Client();
  });

  it('should handle network timeout', async () => {
    s3Mock.on(ListBucketsCommand).rejects({
      name: 'TimeoutError',
      message: 'Connection timed out',
    });

    await expect(listBuckets('test-profile')).rejects.toThrow('Connection timed out');
  });

  it('should handle throttling', async () => {
    s3Mock.on(ListObjectsV2Command).rejects({
      name: 'SlowDown',
      message: 'Please reduce your request rate',
    });

    await expect(
      listObjects('test-profile', { bucket: 'test-bucket' })
    ).rejects.toThrow();
  });

  it('should handle service unavailable', async () => {
    s3Mock.on(ListBucketsCommand).rejects({
      name: 'ServiceUnavailable',
      message: 'Service is temporarily unavailable',
    });

    await expect(listBuckets('test-profile')).rejects.toThrow();
  });
});
