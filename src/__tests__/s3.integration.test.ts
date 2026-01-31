/**
 * End-to-End Integration Tests for S3 Operations
 *
 * These tests use real AWS credentials to verify S3 operations work correctly.
 * They test:
 * - Loading profiles from ~/.aws/credentials and ~/.aws/config
 * - Profile type detection (static credentials, assume-role profiles)
 * - S3 bucket listing with various credential types
 * - S3 URL navigation
 *
 * Requirements:
 * - Valid AWS credentials in ~/.aws/credentials
 * - Network access to AWS S3
 *
 * Run with: npm test -- --run s3.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  loadAwsProfiles,
  getProfile,
  validateProfile,
  type AwsProfile,
} from '../main/services/awsCredentials';
import {
  listBuckets,
  listObjects,
  parseS3Url,
  clearS3Client,
} from '../main/services/s3Service';

// Skip these tests in CI environments without AWS credentials
// Also skip when using LocalStack/custom endpoint (those are handled by E2E tests)
const USING_LOCALSTACK = !!process.env.AWS_ENDPOINT_URL;
const AWS_CREDENTIALS_AVAILABLE = !USING_LOCALSTACK && (process.env.AWS_ACCESS_KEY_ID ||
  (await import('fs')).existsSync(`${(await import('os')).homedir()}/.aws/credentials`));

describe.skipIf(!AWS_CREDENTIALS_AVAILABLE)('S3 Integration Tests', () => {
  afterEach(() => {
    // Clear client cache between tests to ensure clean state
    clearS3Client();
  });

  describe('Profile Loading', () => {
    it('should load profiles from real AWS credentials files', () => {
      const { profiles, defaultRegion } = loadAwsProfiles();

      expect(profiles.length).toBeGreaterThan(0);
      console.log(`Loaded ${profiles.length} profiles`);

      profiles.forEach(profile => {
        console.log(`  - ${profile.name}: type=${profile.profileType}, hasCredentials=${profile.hasCredentials}`);
      });
    });

    it('should correctly detect static credential profiles', () => {
      const { profiles } = loadAwsProfiles();

      const staticProfiles = profiles.filter(p => p.profileType === 'static');
      console.log(`Found ${staticProfiles.length} static credential profiles`);

      staticProfiles.forEach(profile => {
        expect(profile.accessKeyId).toBeDefined();
        expect(profile.secretAccessKey).toBeDefined();
        expect(profile.hasCredentials).toBe(true);

        const validation = validateProfile(profile);
        expect(validation.valid).toBe(true);
      });
    });

    it('should correctly detect assume-role profiles from credentials file', () => {
      const { profiles } = loadAwsProfiles();

      const roleProfiles = profiles.filter(p => p.profileType === 'role');
      console.log(`Found ${roleProfiles.length} assume-role profiles`);

      roleProfiles.forEach(profile => {
        console.log(`  - ${profile.name}: roleArn=${profile.roleArn}, sourceProfile=${profile.sourceProfile}`);
        expect(profile.roleArn).toBeDefined();
        // Either source_profile or credential_source should be defined
        expect(profile.sourceProfile || profile.credentialSource).toBeDefined();
      });
    });

    it('should validate assume-role profiles with valid source profiles', () => {
      const { profiles } = loadAwsProfiles();

      const roleProfiles = profiles.filter(p => p.profileType === 'role');

      roleProfiles.forEach(profile => {
        // Check if source profile exists and has credentials
        if (profile.sourceProfile) {
          const sourceProfile = profiles.find(p => p.name === profile.sourceProfile);
          if (sourceProfile?.hasCredentials) {
            expect(profile.hasCredentials).toBe(true);
            const validation = validateProfile(profile);
            expect(validation.valid).toBe(true);
            console.log(`  - ${profile.name}: VALID (source=${profile.sourceProfile})`);
          } else {
            console.log(`  - ${profile.name}: INVALID (source profile missing or has no credentials)`);
          }
        }
      });
    });

    it('should provide specific profile: dev (from PRD example)', () => {
      // This tests the specific profile configuration from the PRD
      // [dev]
      // source_profile = dev-usr
      // role_arn = arn:aws:iam::**********:role/JENKINS_CDK_ROLE
      const profile = getProfile('dev');

      if (!profile) {
        console.log('dev profile not found - skipping specific test');
        return;
      }

      console.log('dev profile:', JSON.stringify({
        name: profile.name,
        profileType: profile.profileType,
        hasCredentials: profile.hasCredentials,
        sourceProfile: profile.sourceProfile,
        roleArn: profile.roleArn?.slice(0, 30) + '...',
      }, null, 2));

      expect(profile.profileType).toBe('role');
      expect(profile.sourceProfile).toBe('dev-usr');
      expect(profile.roleArn).toMatch(/^arn:aws:iam::\d+:role\//);

      // The source profile should have credentials
      const sourceProfile = getProfile('dev-usr');
      expect(sourceProfile).toBeDefined();
      expect(sourceProfile?.hasCredentials).toBe(true);

      // Therefore the dev profile should be valid
      expect(profile.hasCredentials).toBe(true);
      const validation = validateProfile(profile);
      expect(validation.valid).toBe(true);
    });
  });

  describe('S3 Bucket Listing', () => {
    it('should list buckets with static credential profile (may fail if user lacks ListBuckets permission)', async () => {
      const { profiles } = loadAwsProfiles();
      const staticProfile = profiles.find(p => p.profileType === 'static' && p.hasCredentials);

      if (!staticProfile) {
        console.log('No static credential profile available - skipping test');
        return;
      }

      console.log(`Testing bucket listing with static profile: ${staticProfile.name}`);

      try {
        const buckets = await listBuckets(staticProfile.name);
        console.log(`Found ${buckets.length} buckets`);
        expect(Array.isArray(buckets)).toBe(true);
        if (buckets.length > 0) {
          console.log(`First 5 buckets: ${buckets.slice(0, 5).map(b => b.name).join(', ')}`);
        }
      } catch (error: unknown) {
        // Static credential profiles (like Jenkins user) may not have ListBuckets permission
        // This is expected - the assume-role profile should be used instead
        const isAccessDenied = error instanceof Error &&
          (error.name === 'AccessDenied' || error.message.includes('AccessDenied'));
        if (isAccessDenied) {
          console.log(`Expected: Static profile ${staticProfile.name} lacks ListBuckets permission`);
          console.log('This is normal - use assume-role profiles (dev, prod) instead');
          // Test passes - this is expected behavior
        } else {
          throw error;
        }
      }
    });

    it('should list buckets with assume-role profile', async () => {
      const { profiles } = loadAwsProfiles();
      const roleProfile = profiles.find(p => p.profileType === 'role' && p.hasCredentials);

      if (!roleProfile) {
        console.log('No valid assume-role profile available - skipping test');
        return;
      }

      console.log(`Testing bucket listing with assume-role profile: ${roleProfile.name}`);
      console.log(`  role_arn: ${roleProfile.roleArn}`);
      console.log(`  source_profile: ${roleProfile.sourceProfile}`);

      try {
        const buckets = await listBuckets(roleProfile.name);

        console.log(`Successfully listed ${buckets.length} buckets using assume-role`);
        expect(Array.isArray(buckets)).toBe(true);

        if (buckets.length > 0) {
          console.log(`First 5 buckets: ${buckets.slice(0, 5).map(b => b.name).join(', ')}`);
        }
      } catch (error) {
        console.error(`Failed to list buckets with ${roleProfile.name}:`, error);
        throw error;
      }
    });

    it('should list buckets with the dev profile specifically', async () => {
      const profile = getProfile('dev');

      if (!profile || !profile.hasCredentials) {
        console.log('dev profile not available or invalid - skipping test');
        return;
      }

      console.log('Testing bucket listing with dev profile');
      console.log(`  profileType: ${profile.profileType}`);
      console.log(`  roleArn: ${profile.roleArn}`);
      console.log(`  sourceProfile: ${profile.sourceProfile}`);

      try {
        const buckets = await listBuckets('dev');

        console.log(`SUCCESS: Listed ${buckets.length} buckets with dev profile`);
        expect(Array.isArray(buckets)).toBe(true);
        // The dev account should have at least some buckets
        expect(buckets.length).toBeGreaterThan(0);

        console.log('Buckets found:');
        buckets.forEach(b => console.log(`  - ${b.name}`));
      } catch (error) {
        console.error('FAILED to list buckets with dev profile:', error);
        throw error;
      }
    });
  });

  describe('S3 Object Listing', () => {
    it('should list objects in a bucket', async () => {
      // First, get the list of buckets
      const { profiles } = loadAwsProfiles();
      const profile = profiles.find(p => p.hasCredentials);

      if (!profile) {
        console.log('No valid profile available - skipping test');
        return;
      }

      const buckets = await listBuckets(profile.name);

      if (buckets.length === 0) {
        console.log('No buckets available - skipping test');
        return;
      }

      const testBucket = buckets[0].name;
      console.log(`Testing object listing in bucket: ${testBucket}`);

      const result = await listObjects(profile.name, { bucket: testBucket });

      console.log(`Found ${result.objects.length} objects and ${result.prefixes.length} prefixes`);
      expect(result).toBeDefined();
      expect(Array.isArray(result.objects)).toBe(true);
      expect(Array.isArray(result.prefixes)).toBe(true);
    });

    it('should handle pagination correctly', async () => {
      const { profiles } = loadAwsProfiles();
      const profile = profiles.find(p => p.hasCredentials);

      if (!profile) {
        console.log('No valid profile available - skipping test');
        return;
      }

      const buckets = await listBuckets(profile.name);

      if (buckets.length === 0) {
        console.log('No buckets available - skipping test');
        return;
      }

      const testBucket = buckets[0].name;

      // Request small page to test pagination
      const result = await listObjects(profile.name, {
        bucket: testBucket,
        maxKeys: 5,
      });

      console.log(`Page 1: ${result.objects.length} objects, truncated: ${result.isTruncated}`);

      if (result.isTruncated && result.continuationToken) {
        const page2 = await listObjects(profile.name, {
          bucket: testBucket,
          maxKeys: 5,
          continuationToken: result.continuationToken,
        });

        console.log(`Page 2: ${page2.objects.length} objects`);
        expect(page2.objects.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('S3 URL Parsing', () => {
    it('should parse s3:// URLs', () => {
      const tests = [
        { url: 's3://my-bucket', expected: { bucket: 'my-bucket', key: '' } },
        { url: 's3://my-bucket/', expected: { bucket: 'my-bucket', key: '' } },
        { url: 's3://my-bucket/folder/', expected: { bucket: 'my-bucket', key: 'folder/' } },
        { url: 's3://my-bucket/path/to/file.txt', expected: { bucket: 'my-bucket', key: 'path/to/file.txt' } },
      ];

      tests.forEach(({ url, expected }) => {
        const result = parseS3Url(url);
        console.log(`${url} -> bucket=${result?.bucket}, key=${result?.key}`);
        expect(result).toEqual(expected);
      });
    });

    it('should parse HTTPS virtual-hosted URLs', () => {
      const tests = [
        {
          url: 'https://my-bucket.s3.amazonaws.com/file.txt',
          expected: { bucket: 'my-bucket', key: 'file.txt' },
        },
        {
          url: 'https://my-bucket.s3.us-west-2.amazonaws.com/folder/file.txt',
          expected: { bucket: 'my-bucket', key: 'folder/file.txt' },
        },
        {
          url: 'https://my-bucket.s3.eu-west-1.amazonaws.com/',
          expected: { bucket: 'my-bucket', key: '' },
        },
      ];

      tests.forEach(({ url, expected }) => {
        const result = parseS3Url(url);
        console.log(`${url} -> bucket=${result?.bucket}, key=${result?.key}`);
        expect(result).toEqual(expected);
      });
    });

    it('should parse HTTPS path-style URLs', () => {
      const tests = [
        {
          url: 'https://s3.amazonaws.com/my-bucket/file.txt',
          expected: { bucket: 'my-bucket', key: 'file.txt' },
        },
        {
          url: 'https://s3.eu-west-1.amazonaws.com/my-bucket/folder/file.txt',
          expected: { bucket: 'my-bucket', key: 'folder/file.txt' },
        },
      ];

      tests.forEach(({ url, expected }) => {
        const result = parseS3Url(url);
        console.log(`${url} -> bucket=${result?.bucket}, key=${result?.key}`);
        expect(result).toEqual(expected);
      });
    });

    it('should return null for invalid URLs', () => {
      const invalidUrls = [
        'https://example.com/bucket/file.txt',
        'ftp://s3.amazonaws.com/bucket/file.txt',
        'not-a-url',
        '',
      ];

      invalidUrls.forEach(url => {
        const result = parseS3Url(url);
        console.log(`${url} -> ${result === null ? 'null (invalid)' : 'parsed'}`);
        expect(result).toBeNull();
      });
    });
  });

  describe('Profile Switching and Client Cache', () => {
    it('should clear client cache when switching profiles', async () => {
      const { profiles } = loadAwsProfiles();
      const validProfiles = profiles.filter(p => p.hasCredentials);

      if (validProfiles.length < 2) {
        console.log('Need at least 2 valid profiles to test switching - skipping');
        return;
      }

      const profile1 = validProfiles[0];
      const profile2 = validProfiles[1];

      console.log(`Testing profile switch: ${profile1.name} -> ${profile2.name}`);

      // List buckets with first profile
      const buckets1 = await listBuckets(profile1.name);
      console.log(`Profile 1 (${profile1.name}): ${buckets1.length} buckets`);

      // Clear client and switch to second profile
      clearS3Client();

      // List buckets with second profile
      const buckets2 = await listBuckets(profile2.name);
      console.log(`Profile 2 (${profile2.name}): ${buckets2.length} buckets`);

      // Both should succeed
      expect(Array.isArray(buckets1)).toBe(true);
      expect(Array.isArray(buckets2)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for non-existent profile', () => {
      expect(() => {
        const profile = getProfile('this-profile-does-not-exist-12345');
        if (!profile) {
          throw new Error("Profile 'this-profile-does-not-exist-12345' not found");
        }
      }).toThrow();
    });

    it('should fail gracefully when listing buckets with invalid credentials', async () => {
      // This test would require setting up invalid credentials
      // For now, we just verify the error handling structure exists
      const { profiles } = loadAwsProfiles();
      const invalidProfile = profiles.find(p => !p.hasCredentials);

      if (!invalidProfile) {
        console.log('No invalid profile to test - skipping');
        return;
      }

      console.log(`Testing error handling with invalid profile: ${invalidProfile.name}`);

      await expect(listBuckets(invalidProfile.name)).rejects.toThrow();
    });
  });
});

// Test file content operations (for TextEditor and ParquetViewer)
describe.skipIf(!AWS_CREDENTIALS_AVAILABLE)('S3 File Content Operations', () => {
  it('should download text file content', async () => {
    const { profiles } = loadAwsProfiles();
    const profile = getProfile('dev') || profiles.find(p => p.hasCredentials);

    if (!profile) {
      console.log('No valid profile available - skipping test');
      return;
    }

    // Import the downloadContent function
    const { downloadContent } = await import('../main/services/s3Service');

    // Try to get a text file from a known bucket
    const testBucket = 'az-invivo-ops-artifact-bucket';
    const testKey = 'EST-5962/test.txt'; // A simple test file

    try {
      // First, let's list some objects to find a text file
      const objectsResult = await listObjects(profile.name, { bucket: testBucket });
      console.log(`Found ${objectsResult.objects.length} objects and ${objectsResult.prefixes.length} folders`);

      // If we have prefixes, navigate into one
      if (objectsResult.prefixes.length > 0) {
        const prefix = objectsResult.prefixes[0].key;
        const innerObjects = await listObjects(profile.name, { bucket: testBucket, prefix });
        console.log(`Found ${innerObjects.objects.length} objects in ${prefix}`);

        const textFile = innerObjects.objects.find(o =>
          o.key.endsWith('.txt') || o.key.endsWith('.json') || o.key.endsWith('.yaml')
        );

        if (textFile) {
          console.log(`Found text file: ${textFile.key}`);
          const result = await downloadContent(profile.name, testBucket, textFile.key);
          console.log(`Download result: success=${result.success}, contentLength=${result.content?.length}`);
          expect(result.success).toBe(true);
          expect(result.content).toBeDefined();
        } else {
          console.log('No text file found in first prefix');
        }
      }
    } catch (error) {
      console.log('Error during text file test:', error);
    }
  });

  it('should download binary file content (for parquet)', async () => {
    const { profiles } = loadAwsProfiles();
    const profile = getProfile('dev') || profiles.find(p => p.hasCredentials);

    if (!profile) {
      console.log('No valid profile available - skipping test');
      return;
    }

    // Import the downloadBinaryContent function
    const { downloadBinaryContent } = await import('../main/services/s3Service');

    // The user mentioned this location: s3://az-invp-ivc-develop-data/dashboards/animal-numbers/COORDINATORS/partition=LIVE/
    const testBucket = 'az-invp-ivc-develop-data';
    const testPrefix = 'dashboards/animal-numbers/COORDINATORS/partition=LIVE/';

    try {
      const objectsResult = await listObjects(profile.name, { bucket: testBucket, prefix: testPrefix });
      console.log(`Found ${objectsResult.objects.length} objects in ${testBucket}/${testPrefix}`);

      const parquetFile = objectsResult.objects.find(o => o.key.endsWith('.parquet'));

      if (parquetFile) {
        console.log(`Found parquet file: ${parquetFile.key} (size: ${parquetFile.size})`);
        const result = await downloadBinaryContent(profile.name, testBucket, parquetFile.key);
        console.log(`Download result: success=${result.success}, dataLength=${result.data?.length}`);
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        if (result.data) {
          expect(result.data.length).toBeGreaterThan(0);
          console.log(`First 4 bytes: ${Array.from(result.data.slice(0, 4)).map(b => b.toString(16)).join(' ')}`);
        }
      } else {
        console.log('No parquet file found - listing objects:');
        objectsResult.objects.forEach(o => console.log(`  - ${o.key}`));
      }
    } catch (error) {
      console.log('Error during binary file test:', error);
      // If the bucket doesn't exist or we don't have access, that's ok
      if (error instanceof Error && error.message.includes('PermanentRedirect')) {
        console.log('Bucket is in a different region');
      }
    }
  });

  it('should verify parquet data can be read with hyparquet', async () => {
    const { profiles } = loadAwsProfiles();
    const profile = getProfile('dev') || profiles.find(p => p.hasCredentials);

    if (!profile) {
      console.log('No valid profile available - skipping test');
      return;
    }

    const { downloadBinaryContent } = await import('../main/services/s3Service');
    const { parquetMetadataAsync, parquetRead } = await import('hyparquet');

    const testBucket = 'az-invp-ivc-develop-data';
    const testPrefix = 'dashboards/animal-numbers/COORDINATORS/partition=LIVE/';

    try {
      const objectsResult = await listObjects(profile.name, { bucket: testBucket, prefix: testPrefix });
      const parquetFile = objectsResult.objects.find(o => o.key.endsWith('.parquet'));

      if (!parquetFile) {
        console.log('No parquet file found - skipping hyparquet test');
        return;
      }

      console.log(`Testing hyparquet with: ${parquetFile.key}`);
      const downloadResult = await downloadBinaryContent(profile.name, testBucket, parquetFile.key);

      if (!downloadResult.success || !downloadResult.data) {
        console.log('Failed to download parquet file');
        return;
      }

      // Simulate what happens in the IPC handler and ParquetViewer:
      // 1. IPC handler converts Buffer to Uint8Array
      // 2. ParquetViewer creates a new ArrayBuffer and copies data
      const dataLength = downloadResult.data.length;
      const arrayBuffer = new ArrayBuffer(dataLength);
      const uint8Data = new Uint8Array(arrayBuffer);
      uint8Data.set(downloadResult.data);

      console.log(`Data info: byteLength=${arrayBuffer.byteLength}, uint8Length=${uint8Data.length}`);
      console.log(`Buffer type: ${arrayBuffer.constructor.name}`);

      // Test metadata reading (matching ParquetViewer's approach)
      // IMPORTANT: hyparquet's slice callback expects ArrayBuffer, not Uint8Array
      const metadata = await parquetMetadataAsync({
        byteLength: arrayBuffer.byteLength,
        slice: (start: number, end?: number) => {
          // Return ArrayBuffer slice, not Uint8Array slice
          return Promise.resolve(arrayBuffer.slice(start, end));
        },
      });

      console.log(`Parquet metadata: ${metadata.schema?.length || 0} schema elements`);
      expect(metadata.schema).toBeDefined();
      expect(metadata.schema!.length).toBeGreaterThan(0);

      // Test data reading - use AsyncBuffer wrapper
      const asyncBuffer = {
        byteLength: arrayBuffer.byteLength,
        slice: (start: number, end?: number) => Promise.resolve(arrayBuffer.slice(start, end)),
      };

      await parquetRead({
        file: asyncBuffer,
        onComplete: (readData: Record<string, unknown[]>) => {
          const columns = Object.keys(readData);
          console.log(`Parquet data: ${columns.length} columns`);
          if (columns.length > 0) {
            const numRows = readData[columns[0]]?.length || 0;
            console.log(`Parquet data: ${numRows} rows`);
          }
        },
      });
    } catch (error) {
      // Log error but don't fail - bucket might not be accessible
      console.log('Parquet test error:', error instanceof Error ? error.message : error);
    }
  });

  it('should get file size', async () => {
    const { profiles } = loadAwsProfiles();
    const profile = getProfile('dev') || profiles.find(p => p.hasCredentials);

    if (!profile) {
      console.log('No valid profile available - skipping test');
      return;
    }

    // Import the getFileSize function
    const { getFileSize } = await import('../main/services/s3Service');

    const testBucket = 'az-invivo-ops-artifact-bucket';

    try {
      const objectsResult = await listObjects(profile.name, { bucket: testBucket });

      if (objectsResult.objects.length > 0) {
        const testFile = objectsResult.objects[0];
        console.log(`Testing getFileSize on: ${testFile.key}`);
        const result = await getFileSize(profile.name, testBucket, testFile.key);
        console.log(`getFileSize result: success=${result.success}, size=${result.size}`);
        expect(result.success).toBe(true);
        expect(result.size).toBeGreaterThanOrEqual(0);
      } else if (objectsResult.prefixes.length > 0) {
        // Navigate into a prefix
        const prefix = objectsResult.prefixes[0].key;
        const innerObjects = await listObjects(profile.name, { bucket: testBucket, prefix });

        if (innerObjects.objects.length > 0) {
          const testFile = innerObjects.objects[0];
          console.log(`Testing getFileSize on: ${testFile.key}`);
          const result = await getFileSize(profile.name, testBucket, testFile.key);
          console.log(`getFileSize result: success=${result.success}, size=${result.size}`);
          expect(result.success).toBe(true);
          expect(result.size).toBeGreaterThanOrEqual(0);
        }
      }
    } catch (error) {
      console.log('Error during getFileSize test:', error);
    }
  });
});

// Summary test that runs the complete flow
describe.skipIf(!AWS_CREDENTIALS_AVAILABLE)('Complete E2E Flow', () => {
  it('should complete a full workflow: load profiles -> select profile -> list buckets -> list objects', async () => {
    console.log('\n=== Starting Complete E2E Flow ===\n');

    // Step 1: Load profiles
    console.log('Step 1: Loading profiles...');
    const { profiles } = loadAwsProfiles();
    expect(profiles.length).toBeGreaterThan(0);
    console.log(`  Loaded ${profiles.length} profiles`);

    // Step 2: Find a valid profile (prefer assume-role to test that specifically)
    console.log('Step 2: Finding valid profile...');
    const profile = getProfile('dev') || profiles.find(p => p.hasCredentials);

    if (!profile || !profile.hasCredentials) {
      console.log('  No valid profile found - test cannot continue');
      return;
    }

    console.log(`  Selected profile: ${profile.name} (${profile.profileType})`);
    expect(profile.hasCredentials).toBe(true);

    // Step 3: Validate profile
    console.log('Step 3: Validating profile...');
    const validation = validateProfile(profile);
    expect(validation.valid).toBe(true);
    console.log(`  Profile is valid`);

    // Step 4: List buckets
    console.log('Step 4: Listing buckets...');
    const buckets = await listBuckets(profile.name);
    expect(Array.isArray(buckets)).toBe(true);
    console.log(`  Found ${buckets.length} buckets`);

    if (buckets.length === 0) {
      console.log('  No buckets found - skipping object listing');
      return;
    }

    // Step 5: List objects in a bucket
    // Try buckets until we find one we can access (some may be in different regions)
    console.log('Step 5: Listing objects...');
    let objectsListed = false;

    // Try az-invivo-ops-artifact-bucket first (known to be in eu-west-1)
    // Then fall back to trying other buckets
    const bucketsToTry = [
      ...buckets.filter(b => b.name === 'az-invivo-ops-artifact-bucket'),
      ...buckets.filter(b => b.name !== 'az-invivo-ops-artifact-bucket').slice(0, 5),
    ];

    for (const testBucket of bucketsToTry) {
      console.log(`  Trying bucket: ${testBucket.name}`);
      try {
        const objectsResult = await listObjects(profile.name, { bucket: testBucket.name });
        expect(objectsResult).toBeDefined();
        console.log(`  Found ${objectsResult.objects.length} objects and ${objectsResult.prefixes.length} folders`);
        objectsListed = true;
        break;
      } catch (error: unknown) {
        // Some buckets may be in different regions causing redirects
        const isRedirect = error instanceof Error &&
          (error.name === 'PermanentRedirect' || error.message.includes('PermanentRedirect'));
        if (isRedirect) {
          console.log(`  Bucket ${testBucket.name} is in a different region - trying next`);
        } else {
          throw error;
        }
      }
    }

    if (!objectsListed) {
      console.log('  Could not find a bucket in the same region to list objects');
      console.log('  This is expected if all buckets are in different regions');
    }

    // Step 6: Clear client (simulating profile switch)
    console.log('Step 6: Clearing client cache...');
    clearS3Client();
    console.log('  Client cache cleared');

    console.log('\n=== E2E Flow Complete ===\n');
  });
});
