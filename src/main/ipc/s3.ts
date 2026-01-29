import { ipcMain } from 'electron';
import {
  listBuckets,
  listObjects,
  listAllObjects,
  parseS3Url,
  getParentPrefix,
  getKeyName,
  clearS3Client,
  type S3Bucket,
  type S3Object,
  type ListObjectsResult,
  type ListObjectsOptions,
} from '../services/s3Service';
import { getCurrentProfileCredentials } from './credentials';

// Abort controllers for cancellable operations
const abortControllers = new Map<string, AbortController>();

export interface S3ListBucketsResult {
  success: boolean;
  buckets?: S3Bucket[];
  error?: string;
}

export interface S3ListObjectsResult {
  success: boolean;
  result?: ListObjectsResult;
  error?: string;
}

export interface S3ParseUrlResult {
  success: boolean;
  bucket?: string;
  key?: string;
  error?: string;
}

/**
 * Gets the current profile name or throws if no profile is selected
 */
function getCurrentProfile(): string {
  const profile = getCurrentProfileCredentials();
  if (!profile) {
    throw new Error('No AWS profile selected. Please select a profile first.');
  }
  return profile.name;
}

/**
 * Register IPC handlers for S3 operations
 */
export function registerS3Ipc(): void {
  // List all buckets
  ipcMain.handle('s3:list-buckets', async (): Promise<S3ListBucketsResult> => {
    try {
      const profileName = getCurrentProfile();
      const buckets = await listBuckets(profileName);
      return { success: true, buckets };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      return { success: false, error: message };
    }
  });

  // List objects in a bucket with pagination support
  ipcMain.handle(
    's3:list-objects',
    async (_event, options: ListObjectsOptions): Promise<S3ListObjectsResult> => {
      try {
        const profileName = getCurrentProfile();
        const result = await listObjects(profileName, options);
        return { success: true, result };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: message };
      }
    }
  );

  // List all objects (with pagination handled internally) - supports cancellation
  ipcMain.handle(
    's3:list-all-objects',
    async (
      _event,
      options: Omit<ListObjectsOptions, 'continuationToken'>,
      operationId: string
    ): Promise<S3ListObjectsResult> => {
      try {
        const profileName = getCurrentProfile();

        // Create abort controller for this operation
        const abortController = new AbortController();
        abortControllers.set(operationId, abortController);

        try {
          const result = await listAllObjects(
            profileName,
            options,
            (count) => {
              // Send progress updates to renderer
              // Note: This would require additional IPC setup for progress events
              // For now, we'll handle progress in the UI layer
            },
            abortController.signal
          );
          return { success: true, result };
        } finally {
          // Clean up abort controller
          abortControllers.delete(operationId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: message };
      }
    }
  );

  // Cancel a running operation
  ipcMain.handle('s3:cancel-operation', async (_event, operationId: string): Promise<boolean> => {
    const controller = abortControllers.get(operationId);
    if (controller) {
      controller.abort();
      abortControllers.delete(operationId);
      return true;
    }
    return false;
  });

  // Parse an S3 URL
  ipcMain.handle('s3:parse-url', async (_event, url: string): Promise<S3ParseUrlResult> => {
    try {
      const parsed = parseS3Url(url);
      if (!parsed) {
        return { success: false, error: 'Invalid S3 URL format' };
      }
      return {
        success: true,
        bucket: parsed.bucket,
        key: parsed.key,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      return { success: false, error: message };
    }
  });

  // Get parent prefix
  ipcMain.handle('s3:get-parent-prefix', async (_event, keyOrPrefix: string): Promise<string> => {
    return getParentPrefix(keyOrPrefix);
  });

  // Get key name
  ipcMain.handle('s3:get-key-name', async (_event, keyOrPrefix: string): Promise<string> => {
    return getKeyName(keyOrPrefix);
  });

  // Clear cached S3 client (called when profile changes)
  ipcMain.handle('s3:clear-client', async (): Promise<void> => {
    clearS3Client();
  });
}
