import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Create mock functions before the vi.mock calls
const mockSend = vi.fn();

// Mock the AWS SDK S3 client
vi.mock('@aws-sdk/client-s3', () => {
  // Create a proper class mock
  class MockS3Client {
    config: object;
    constructor(config: object) {
      this.config = config;
    }
    // Return a function that calls the mockSend we defined above
    send = (command: unknown) => mockSend(command);
  }

  return {
    S3Client: MockS3Client,
    ListBucketsCommand: vi.fn().mockImplementation(function (input: unknown) {
      return { input, type: 'ListBuckets' };
    }),
    ListObjectsV2Command: vi.fn().mockImplementation(function (input: unknown) {
      return { input, type: 'ListObjectsV2' };
    }),
    GetObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
      return { input, type: 'GetObject' };
    }),
    PutObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
      return { input, type: 'PutObject' };
    }),
    DeleteObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
      return { input, type: 'DeleteObject' };
    }),
    CopyObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
      return { input, type: 'CopyObject' };
    }),
    HeadObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
      return { input, type: 'HeadObject' };
    }),
  };
});

// Mock fs module - need to mock the specific imports used by s3Service
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as object;
  return {
    ...actual,
    default: {
      promises: {
        mkdir: vi.fn().mockResolvedValue(undefined),
        stat: vi.fn().mockResolvedValue({ size: 1024 }),
        readFile: vi.fn().mockResolvedValue(Buffer.from('test content')),
        unlink: vi.fn().mockResolvedValue(undefined),
        access: vi.fn().mockRejectedValue(new Error('ENOENT')),
      },
      createWriteStream: vi.fn().mockReturnValue({
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      }),
    },
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ size: 1024 }),
      readFile: vi.fn().mockResolvedValue(Buffer.from('test content')),
      unlink: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockRejectedValue(new Error('ENOENT')),
    },
    createWriteStream: vi.fn().mockReturnValue({
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    }),
  };
});

// Mock stream/promises - need to include default export
vi.mock('stream/promises', () => ({
  default: {
    pipeline: vi.fn().mockResolvedValue(undefined),
  },
  pipeline: vi.fn().mockResolvedValue(undefined),
}));

// Mock the awsCredentials module
vi.mock('../main/services/awsCredentials', () => ({
  getProfile: vi.fn(),
}));

import {
  getS3Client,
  clearS3Client,
  getCurrentClientProfile,
  listBuckets,
  listObjects,
  listAllObjects,
  parseS3Url,
  getParentPrefix,
  getKeyName,
  uploadContent,
  downloadContent,
  deleteFile,
  renameFile,
  copyFile,
  getFileSize,
} from '../main/services/s3Service';
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getProfile } from '../main/services/awsCredentials';
import { Readable } from 'stream';

