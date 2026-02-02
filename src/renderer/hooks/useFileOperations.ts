import { useState, useCallback } from 'react';
import type { Operation } from '../components/OperationStatus';

let operationCounter = 0;

function generateOperationId(): string {
  return `op-${Date.now()}-${++operationCounter}`;
}

export interface DownloadCompleteInfo {
  fileName: string;
  localPath: string;
}

export interface UseFileOperationsOptions {
  onDownloadComplete?: (info: DownloadCompleteInfo) => void;
}

export interface DeleteFilesResult {
  success: boolean;
  deletedCount: number;
  failedCount: number;
}

export interface DeletePrefixResult {
  success: boolean;
  deletedCount: number;
  failedCount: number;
  error?: string;
}

export interface UseFileOperationsResult {
  operations: Operation[];
  isLoading: boolean;
  downloadFile: (bucket: string, key: string) => Promise<void>;
  uploadFiles: (bucket: string, prefix: string, filePaths?: string[]) => Promise<void>;
  deleteFile: (bucket: string, key: string) => Promise<boolean>;
  deleteFiles: (bucket: string, keys: string[]) => Promise<DeleteFilesResult>;
  deletePrefix: (bucket: string, prefix: string) => Promise<DeletePrefixResult>;
  renameFile: (bucket: string, sourceKey: string, newName: string) => Promise<boolean>;
  dismissOperation: (id: string) => void;
  clearCompleted: () => void;
}

export function useFileOperations(options: UseFileOperationsOptions = {}): UseFileOperationsResult {
  const { onDownloadComplete } = options;
  const [operations, setOperations] = useState<Operation[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const addOperation = useCallback((type: 'upload' | 'download', fileName: string): string => {
    const id = generateOperationId();
    setOperations((prev) => [
      ...prev,
      { id, type, fileName, status: 'pending' },
    ]);
    return id;
  }, []);

  const updateOperation = useCallback(
    (id: string, updates: Partial<Omit<Operation, 'id'>>) => {
      setOperations((prev) =>
        prev.map((op) => (op.id === id ? { ...op, ...updates } : op))
      );
    },
    []
  );

  const dismissOperation = useCallback((id: string) => {
    setOperations((prev) => prev.filter((op) => op.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setOperations((prev) =>
      prev.filter((op) => op.status !== 'completed' && op.status !== 'error')
    );
  }, []);

  const downloadFile = useCallback(async (bucket: string, key: string) => {
    const fileName = key.split('/').pop() || key;
    const opId = addOperation('download', fileName);

    updateOperation(opId, { status: 'in-progress' });

    try {
      const result = await window.electronAPI.s3.downloadFile(bucket, key, opId);

      if (result.success) {
        updateOperation(opId, { status: 'completed' });
        // Auto-dismiss after 3 seconds
        setTimeout(() => dismissOperation(opId), 3000);
        // Notify about completed download with local path
        if (result.localPath && onDownloadComplete) {
          onDownloadComplete({ fileName, localPath: result.localPath });
        }
      } else {
        updateOperation(opId, { status: 'error', error: result.error });
      }
    } catch (error) {
      updateOperation(opId, {
        status: 'error',
        error: error instanceof Error ? error.message : 'Download failed',
      });
    }
  }, [addOperation, updateOperation, dismissOperation, onDownloadComplete]);

  const uploadFiles = useCallback(
    async (bucket: string, prefix: string, filePaths?: string[]) => {
      setIsLoading(true);

      try {
        // If no file paths provided, show file picker
        let paths = filePaths;
        if (!paths) {
          paths = await window.electronAPI.s3.showOpenDialog() ?? undefined;
          if (!paths || paths.length === 0) {
            setIsLoading(false);
            return;
          }
        }

        // Create operations for each file
        const opIds: { path: string; id: string; fileName: string }[] = paths.map((p) => {
          const fileName = p.split(/[/\\]/).pop() || p;
          return { path: p, id: addOperation('upload', fileName), fileName };
        });

        // Upload files
        for (const { path, id } of opIds) {
          updateOperation(id, { status: 'in-progress' });
        }

        const result = await window.electronAPI.s3.uploadFiles(bucket, prefix, paths, generateOperationId());

        // Update operation statuses
        result.results.forEach((r, idx) => {
          const op = opIds[idx];
          if (r.success) {
            updateOperation(op.id, { status: 'completed' });
            // Auto-dismiss after 3 seconds
            setTimeout(() => dismissOperation(op.id), 3000);
          } else {
            updateOperation(op.id, { status: 'error', error: r.error });
          }
        });
      } catch (error) {
        // Error already handled per-file
      } finally {
        setIsLoading(false);
      }
    },
    [addOperation, updateOperation, dismissOperation]
  );

  const deleteFile = useCallback(async (bucket: string, key: string): Promise<boolean> => {
    setIsLoading(true);

    try {
      const result = await window.electronAPI.s3.deleteFile(bucket, key);
      return result.success;
    } catch {
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteFiles = useCallback(async (bucket: string, keys: string[]): Promise<DeleteFilesResult> => {
    setIsLoading(true);

    try {
      const result = await window.electronAPI.s3.deleteFiles(bucket, keys);
      return {
        success: result.success,
        deletedCount: result.deletedCount,
        failedCount: result.failedCount,
      };
    } catch {
      return {
        success: false,
        deletedCount: 0,
        failedCount: keys.length,
      };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deletePrefix = useCallback(async (bucket: string, prefix: string): Promise<DeletePrefixResult> => {
    setIsLoading(true);

    try {
      const result = await window.electronAPI.s3.deletePrefix(bucket, prefix);
      return {
        success: result.success,
        deletedCount: result.deletedCount,
        failedCount: result.failedCount,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        deletedCount: 0,
        failedCount: 0,
        error: error instanceof Error ? error.message : 'Delete failed',
      };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const renameFile = useCallback(
    async (bucket: string, sourceKey: string, newName: string): Promise<boolean> => {
      setIsLoading(true);

      try {
        const result = await window.electronAPI.s3.renameFile(bucket, sourceKey, newName);
        return result.success;
      } catch {
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  return {
    operations,
    isLoading,
    downloadFile,
    uploadFiles,
    deleteFile,
    deleteFiles,
    deletePrefix,
    renameFile,
    dismissOperation,
    clearCompleted,
  };
}
