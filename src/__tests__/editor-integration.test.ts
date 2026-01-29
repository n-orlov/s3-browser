/**
 * Integration tests specifically for TextEditor and ParquetViewer flows
 * These tests simulate the exact data flow that happens when editing/viewing files
 */
import { describe, it, expect } from 'vitest';
import {
  getFileSize,
  downloadContent,
  downloadBinaryContent,
  listObjects,
} from '../main/services/s3Service';
import { loadAwsProfiles, getProfile } from '../main/services/awsCredentials';
import { parquetMetadataAsync, parquetRead } from 'hyparquet';
import * as fs from 'fs';
import * as os from 'os';

// Skip these tests in CI environments without AWS credentials
const AWS_CREDENTIALS_AVAILABLE = process.env.AWS_ACCESS_KEY_ID ||
  fs.existsSync(`${os.homedir()}/.aws/credentials`);

describe.skipIf(!AWS_CREDENTIALS_AVAILABLE)('TextEditor Integration', () => {
  it('should complete the full TextEditor flow: getFileSize -> downloadContent', async () => {
    const { profiles } = loadAwsProfiles();
    const profile = getProfile('dev') || profiles.find(p => p.hasCredentials);

    if (!profile) {
      console.log('No valid profile available - skipping test');
      return;
    }

    // Use a test bucket with known text files
    const testBucket = 'az-invivo-ops-artifact-bucket';
    const testPrefix = 'EST-5962/';

    try {
      // Step 1: List objects to find a text file
      console.log('Step 1: Listing objects...');
      const objectsResult = await listObjects(profile.name, { bucket: testBucket, prefix: testPrefix });
      console.log(`Found ${objectsResult.objects.length} objects, ${objectsResult.prefixes.length} prefixes`);

      // Find a text file to edit
      let textFile = objectsResult.objects.find(o =>
        o.key.endsWith('.txt') || o.key.endsWith('.json') || o.key.endsWith('.yaml') || o.key.endsWith('.md')
      );

      // If no text file in prefix, try navigating into a folder
      if (!textFile && objectsResult.prefixes.length > 0) {
        const innerResult = await listObjects(profile.name, { bucket: testBucket, prefix: objectsResult.prefixes[0].key });
        textFile = innerResult.objects.find(o =>
          o.key.endsWith('.txt') || o.key.endsWith('.json') || o.key.endsWith('.yaml') || o.key.endsWith('.md')
        );
      }

      if (!textFile) {
        console.log('No text file found for testing');
        return;
      }

      console.log(`Found text file: ${textFile.key} (size: ${textFile.size})`);

      // Step 2: Get file size (this is what TextEditor does first)
      console.log('Step 2: Getting file size...');
      const sizeResult = await getFileSize(profile.name, testBucket, textFile.key);
      console.log(`getFileSize result: success=${sizeResult.success}, size=${sizeResult.size}, error=${sizeResult.error}`);

      expect(sizeResult.success).toBe(true);
      expect(sizeResult.size).toBeDefined();

      // Step 3: Download content (this is what TextEditor does second)
      console.log('Step 3: Downloading content...');
      const contentResult = await downloadContent(profile.name, testBucket, textFile.key);
      console.log(`downloadContent result: success=${contentResult.success}, contentLength=${contentResult.content?.length}, error=${contentResult.error}`);

      expect(contentResult.success).toBe(true);
      expect(contentResult.content).toBeDefined();
      if (contentResult.content) {
        console.log(`Content preview: ${contentResult.content.substring(0, 100)}...`);
      }

    } catch (error) {
      console.error('Test error:', error);
      throw error;
    }
  });
});