describe('s3Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearS3Client();
    mockSend.mockReset();
  });

  afterEach(() => {
    clearS3Client();
  });

  describe('getS3Client', () => {
    it('should create a new S3 client for a valid profile', () => {
      (getProfile as Mock).mockReturnValue({
        name: 'default',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        region: 'us-west-2',
        hasCredentials: true,
      });

      const client = getS3Client('default');

      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(S3Client);
    });

    it('should use default region (eu-west-1) if profile has no region', () => {
      (getProfile as Mock).mockReturnValue({
        name: 'default',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        hasCredentials: true,
      });

      const client = getS3Client('default');
      // Since we're mocking S3Client, we can check the config was set
      expect(client).toBeDefined();
      // The client config should include default region and followRegionRedirects
      expect((client as any).config.region).toBe('eu-west-1');
    });

    it('should configure S3 client with followRegionRedirects for cross-region bucket access', () => {
      (getProfile as Mock).mockReturnValue({
        name: 'default',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        hasCredentials: true,
      });

      const client = getS3Client('default');
      expect(client).toBeDefined();
      // The client should be configured to follow region redirects
      expect((client as any).config.followRegionRedirects).toBe(true);
    });

    it('should include session token if present', () => {
      (getProfile as Mock).mockReturnValue({
        name: 'temp',
        accessKeyId: 'ASIATEMP',
        secretAccessKey: 'secretkey',
        sessionToken: 'token123',
        region: 'eu-west-1',
        hasCredentials: true,
      });

      const client = getS3Client('temp');
      expect(client).toBeDefined();
    });

    it('should return cached client for same profile', () => {
      (getProfile as Mock).mockReturnValue({
        name: 'default',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        hasCredentials: true,
      });

      const client1 = getS3Client('default');
      const client2 = getS3Client('default');

      expect(client1).toBe(client2);
    });

    it('should create new client when profile changes', () => {
      (getProfile as Mock).mockReturnValueOnce({
        name: 'default',
        accessKeyId: 'AKIATEST1',
        secretAccessKey: 'secret1',
        hasCredentials: true,
      });

      (getProfile as Mock).mockReturnValueOnce({
        name: 'production',
        accessKeyId: 'AKIATEST2',
        secretAccessKey: 'secret2',
        hasCredentials: true,
      });

      const client1 = getS3Client('default');
      const client2 = getS3Client('production');

      expect(client1).not.toBe(client2);
    });

    it('should throw error for non-existent profile', () => {
      (getProfile as Mock).mockReturnValue(null);

      expect(() => getS3Client('nonexistent')).toThrow("Profile 'nonexistent' not found");
    });

    it('should throw error for profile without credentials', () => {
      (getProfile as Mock).mockReturnValue({
        name: 'no-creds',
        hasCredentials: false,
      });

      expect(() => getS3Client('no-creds')).toThrow("Profile 'no-creds' has no valid credentials");
    });

    it('should force new client when forceNew is true', () => {
      (getProfile as Mock).mockReturnValue({
        name: 'default',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        hasCredentials: true,
      });

      const client1 = getS3Client('default');
      const client2 = getS3Client('default', true);

      expect(client1).not.toBe(client2);
    });
  });

  describe('getCurrentClientProfile', () => {
    it('should return null initially', () => {
      expect(getCurrentClientProfile()).toBeNull();
    });

    it('should return current profile after client creation', () => {
      (getProfile as Mock).mockReturnValue({
        name: 'test-profile',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        hasCredentials: true,
      });

      getS3Client('test-profile');

      expect(getCurrentClientProfile()).toBe('test-profile');
    });
  });

  describe('clearS3Client', () => {
    it('should clear cached client and profile', () => {
      (getProfile as Mock).mockReturnValue({
        name: 'default',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        hasCredentials: true,
      });

      getS3Client('default');
      expect(getCurrentClientProfile()).toBe('default');

      clearS3Client();

      expect(getCurrentClientProfile()).toBeNull();
    });
  });

  describe('listBuckets', () => {
    beforeEach(() => {
      (getProfile as Mock).mockReturnValue({
        name: 'default',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        hasCredentials: true,
      });
    });

    it('should return list of buckets sorted alphabetically', async () => {
      mockSend.mockResolvedValue({
        Buckets: [
          { Name: 'zebra-bucket', CreationDate: new Date('2023-01-01') },
          { Name: 'alpha-bucket', CreationDate: new Date('2023-02-01') },
          { Name: 'beta-bucket', CreationDate: new Date('2023-03-01') },
        ],
      });

      const buckets = await listBuckets('default');

      expect(buckets).toHaveLength(3);
      expect(buckets[0].name).toBe('alpha-bucket');
      expect(buckets[1].name).toBe('beta-bucket');
      expect(buckets[2].name).toBe('zebra-bucket');
    });

    it('should return empty array when no buckets', async () => {
      mockSend.mockResolvedValue({ Buckets: [] });

      const buckets = await listBuckets('default');

      expect(buckets).toHaveLength(0);
    });

    it('should handle undefined Buckets in response', async () => {
      mockSend.mockResolvedValue({});

      const buckets = await listBuckets('default');

      expect(buckets).toHaveLength(0);
    });

    it('should include creation date when available', async () => {
      const creationDate = new Date('2023-06-15T10:30:00Z');
      mockSend.mockResolvedValue({
        Buckets: [{ Name: 'test-bucket', CreationDate: creationDate }],
      });

      const buckets = await listBuckets('default');

      expect(buckets[0].creationDate).toEqual(creationDate);
    });
  });

  describe('listObjects', () => {
    beforeEach(() => {
      (getProfile as Mock).mockReturnValue({
        name: 'default',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        hasCredentials: true,
      });
    });

    it('should list objects in a bucket', async () => {
      mockSend.mockResolvedValue({
        Contents: [
          { Key: 'file1.txt', Size: 100, LastModified: new Date('2023-01-01') },
          { Key: 'file2.txt', Size: 200, LastModified: new Date('2023-02-01') },
        ],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 2,
      });

      const result = await listObjects('default', { bucket: 'test-bucket' });

      expect(result.objects).toHaveLength(2);
      expect(result.objects[0].key).toBe('file1.txt');
      expect(result.objects[0].size).toBe(100);
      expect(result.objects[0].isPrefix).toBe(false);
    });

    it('should list common prefixes (folders)', async () => {
      mockSend.mockResolvedValue({
        Contents: [],
        CommonPrefixes: [{ Prefix: 'folder1/' }, { Prefix: 'folder2/' }],
        IsTruncated: false,
        KeyCount: 0,
      });

      const result = await listObjects('default', { bucket: 'test-bucket' });

      expect(result.prefixes).toHaveLength(2);
      expect(result.prefixes[0].key).toBe('folder1/');
      expect(result.prefixes[0].isPrefix).toBe(true);
      expect(result.prefixes[0].size).toBe(0);
    });

    it('should use provided prefix', async () => {
      mockSend.mockResolvedValue({
        Contents: [{ Key: 'folder/file.txt', Size: 100 }],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 1,
      });

      await listObjects('default', { bucket: 'test-bucket', prefix: 'folder/' });

      expect(ListObjectsV2Command).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Prefix: 'folder/',
          Delimiter: '/',
        })
      );
    });

    it('should handle pagination with continuation token', async () => {
      mockSend.mockResolvedValue({
        Contents: [{ Key: 'file1.txt', Size: 100 }],
        CommonPrefixes: [],
        IsTruncated: true,
        NextContinuationToken: 'token123',
        KeyCount: 1,
      });

      const result = await listObjects('default', { bucket: 'test-bucket' });

      expect(result.isTruncated).toBe(true);
      expect(result.continuationToken).toBe('token123');
    });

    it('should pass continuation token in request', async () => {
      mockSend.mockResolvedValue({
        Contents: [],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 0,
      });

      await listObjects('default', {
        bucket: 'test-bucket',
        continuationToken: 'existingToken',
      });

      expect(ListObjectsV2Command).toHaveBeenCalledWith(
        expect.objectContaining({
          ContinuationToken: 'existingToken',
        })
      );
    });

    it('should respect maxKeys option', async () => {
      mockSend.mockResolvedValue({
        Contents: [],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 0,
      });

      await listObjects('default', { bucket: 'test-bucket', maxKeys: 50 });

      expect(ListObjectsV2Command).toHaveBeenCalledWith(
        expect.objectContaining({
          MaxKeys: 50,
        })
      );
    });

    it('should cap maxKeys at 1000', async () => {
      mockSend.mockResolvedValue({
        Contents: [],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 0,
      });

      await listObjects('default', { bucket: 'test-bucket', maxKeys: 5000 });

      expect(ListObjectsV2Command).toHaveBeenCalledWith(
        expect.objectContaining({
          MaxKeys: 1000,
        })
      );
    });

    it('should filter out the prefix itself from objects', async () => {
      mockSend.mockResolvedValue({
        Contents: [
          { Key: 'folder/', Size: 0 }, // This is the prefix itself
          { Key: 'folder/file.txt', Size: 100 },
        ],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 2,
      });

      const result = await listObjects('default', {
        bucket: 'test-bucket',
        prefix: 'folder/',
      });

      expect(result.objects).toHaveLength(1);
      expect(result.objects[0].key).toBe('folder/file.txt');
    });

    it('should strip quotes from ETag', async () => {
      mockSend.mockResolvedValue({
        Contents: [{ Key: 'file.txt', Size: 100, ETag: '"abc123def456"' }],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 1,
      });

      const result = await listObjects('default', { bucket: 'test-bucket' });

      expect(result.objects[0].etag).toBe('abc123def456');
    });

    it('should include storage class', async () => {
      mockSend.mockResolvedValue({
        Contents: [{ Key: 'file.txt', Size: 100, StorageClass: 'GLACIER' }],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 1,
      });

      const result = await listObjects('default', { bucket: 'test-bucket' });

      expect(result.objects[0].storageClass).toBe('GLACIER');
    });
  });

  describe('listAllObjects', () => {
    beforeEach(() => {
      (getProfile as Mock).mockReturnValue({
        name: 'default',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        hasCredentials: true,
      });
    });

    it('should fetch all pages of objects', async () => {
      // First page
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: 'file1.txt', Size: 100 }],
        CommonPrefixes: [{ Prefix: 'folder1/' }],
        IsTruncated: true,
        NextContinuationToken: 'page2token',
        KeyCount: 1,
      });

      // Second page
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: 'file2.txt', Size: 200 }],
        CommonPrefixes: [{ Prefix: 'folder2/' }],
        IsTruncated: false,
        KeyCount: 1,
      });

      const result = await listAllObjects('default', { bucket: 'test-bucket' });

      expect(result.objects).toHaveLength(2);
      expect(result.prefixes).toHaveLength(2);
      expect(result.isTruncated).toBe(false);
      expect(result.continuationToken).toBeUndefined();
    });

    it('should call progress callback', async () => {
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: 'file1.txt', Size: 100 }],
        CommonPrefixes: [],
        IsTruncated: true,
        NextContinuationToken: 'page2',
        KeyCount: 1,
      });

      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: 'file2.txt', Size: 200 }],
        CommonPrefixes: [],
        IsTruncated: false,
        KeyCount: 1,
      });

      const progressCallback = vi.fn();
      await listAllObjects('default', { bucket: 'test-bucket' }, progressCallback);

      expect(progressCallback).toHaveBeenCalledTimes(2);
      expect(progressCallback).toHaveBeenNthCalledWith(1, 1);
      expect(progressCallback).toHaveBeenNthCalledWith(2, 2);
    });

    it('should handle abort signal', async () => {
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: 'file1.txt', Size: 100 }],
        CommonPrefixes: [],
        IsTruncated: true,
        NextContinuationToken: 'page2',
        KeyCount: 1,
      });

      const abortController = new AbortController();
      abortController.abort();

      await expect(
        listAllObjects('default', { bucket: 'test-bucket' }, undefined, abortController.signal)
      ).rejects.toThrow('Operation aborted');
    });
  });

  describe('parseS3Url', () => {
    it('should parse s3:// URL with key', () => {
      const result = parseS3Url('s3://my-bucket/path/to/file.txt');

      expect(result).toEqual({
        bucket: 'my-bucket',
        key: 'path/to/file.txt',
      });
    });

    it('should parse s3:// URL without key', () => {
      const result = parseS3Url('s3://my-bucket');

      expect(result).toEqual({
        bucket: 'my-bucket',
        key: '',
      });
    });

    it('should parse s3:// URL with trailing slash', () => {
      const result = parseS3Url('s3://my-bucket/');

      expect(result).toEqual({
        bucket: 'my-bucket',
        key: '',
      });
    });

    it('should parse virtual-hosted style URL', () => {
      const result = parseS3Url('https://my-bucket.s3.us-west-2.amazonaws.com/file.txt');

      expect(result).toEqual({
        bucket: 'my-bucket',
        key: 'file.txt',
      });
    });

    it('should parse virtual-hosted style URL without region', () => {
      const result = parseS3Url('https://my-bucket.s3.amazonaws.com/file.txt');

      expect(result).toEqual({
        bucket: 'my-bucket',
        key: 'file.txt',
      });
    });

    it('should parse path-style URL', () => {
      const result = parseS3Url('https://s3.us-west-2.amazonaws.com/my-bucket/file.txt');

      expect(result).toEqual({
        bucket: 'my-bucket',
        key: 'file.txt',
      });
    });

    it('should parse path-style URL without region', () => {
      const result = parseS3Url('https://s3.amazonaws.com/my-bucket/file.txt');

      expect(result).toEqual({
        bucket: 'my-bucket',
        key: 'file.txt',
      });
    });

    it('should return null for invalid URL', () => {
      expect(parseS3Url('https://example.com/file.txt')).toBeNull();
      expect(parseS3Url('invalid-url')).toBeNull();
      expect(parseS3Url('')).toBeNull();
    });

    it('should handle http:// URLs', () => {
      const result = parseS3Url('http://my-bucket.s3.amazonaws.com/file.txt');

      expect(result).toEqual({
        bucket: 'my-bucket',
        key: 'file.txt',
      });
    });
  });

  describe('getParentPrefix', () => {
    it('should return parent prefix for nested key', () => {
      expect(getParentPrefix('folder/subfolder/file.txt')).toBe('folder/subfolder/');
    });

    it('should return parent for prefix with trailing slash', () => {
      expect(getParentPrefix('folder/subfolder/')).toBe('folder/');
    });

    it('should return empty string for root-level key', () => {
      expect(getParentPrefix('file.txt')).toBe('');
    });

    it('should return empty string for single folder', () => {
      expect(getParentPrefix('folder/')).toBe('');
    });

    it('should handle deeply nested paths', () => {
      expect(getParentPrefix('a/b/c/d/e/file.txt')).toBe('a/b/c/d/e/');
    });
  });

  describe('getKeyName', () => {
    it('should return filename from path', () => {
      expect(getKeyName('folder/subfolder/file.txt')).toBe('file.txt');
    });

    it('should return folder name from prefix', () => {
      expect(getKeyName('folder/subfolder/')).toBe('subfolder');
    });

    it('should return key for root-level file', () => {
      expect(getKeyName('file.txt')).toBe('file.txt');
    });

    it('should return folder name for single folder', () => {
      expect(getKeyName('folder/')).toBe('folder');
    });
  });

  describe('uploadContent', () => {
    beforeEach(() => {
      (getProfile as Mock).mockReturnValue({
        name: 'default',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        hasCredentials: true,
      });
    });

    it('should upload string content to S3', async () => {
      mockSend.mockResolvedValue({});

      const result = await uploadContent('default', 'test-bucket', 'file.txt', 'Hello World');

      expect(result.success).toBe(true);
      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'file.txt',
        })
      );
    });

    it('should set correct content type for JSON files', async () => {
      mockSend.mockResolvedValue({});

      await uploadContent('default', 'test-bucket', 'data.json', '{"key":"value"}');

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ContentType: 'application/json',
        })
      );
    });

    it('should set correct content type for YAML files', async () => {
      mockSend.mockResolvedValue({});

      await uploadContent('default', 'test-bucket', 'config.yaml', 'key: value');

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ContentType: 'text/yaml',
        })
      );
    });

    it('should return error on failure', async () => {
      mockSend.mockRejectedValue(new Error('Upload failed'));

      const result = await uploadContent('default', 'test-bucket', 'file.txt', 'content');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Upload failed');
    });
  });

  describe('downloadContent', () => {
    beforeEach(() => {
      (getProfile as Mock).mockReturnValue({
        name: 'default',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        hasCredentials: true,
      });
    });

    it('should download content from S3', async () => {
      const mockStream = Readable.from([Buffer.from('Hello World')]);
      mockSend.mockResolvedValue({ Body: mockStream });

      const result = await downloadContent('default', 'test-bucket', 'file.txt');

      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello World');
    });

    it('should return error when body is empty', async () => {
      mockSend.mockResolvedValue({ Body: null });

      const result = await downloadContent('default', 'test-bucket', 'file.txt');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Empty response body');
    });

    it('should return error on failure', async () => {
      mockSend.mockRejectedValue(new Error('Download failed'));

      const result = await downloadContent('default', 'test-bucket', 'file.txt');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Download failed');
    });
  });

  describe('deleteFile', () => {
    beforeEach(() => {
      (getProfile as Mock).mockReturnValue({
        name: 'default',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        hasCredentials: true,
      });
    });

    it('should delete file from S3', async () => {
      mockSend.mockResolvedValue({});

      const result = await deleteFile('default', 'test-bucket', 'file.txt');

      expect(result.success).toBe(true);
      expect(DeleteObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'file.txt',
        })
      );
    });

    it('should return error on failure', async () => {
      mockSend.mockRejectedValue(new Error('Access denied'));

      const result = await deleteFile('default', 'test-bucket', 'file.txt');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
    });
  });

  describe('renameFile', () => {
    beforeEach(() => {
      (getProfile as Mock).mockReturnValue({
        name: 'default',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        hasCredentials: true,
      });
    });

    it('should copy and delete the original file', async () => {
      mockSend.mockResolvedValue({});

      const result = await renameFile('default', 'test-bucket', 'old.txt', 'new.txt');

      expect(result.success).toBe(true);
      expect(CopyObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'new.txt',
          CopySource: encodeURIComponent('test-bucket/old.txt'),
        })
      );
      expect(DeleteObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'old.txt',
        })
      );
    });

    it('should preserve path when renaming nested file', async () => {
      mockSend.mockResolvedValue({});

      await renameFile('default', 'test-bucket', 'folder/old.txt', 'folder/new.txt');

      expect(CopyObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: 'folder/new.txt',
        })
      );
    });

    it('should return error on copy failure', async () => {
      mockSend.mockRejectedValue(new Error('Copy failed'));

      const result = await renameFile('default', 'test-bucket', 'old.txt', 'new.txt');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Copy failed');
    });
  });

  describe('copyFile', () => {
    beforeEach(() => {
      (getProfile as Mock).mockReturnValue({
        name: 'default',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        hasCredentials: true,
      });
    });

    it('should copy file within same bucket', async () => {
      mockSend.mockResolvedValue({});

      const result = await copyFile(
        'default',
        'test-bucket',
        'source.txt',
        'test-bucket',
        'destination.txt'
      );

      expect(result.success).toBe(true);
      expect(CopyObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'destination.txt',
          CopySource: encodeURIComponent('test-bucket/source.txt'),
        })
      );
    });

    it('should copy file to different bucket', async () => {
      mockSend.mockResolvedValue({});

      const result = await copyFile(
        'default',
        'source-bucket',
        'file.txt',
        'dest-bucket',
        'file.txt'
      );

      expect(result.success).toBe(true);
      expect(CopyObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'dest-bucket',
          CopySource: encodeURIComponent('source-bucket/file.txt'),
        })
      );
    });

    it('should return error on failure', async () => {
      mockSend.mockRejectedValue(new Error('Bucket not found'));

      const result = await copyFile(
        'default',
        'source-bucket',
        'file.txt',
        'nonexistent-bucket',
        'file.txt'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Bucket not found');
    });
  });

  describe('getFileSize', () => {
    beforeEach(() => {
      (getProfile as Mock).mockReturnValue({
        name: 'default',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secretkey',
        hasCredentials: true,
      });
    });

    it('should return file size', async () => {
      mockSend.mockResolvedValue({ ContentLength: 1234 });

      const result = await getFileSize('default', 'test-bucket', 'file.txt');

      expect(result.success).toBe(true);
      expect(result.size).toBe(1234);
      expect(HeadObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'file.txt',
        })
      );
    });

    it('should return 0 for undefined ContentLength', async () => {
      mockSend.mockResolvedValue({});

      const result = await getFileSize('default', 'test-bucket', 'file.txt');

      expect(result.success).toBe(true);
      expect(result.size).toBe(0);
    });

    it('should return error on failure', async () => {
      mockSend.mockRejectedValue(new Error('Not found'));

      const result = await getFileSize('default', 'test-bucket', 'nonexistent.txt');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
    });
  });
});
