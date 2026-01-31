/**
 * LocalStack setup for E2E tests
 *
 * This module provides utilities to:
 * - Start/stop LocalStack container
 * - Create test buckets and objects
 * - Clean up after tests
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import { S3Client, CreateBucketCommand, PutObjectCommand, ListBucketsCommand, DeleteBucketCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

// LocalStack configuration
// Try container IP first (for Docker-in-Docker), then localhost
export const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';
export const TEST_REGION = 'us-east-1';

// Mock AWS credentials for LocalStack
export const MOCK_AWS_CREDENTIALS = {
  accessKeyId: 'test',
  secretAccessKey: 'test',
  region: TEST_REGION,
};

// Test data configuration
export const TEST_BUCKETS = {
  main: 'test-bucket',
  secondary: 'secondary-bucket',
  empty: 'empty-bucket',
};

export const TEST_DATA = {
  textFile: {
    key: 'documents/readme.txt',
    content: 'This is a test text file for E2E testing.',
    contentType: 'text/plain',
  },
  jsonFile: {
    key: 'data/config.json',
    content: JSON.stringify({ name: 'test', value: 123, nested: { enabled: true } }, null, 2),
    contentType: 'application/json',
  },
  yamlFile: {
    key: 'data/config.yaml',
    content: `name: test
value: 123
nested:
  enabled: true
  items:
    - one
    - two
    - three
`,
    contentType: 'text/yaml',
  },
  csvFile: {
    key: 'data/users.csv',
    content: `id,name,email,active
1,John Doe,john@example.com,true
2,Jane Smith,jane@example.com,true
3,Bob Wilson,bob@example.com,false
`,
    contentType: 'text/csv',
  },
  nestedFolder: {
    key: 'nested/level1/level2/deep-file.txt',
    content: 'Deep nested file content',
    contentType: 'text/plain',
  },
  // Small parquet-like binary data (not a real parquet, but for testing binary handling)
  binaryFile: {
    key: 'data/sample.bin',
    content: Buffer.from([0x50, 0x41, 0x52, 0x31, 0x00, 0x00, 0x00, 0x00]), // PAR1 magic bytes
    contentType: 'application/octet-stream',
  },
  // Image placeholder (1x1 PNG)
  imageFile: {
    key: 'images/test.png',
    content: Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
      0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0x0F, 0x00, 0x00,
      0x01, 0x01, 0x00, 0x05, 0x1B, 0xF8, 0x5C, 0x86, 0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ]),
    contentType: 'image/png',
  },
  // Additional files for multiselect testing
  multiFile1: {
    key: 'documents/file1.txt',
    content: 'File 1 content for multiselect testing',
    contentType: 'text/plain',
  },
  multiFile2: {
    key: 'documents/file2.txt',
    content: 'File 2 content for multiselect testing',
    contentType: 'text/plain',
  },
  multiFile3: {
    key: 'documents/file3.txt',
    content: 'File 3 content for multiselect testing',
    contentType: 'text/plain',
  },
  multiFile4: {
    key: 'documents/file4.txt',
    content: 'File 4 content for multiselect testing',
    contentType: 'text/plain',
  },
};

// S3 client for LocalStack
let s3Client: S3Client | null = null;

/**
 * Get or create S3 client for LocalStack
 */
export function getLocalStackS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: dynamicEndpoint,
      region: TEST_REGION,
      credentials: {
        accessKeyId: MOCK_AWS_CREDENTIALS.accessKeyId,
        secretAccessKey: MOCK_AWS_CREDENTIALS.secretAccessKey,
      },
      forcePathStyle: true, // Required for LocalStack
    });
  }
  return s3Client;
}

// Dynamic endpoint based on container IP (set during startup)
let dynamicEndpoint: string = LOCALSTACK_ENDPOINT;

/**
 * Get the current LocalStack endpoint
 */
export function getEndpoint(): string {
  return dynamicEndpoint;
}

/**
 * Set the LocalStack endpoint (e.g., after discovering container IP)
 */
export function setEndpoint(endpoint: string): void {
  dynamicEndpoint = endpoint;
  // Reset S3 client to use new endpoint
  s3Client = null;
}

/**
 * Check if LocalStack is running and healthy
 */
