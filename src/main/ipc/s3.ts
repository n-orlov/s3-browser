import { ipcMain, app, dialog, shell } from 'electron';
import * as path from 'path';
import {
  listBuckets,
  listObjects,
  listAllObjects,
  parseS3Url,
  getParentPrefix,
  getKeyName,
  clearS3Client,
  downloadFile,
  uploadFile,
  uploadContent,
  downloadContent,
  downloadBinaryContent,
  deleteFile,
  deleteFiles,
  deletePrefix,
  renameFile,
  copyFile,
  getFileSize,
  getObjectMetadata,
  createEmptyFile,
  createFolder,
  type S3Bucket,
  type S3Object,
  type ListObjectsResult,
  type ListObjectsOptions,
  type FileOperationResult,
  type DeleteFilesResult,
  type DeletePrefixResult,
  type ObjectMetadata,
} from '../services/s3Service';
import { getCurrentProfileCredentials } from './credentials';
import { isGzipFile, decompressGzip, compressGzip } from '../services/gzipUtils';

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

  // Download a file from S3 to the downloads folder
  ipcMain.handle(
    's3:download-file',
    async (
      _event,
      bucket: string,
      key: string,
      operationId: string
    ): Promise<FileOperationResult & { localPath?: string }> => {
      try {
        const profileName = getCurrentProfile();

        // Get the downloads folder path
        const downloadsPath = app.getPath('downloads');
        const fileName = getKeyName(key);
        let destinationPath = path.join(downloadsPath, fileName);

        // If file exists, add a number suffix
        let counter = 1;
        const ext = path.extname(fileName);
        const baseName = path.basename(fileName, ext);
        while (await fileExists(destinationPath)) {
          destinationPath = path.join(downloadsPath, `${baseName} (${counter})${ext}`);
          counter++;
        }

        // Create abort controller for this operation
        const abortController = new AbortController();
        abortControllers.set(operationId, abortController);

        try {
          const result = await downloadFile(
            profileName,
            bucket,
            key,
            destinationPath,
            undefined, // Progress callback could be added with IPC events
            abortController.signal
          );

          if (result.success) {
            return { ...result, localPath: destinationPath };
          }
          return result;
        } finally {
          abortControllers.delete(operationId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: message };
      }
    }
  );

  // Upload a file to S3
  ipcMain.handle(
    's3:upload-file',
    async (
      _event,
      bucket: string,
      prefix: string,
      filePath: string,
      operationId: string
    ): Promise<FileOperationResult> => {
      try {
        const profileName = getCurrentProfile();

        // Build the S3 key from prefix + filename
        const fileName = path.basename(filePath);
        const key = prefix ? `${prefix}${fileName}` : fileName;

        // Create abort controller for this operation
        const abortController = new AbortController();
        abortControllers.set(operationId, abortController);

        try {
          return await uploadFile(profileName, bucket, key, filePath, undefined, abortController.signal);
        } finally {
          abortControllers.delete(operationId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: message };
      }
    }
  );

  // Upload multiple files
  ipcMain.handle(
    's3:upload-files',
    async (
      _event,
      bucket: string,
      prefix: string,
      filePaths: string[],
      operationId: string
    ): Promise<{ success: boolean; results: Array<{ path: string; success: boolean; error?: string }> }> => {
      try {
        const profileName = getCurrentProfile();
        const results: Array<{ path: string; success: boolean; error?: string }> = [];

        // Create abort controller for this operation
        const abortController = new AbortController();
        abortControllers.set(operationId, abortController);

        try {
          for (const filePath of filePaths) {
            if (abortController.signal.aborted) {
              results.push({ path: filePath, success: false, error: 'Operation cancelled' });
              continue;
            }

            const fileName = path.basename(filePath);
            const key = prefix ? `${prefix}${fileName}` : fileName;
            const result = await uploadFile(profileName, bucket, key, filePath, undefined, abortController.signal);
            results.push({ path: filePath, ...result });
          }

          return { success: results.every(r => r.success), results };
        } finally {
          abortControllers.delete(operationId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, results: [] };
      }
    }
  );

  // Delete a file from S3
  ipcMain.handle(
    's3:delete-file',
    async (_event, bucket: string, key: string): Promise<FileOperationResult> => {
      try {
        const profileName = getCurrentProfile();
        return await deleteFile(profileName, bucket, key);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: message };
      }
    }
  );

  // Delete multiple files from S3
  ipcMain.handle(
    's3:delete-files',
    async (_event, bucket: string, keys: string[]): Promise<DeleteFilesResult> => {
      try {
        const profileName = getCurrentProfile();
        return await deleteFiles(profileName, bucket, keys);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, results: [], deletedCount: 0, failedCount: keys.length };
      }
    }
  );

  // Delete a prefix (folder) and all its contents from S3
  ipcMain.handle(
    's3:delete-prefix',
    async (_event, bucket: string, prefix: string): Promise<DeletePrefixResult> => {
      try {
        const profileName = getCurrentProfile();
        return await deletePrefix(profileName, bucket, prefix);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, deletedCount: 0, failedCount: 0, error: message };
      }
    }
  );

  // Rename a file in S3
  ipcMain.handle(
    's3:rename-file',
    async (_event, bucket: string, sourceKey: string, newName: string): Promise<FileOperationResult> => {
      try {
        const profileName = getCurrentProfile();

        // Build the new key with the same prefix but different name
        const parentPrefix = getParentPrefix(sourceKey);
        const destinationKey = parentPrefix + newName;

        return await renameFile(profileName, bucket, sourceKey, destinationKey);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: message };
      }
    }
  );

  // Copy a file in S3
  ipcMain.handle(
    's3:copy-file',
    async (
      _event,
      sourceBucket: string,
      sourceKey: string,
      destinationBucket: string,
      destinationKey: string
    ): Promise<FileOperationResult> => {
      try {
        const profileName = getCurrentProfile();
        return await copyFile(profileName, sourceBucket, sourceKey, destinationBucket, destinationKey);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: message };
      }
    }
  );

  // Upload content directly (for editor save)
  // Automatically compresses content for .gz files
  ipcMain.handle(
    's3:upload-content',
    async (_event, bucket: string, key: string, content: string): Promise<FileOperationResult> => {
      try {
        const profileName = getCurrentProfile();

        // For .gz files, compress content before upload
        if (isGzipFile(key)) {
          try {
            const compressedBuffer = await compressGzip(content);
            return await uploadContent(profileName, bucket, key, compressedBuffer);
          } catch (compressError) {
            const message = compressError instanceof Error
              ? compressError.message
              : 'Failed to compress file';
            return { success: false, error: `Gzip compression failed: ${message}` };
          }
        }

        // For non-gz files, use regular upload
        return await uploadContent(profileName, bucket, key, content);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: message };
      }
    }
  );

  // Download content directly (for editor load)
  // Automatically decompresses .gz files
  ipcMain.handle(
    's3:download-content',
    async (_event, bucket: string, key: string): Promise<{ success: boolean; content?: string; error?: string }> => {
      try {
        const profileName = getCurrentProfile();

        // For .gz files, download as binary and decompress
        if (isGzipFile(key)) {
          const result = await downloadBinaryContent(profileName, bucket, key);
          if (!result.success || !result.data) {
            return { success: false, error: result.error || 'Failed to download file' };
          }

          try {
            const content = await decompressGzip(result.data);
            return { success: true, content };
          } catch (decompressError) {
            const message = decompressError instanceof Error
              ? decompressError.message
              : 'Failed to decompress file';
            return { success: false, error: `Gzip decompression failed: ${message}` };
          }
        }

        // For non-gz files, use the regular download
        return await downloadContent(profileName, bucket, key);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: message };
      }
    }
  );

  // Get file size
  ipcMain.handle(
    's3:get-file-size',
    async (_event, bucket: string, key: string): Promise<{ success: boolean; size?: number; error?: string }> => {
      try {
        const profileName = getCurrentProfile();
        return await getFileSize(profileName, bucket, key);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: message };
      }
    }
  );

  // Download binary content (for parquet files)
  ipcMain.handle(
    's3:download-binary-content',
    async (_event, bucket: string, key: string): Promise<{ success: boolean; data?: Uint8Array; error?: string }> => {
      try {
        const profileName = getCurrentProfile();
        const result = await downloadBinaryContent(profileName, bucket, key);
        if (result.success && result.data) {
          // Convert Buffer to Uint8Array for IPC transfer
          return { success: true, data: new Uint8Array(result.data) };
        }
        return { success: false, error: result.error };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: message };
      }
    }
  );

  // Open file dialog for selecting files to upload
  ipcMain.handle('s3:show-open-dialog', async (): Promise<string[] | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Select files to upload',
    });

    if (result.canceled) {
      return null;
    }

    return result.filePaths;
  });

  // Open the downloads folder in system explorer
  ipcMain.handle('s3:open-downloads-folder', async (): Promise<void> => {
    const downloadsPath = app.getPath('downloads');
    await shell.openPath(downloadsPath);
  });

  // Show file in folder
  ipcMain.handle('s3:show-file-in-folder', async (_event, filePath: string): Promise<void> => {
    shell.showItemInFolder(filePath);
  });

  // Get object metadata
  ipcMain.handle(
    's3:get-object-metadata',
    async (_event, bucket: string, key: string): Promise<{ success: boolean; metadata?: ObjectMetadata; error?: string }> => {
      try {
        const profileName = getCurrentProfile();
        return await getObjectMetadata(profileName, bucket, key);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: message };
      }
    }
  );

  // Create an empty file in S3
  ipcMain.handle(
    's3:create-file',
    async (_event, bucket: string, key: string): Promise<FileOperationResult> => {
      try {
        const profileName = getCurrentProfile();
        return await createEmptyFile(profileName, bucket, key);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: message };
      }
    }
  );

  // Create a folder in S3
  ipcMain.handle(
    's3:create-folder',
    async (_event, bucket: string, prefix: string): Promise<FileOperationResult> => {
      try {
        const profileName = getCurrentProfile();
        return await createFolder(profileName, bucket, prefix);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: message };
      }
    }
  );
}

/**
 * Helper to check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await require('fs').promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}