describe.skipIf(!AWS_CREDENTIALS_AVAILABLE)('ParquetViewer Integration', () => {
  it('should complete the full ParquetViewer flow: download -> create ArrayBuffer -> read metadata', async () => {
    const { profiles } = loadAwsProfiles();
    const profile = getProfile('dev') || profiles.find(p => p.hasCredentials);

    if (!profile) {
      console.log('No valid profile available - skipping test');
      return;
    }

    const testBucket = 'az-invp-ivc-develop-data';
    const testPrefix = 'dashboards/animal-numbers/COORDINATORS/partition=LIVE/';

    try {
      // Step 1: List objects to find a parquet file
      console.log('Step 1: Listing objects...');
      const objectsResult = await listObjects(profile.name, { bucket: testBucket, prefix: testPrefix });
      console.log(`Found ${objectsResult.objects.length} objects`);

      const parquetFile = objectsResult.objects.find(o => o.key.endsWith('.parquet'));

      if (!parquetFile) {
        console.log('No parquet file found - skipping');
        return;
      }

      console.log(`Found parquet file: ${parquetFile.key} (size: ${parquetFile.size})`);

      // Step 2: Download binary content
      console.log('Step 2: Downloading binary content...');
      const downloadResult = await downloadBinaryContent(profile.name, testBucket, parquetFile.key);
      console.log(`downloadBinaryContent result: success=${downloadResult.success}, dataLength=${downloadResult.data?.length}, error=${downloadResult.error}`);

      expect(downloadResult.success).toBe(true);
      expect(downloadResult.data).toBeDefined();

      if (!downloadResult.data) return;

      // Step 3: Simulate what the IPC handler does - convert Buffer to Uint8Array
      // (this is done in the main process before sending to renderer)
      console.log('Step 3: Converting to Uint8Array (simulating IPC handler)...');
      const uint8FromHandler = new Uint8Array(downloadResult.data);
      console.log(`Uint8Array created: length=${uint8FromHandler.length}, byteLength=${uint8FromHandler.byteLength}`);

      // Step 4: Simulate what ParquetViewer does - create fresh ArrayBuffer
      // (this is done in the renderer after receiving data via IPC)
      console.log('Step 4: Creating fresh ArrayBuffer (simulating renderer)...');
      const dataLength = uint8FromHandler.length;
      const arrayBuffer = new ArrayBuffer(dataLength);
      const uint8Data = new Uint8Array(arrayBuffer);
      uint8Data.set(uint8FromHandler);

      console.log(`Fresh ArrayBuffer: byteLength=${arrayBuffer.byteLength}`);
      console.log(`First 4 bytes (PAR1 magic): ${Array.from(uint8Data.slice(0, 4)).map(b => b.toString(16)).join(' ')}`);

      // Step 5: Read parquet metadata using hyparquet
      console.log('Step 5: Reading parquet metadata...');
      const metadata = await parquetMetadataAsync({
        byteLength: arrayBuffer.byteLength,
        slice: (start: number, end?: number) => {
          console.log(`  slice called: start=${start}, end=${end}`);
          return Promise.resolve(arrayBuffer.slice(start, end));
        },
      });

      console.log(`Metadata result: schema has ${metadata.schema?.length || 0} elements`);
      if (metadata.schema) {
        metadata.schema.forEach((col, i) => {
          console.log(`  Column ${i}: name=${col.name}, type=${col.type}`);
        });
      }

      expect(metadata.schema).toBeDefined();
      expect(metadata.schema!.length).toBeGreaterThan(0);

      // Step 6: Read actual parquet data using AsyncBuffer wrapper
      // hyparquet expects file to have byteLength and slice() returning Promise<ArrayBuffer>
      console.log('Step 6: Reading parquet data...');
      const asyncBuffer = {
        byteLength: arrayBuffer.byteLength,
        slice: (start: number, end?: number) => Promise.resolve(arrayBuffer.slice(start, end)),
      };

      let dataRead = false;
      await parquetRead({
        file: asyncBuffer,
        onComplete: (readData: Record<string, unknown[]>) => {
          const columns = Object.keys(readData);
          console.log(`Data columns: ${columns.join(', ')}`);
          if (columns.length > 0) {
            const numRows = readData[columns[0]]?.length || 0;
            console.log(`Number of rows: ${numRows}`);
            dataRead = true;
          }
        },
      });

      // Note: Some parquet files might have 0 rows, that's OK
      console.log(`Data read completed: ${dataRead ? 'data found' : 'no data or empty'}`);

    } catch (error) {
      console.error('Test error:', error);
      throw error;
    }
  });
});