export async function isLocalStackHealthy(): Promise<boolean> {
  const endpoints = [dynamicEndpoint];

  // Also try container network IP if we started the container
  try {
    const result = execSync('docker inspect s3-browser-localstack --format "{{.NetworkSettings.IPAddress}}" 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (result && result !== dynamicEndpoint.replace('http://', '').replace(':4566', '')) {
      endpoints.push(`http://${result}:4566`);
    }
  } catch {
    // Container might not exist
  }

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}/_localstack/health`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const health = await response.json();
        if (health.services?.s3 === 'running' || health.services?.s3 === 'available') {
          // Update dynamic endpoint if different
          if (endpoint !== dynamicEndpoint) {
            console.log(`Using LocalStack endpoint: ${endpoint}`);
            setEndpoint(endpoint);
          }
          return true;
        }
      }
    } catch {
      // Try next endpoint
    }
  }

  return false;
}

/**
 * Wait for LocalStack to be healthy
 */
export async function waitForLocalStack(maxWaitMs = 60000): Promise<boolean> {
  const startTime = Date.now();
  const checkInterval = 1000;

  console.log('Waiting for LocalStack to be healthy...');

  while (Date.now() - startTime < maxWaitMs) {
    if (await isLocalStackHealthy()) {
      console.log('LocalStack is healthy!');
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  console.error('LocalStack did not become healthy within timeout');
  return false;
}

/**
 * Start LocalStack container using Docker
 */
export async function startLocalStack(): Promise<boolean> {
  console.log('Starting LocalStack container...');

  try {
    // Check if LocalStack is already running
    if (await isLocalStackHealthy()) {
      console.log('LocalStack is already running');
      return true;
    }

    // Remove any existing container with the same name
    try {
      execSync('docker rm -f s3-browser-localstack 2>/dev/null', { stdio: 'ignore' });
    } catch {
      // Container might not exist, that's fine
    }

    // Start LocalStack container
    const dockerCmd = [
      'docker', 'run', '-d',
      '--name', 's3-browser-localstack',
      '-p', '4566:4566',
      '-e', 'SERVICES=s3',
      '-e', 'DEBUG=0',
      '-e', 'AWS_DEFAULT_REGION=us-east-1',
      '-e', 'DISABLE_EVENTS=1',
      'localstack/localstack:3.8',
    ];

    execSync(dockerCmd.join(' '), { stdio: 'inherit' });

    // Wait for LocalStack to be healthy
    return await waitForLocalStack();
  } catch (error) {
    console.error('Failed to start LocalStack:', error);
    return false;
  }
}

/**
 * Stop LocalStack container
 */
export function stopLocalStack(): void {
  console.log('Stopping LocalStack container...');
  try {
    execSync('docker rm -f s3-browser-localstack 2>/dev/null', { stdio: 'ignore' });
    console.log('LocalStack container stopped');
  } catch {
    // Container might not exist
  }
}

/**
 * Create test buckets in LocalStack
 */
export async function createTestBuckets(): Promise<void> {
  const client = getLocalStackS3Client();

  for (const [name, bucketName] of Object.entries(TEST_BUCKETS)) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucketName }));
      console.log(`Created bucket: ${bucketName}`);
    } catch (error: any) {
      if (error.name !== 'BucketAlreadyOwnedByYou' && error.name !== 'BucketAlreadyExists') {
        console.error(`Failed to create bucket ${bucketName}:`, error.message);
        throw error;
      }
    }
  }
}

/**
 * Upload test data to LocalStack
 */
export async function uploadTestData(): Promise<void> {
  const client = getLocalStackS3Client();
  const bucket = TEST_BUCKETS.main;

  for (const [name, data] of Object.entries(TEST_DATA)) {
    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: data.key,
        Body: typeof data.content === 'string' ? data.content : data.content,
        ContentType: data.contentType,
      }));
      console.log(`Uploaded: ${data.key}`);
    } catch (error: any) {
      console.error(`Failed to upload ${data.key}:`, error.message);
      throw error;
    }
  }

  // Also add some files to secondary bucket
  await client.send(new PutObjectCommand({
    Bucket: TEST_BUCKETS.secondary,
    Key: 'secondary-file.txt',
    Body: 'Content in secondary bucket',
    ContentType: 'text/plain',
  }));
}

/**
 * Delete all objects in a bucket
 */
async function emptyBucket(bucketName: string): Promise<void> {
  const client = getLocalStackS3Client();

  try {
    const listResponse = await client.send(new ListObjectsV2Command({ Bucket: bucketName }));

    for (const obj of listResponse.Contents || []) {
      if (obj.Key) {
        await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: obj.Key }));
      }
    }
  } catch {
    // Bucket might not exist
  }
}

/**
 * Clean up all test data and buckets
 */
export async function cleanupTestData(): Promise<void> {
  const client = getLocalStackS3Client();

  for (const bucketName of Object.values(TEST_BUCKETS)) {
    try {
      await emptyBucket(bucketName);
      await client.send(new DeleteBucketCommand({ Bucket: bucketName }));
      console.log(`Deleted bucket: ${bucketName}`);
    } catch {
      // Bucket might not exist
    }
  }
}

/**
 * Initialize test environment
 * - Start LocalStack if needed
 * - Create test buckets
 * - Upload test data
 */
export async function initializeTestEnvironment(): Promise<boolean> {
  try {
    // Start LocalStack
    const started = await startLocalStack();
    if (!started) {
      console.error('Failed to start LocalStack');
      return false;
    }

    // Create buckets and upload data
    await createTestBuckets();
    await uploadTestData();

    console.log('Test environment initialized successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize test environment:', error);
    return false;
  }
}

/**
 * Cleanup test environment
 * - Clean up test data
 * - Optionally stop LocalStack
 */
export async function cleanupTestEnvironment(stopContainer = false): Promise<void> {
  try {
    await cleanupTestData();

    if (stopContainer) {
      stopLocalStack();
    }

    console.log('Test environment cleaned up');
  } catch (error) {
    console.error('Failed to cleanup test environment:', error);
  }
}

/**
 * Verify test data exists in LocalStack
 */
export async function verifyTestData(): Promise<boolean> {
  const client = getLocalStackS3Client();

  try {
    const buckets = await client.send(new ListBucketsCommand({}));
    const bucketNames = buckets.Buckets?.map(b => b.Name) || [];

    for (const expectedBucket of Object.values(TEST_BUCKETS)) {
      if (!bucketNames.includes(expectedBucket)) {
        console.error(`Missing bucket: ${expectedBucket}`);
        return false;
      }
    }

    // Verify main bucket has expected objects
    const objects = await client.send(new ListObjectsV2Command({ Bucket: TEST_BUCKETS.main }));
    const keys = objects.Contents?.map(o => o.Key) || [];

    for (const data of Object.values(TEST_DATA)) {
      if (!keys.includes(data.key)) {
        console.error(`Missing object: ${data.key}`);
        return false;
      }
    }

    console.log('Test data verification passed');
    return true;
  } catch (error) {
    console.error('Test data verification failed:', error);
    return false;
  }
}
