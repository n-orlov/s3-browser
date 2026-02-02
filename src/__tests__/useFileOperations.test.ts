import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileOperations } from '../renderer/hooks/useFileOperations';

// Mock the window.electronAPI
const mockElectronAPI = {
  s3: {
    downloadFile: vi.fn(),
    uploadFiles: vi.fn(),
    deleteFile: vi.fn(),
    deleteFiles: vi.fn(),
    deletePrefix: vi.fn(),
    renameFile: vi.fn(),
    showOpenDialog: vi.fn(),
  },
};

// Declare global window type
declare global {
  interface Window {
    electronAPI: typeof mockElectronAPI;
  }
}

// Set up the mock before tests
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('useFileOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have empty operations array', () => {
      const { result } = renderHook(() => useFileOperations());
      expect(result.current.operations).toEqual([]);
    });

    it('should have isLoading as false', () => {
      const { result } = renderHook(() => useFileOperations());
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('downloadFile', () => {
    it('should add operation and update status on success', async () => {
      mockElectronAPI.s3.downloadFile.mockResolvedValue({ success: true, localPath: '/downloads/file.txt' });

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.downloadFile('test-bucket', 'folder/file.txt');
      });

      // Operation should be added with completed status
      expect(result.current.operations).toHaveLength(1);
      expect(result.current.operations[0].type).toBe('download');
      expect(result.current.operations[0].fileName).toBe('file.txt');
      expect(result.current.operations[0].status).toBe('completed');
    });

    it('should handle download error', async () => {
      mockElectronAPI.s3.downloadFile.mockResolvedValue({ success: false, error: 'Access denied' });

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.downloadFile('test-bucket', 'file.txt');
      });

      expect(result.current.operations[0].status).toBe('error');
      expect(result.current.operations[0].error).toBe('Access denied');
    });

    it('should call onDownloadComplete callback with file info on success', async () => {
      const localPath = '/downloads/my-file.txt';
      mockElectronAPI.s3.downloadFile.mockResolvedValue({ success: true, localPath });

      const onDownloadComplete = vi.fn();
      const { result } = renderHook(() => useFileOperations({ onDownloadComplete }));

      await act(async () => {
        await result.current.downloadFile('test-bucket', 'folder/my-file.txt');
      });

      expect(onDownloadComplete).toHaveBeenCalledTimes(1);
      expect(onDownloadComplete).toHaveBeenCalledWith({
        fileName: 'my-file.txt',
        localPath: '/downloads/my-file.txt',
      });
    });

    it('should not call onDownloadComplete callback on error', async () => {
      mockElectronAPI.s3.downloadFile.mockResolvedValue({ success: false, error: 'Failed' });

      const onDownloadComplete = vi.fn();
      const { result } = renderHook(() => useFileOperations({ onDownloadComplete }));

      await act(async () => {
        await result.current.downloadFile('test-bucket', 'file.txt');
      });

      expect(onDownloadComplete).not.toHaveBeenCalled();
    });

    it('should not call onDownloadComplete callback if localPath is missing', async () => {
      mockElectronAPI.s3.downloadFile.mockResolvedValue({ success: true }); // No localPath

      const onDownloadComplete = vi.fn();
      const { result } = renderHook(() => useFileOperations({ onDownloadComplete }));

      await act(async () => {
        await result.current.downloadFile('test-bucket', 'file.txt');
      });

      expect(onDownloadComplete).not.toHaveBeenCalled();
    });
  });

  describe('uploadFiles', () => {
    it('should show file dialog when no paths provided', async () => {
      mockElectronAPI.s3.showOpenDialog.mockResolvedValue(['/path/to/file1.txt', '/path/to/file2.txt']);
      mockElectronAPI.s3.uploadFiles.mockResolvedValue({
        success: true,
        results: [
          { path: '/path/to/file1.txt', success: true },
          { path: '/path/to/file2.txt', success: true },
        ],
      });

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.uploadFiles('test-bucket', 'prefix/');
      });

      expect(mockElectronAPI.s3.showOpenDialog).toHaveBeenCalled();
      expect(result.current.operations).toHaveLength(2);
    });

    it('should use provided file paths', async () => {
      mockElectronAPI.s3.uploadFiles.mockResolvedValue({
        success: true,
        results: [{ path: '/my/file.txt', success: true }],
      });

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.uploadFiles('test-bucket', 'prefix/', ['/my/file.txt']);
      });

      expect(mockElectronAPI.s3.showOpenDialog).not.toHaveBeenCalled();
      expect(result.current.operations).toHaveLength(1);
      expect(result.current.operations[0].status).toBe('completed');
    });

    it('should handle cancelled file dialog', async () => {
      mockElectronAPI.s3.showOpenDialog.mockResolvedValue(null);

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.uploadFiles('test-bucket', 'prefix/');
      });

      expect(result.current.operations).toHaveLength(0);
    });

    it('should handle partial upload failure', async () => {
      mockElectronAPI.s3.uploadFiles.mockResolvedValue({
        success: false,
        results: [
          { path: '/path/file1.txt', success: true },
          { path: '/path/file2.txt', success: false, error: 'Access denied' },
        ],
      });

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.uploadFiles('test-bucket', '', ['/path/file1.txt', '/path/file2.txt']);
      });

      expect(result.current.operations).toHaveLength(2);
      expect(result.current.operations[0].status).toBe('completed');
      expect(result.current.operations[1].status).toBe('error');
      expect(result.current.operations[1].error).toBe('Access denied');
    });
  });

  describe('deleteFile', () => {
    it('should return true on success', async () => {
      mockElectronAPI.s3.deleteFile.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useFileOperations());

      let deleteResult: boolean = false;
      await act(async () => {
        deleteResult = await result.current.deleteFile('test-bucket', 'file.txt');
      });

      expect(deleteResult).toBe(true);
    });

    it('should return false on failure', async () => {
      mockElectronAPI.s3.deleteFile.mockResolvedValue({ success: false, error: 'Access denied' });

      const { result } = renderHook(() => useFileOperations());

      let deleteResult: boolean = true;
      await act(async () => {
        deleteResult = await result.current.deleteFile('test-bucket', 'file.txt');
      });

      expect(deleteResult).toBe(false);
    });

    it('should set isLoading during operation', async () => {
      let resolvePromise: (value: { success: boolean }) => void;
      mockElectronAPI.s3.deleteFile.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const { result } = renderHook(() => useFileOperations());

      expect(result.current.isLoading).toBe(false);

      let deletePromise: Promise<boolean>;
      act(() => {
        deletePromise = result.current.deleteFile('test-bucket', 'file.txt');
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolvePromise!({ success: true });
        await deletePromise;
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('deleteFiles (batch)', () => {
    it('should return success result when all files deleted', async () => {
      mockElectronAPI.s3.deleteFiles.mockResolvedValue({
        success: true,
        results: [
          { key: 'file1.txt', success: true },
          { key: 'file2.txt', success: true },
        ],
        deletedCount: 2,
        failedCount: 0,
      });

      const { result } = renderHook(() => useFileOperations());

      let deleteResult: { success: boolean; deletedCount: number; failedCount: number };
      await act(async () => {
        deleteResult = await result.current.deleteFiles('test-bucket', ['file1.txt', 'file2.txt']);
      });

      expect(deleteResult!.success).toBe(true);
      expect(deleteResult!.deletedCount).toBe(2);
      expect(deleteResult!.failedCount).toBe(0);
    });

    it('should return partial result when some files fail', async () => {
      mockElectronAPI.s3.deleteFiles.mockResolvedValue({
        success: false,
        results: [
          { key: 'file1.txt', success: true },
          { key: 'file2.txt', success: false, error: 'Access denied' },
        ],
        deletedCount: 1,
        failedCount: 1,
      });

      const { result } = renderHook(() => useFileOperations());

      let deleteResult: { success: boolean; deletedCount: number; failedCount: number };
      await act(async () => {
        deleteResult = await result.current.deleteFiles('test-bucket', ['file1.txt', 'file2.txt']);
      });

      expect(deleteResult!.success).toBe(false);
      expect(deleteResult!.deletedCount).toBe(1);
      expect(deleteResult!.failedCount).toBe(1);
    });

    it('should handle exception gracefully', async () => {
      mockElectronAPI.s3.deleteFiles.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useFileOperations());

      let deleteResult: { success: boolean; deletedCount: number; failedCount: number };
      await act(async () => {
        deleteResult = await result.current.deleteFiles('test-bucket', ['file1.txt', 'file2.txt', 'file3.txt']);
      });

      expect(deleteResult!.success).toBe(false);
      expect(deleteResult!.deletedCount).toBe(0);
      expect(deleteResult!.failedCount).toBe(3);
    });

    it('should set isLoading during batch delete operation', async () => {
      let resolvePromise: (value: any) => void;
      mockElectronAPI.s3.deleteFiles.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const { result } = renderHook(() => useFileOperations());

      expect(result.current.isLoading).toBe(false);

      let deletePromise: Promise<{ success: boolean; deletedCount: number; failedCount: number }>;
      act(() => {
        deletePromise = result.current.deleteFiles('test-bucket', ['file1.txt']);
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolvePromise!({ success: true, results: [], deletedCount: 1, failedCount: 0 });
        await deletePromise;
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('deletePrefix', () => {
    it('should return success result when prefix deletion succeeds', async () => {
      mockElectronAPI.s3.deletePrefix.mockResolvedValue({
        success: true,
        deletedCount: 5,
        failedCount: 0,
      });

      const { result } = renderHook(() => useFileOperations());

      let deleteResult: { success: boolean; deletedCount: number; failedCount: number; error?: string };
      await act(async () => {
        deleteResult = await result.current.deletePrefix('test-bucket', 'folder/');
      });

      expect(deleteResult!.success).toBe(true);
      expect(deleteResult!.deletedCount).toBe(5);
      expect(deleteResult!.failedCount).toBe(0);
      expect(deleteResult!.error).toBeUndefined();
    });

    it('should return partial result when some objects fail to delete', async () => {
      mockElectronAPI.s3.deletePrefix.mockResolvedValue({
        success: false,
        deletedCount: 3,
        failedCount: 2,
      });

      const { result } = renderHook(() => useFileOperations());

      let deleteResult: { success: boolean; deletedCount: number; failedCount: number; error?: string };
      await act(async () => {
        deleteResult = await result.current.deletePrefix('test-bucket', 'folder/');
      });

      expect(deleteResult!.success).toBe(false);
      expect(deleteResult!.deletedCount).toBe(3);
      expect(deleteResult!.failedCount).toBe(2);
    });

    it('should return error message when operation fails', async () => {
      mockElectronAPI.s3.deletePrefix.mockResolvedValue({
        success: false,
        deletedCount: 0,
        failedCount: 0,
        error: 'Operation aborted',
      });

      const { result } = renderHook(() => useFileOperations());

      let deleteResult: { success: boolean; deletedCount: number; failedCount: number; error?: string };
      await act(async () => {
        deleteResult = await result.current.deletePrefix('test-bucket', 'folder/');
      });

      expect(deleteResult!.success).toBe(false);
      expect(deleteResult!.error).toBe('Operation aborted');
    });

    it('should handle exception gracefully', async () => {
      mockElectronAPI.s3.deletePrefix.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useFileOperations());

      let deleteResult: { success: boolean; deletedCount: number; failedCount: number; error?: string };
      await act(async () => {
        deleteResult = await result.current.deletePrefix('test-bucket', 'folder/');
      });

      expect(deleteResult!.success).toBe(false);
      expect(deleteResult!.deletedCount).toBe(0);
      expect(deleteResult!.failedCount).toBe(0);
      expect(deleteResult!.error).toBe('Network error');
    });

    it('should handle non-Error exception gracefully', async () => {
      mockElectronAPI.s3.deletePrefix.mockRejectedValue('Unknown error');

      const { result } = renderHook(() => useFileOperations());

      let deleteResult: { success: boolean; deletedCount: number; failedCount: number; error?: string };
      await act(async () => {
        deleteResult = await result.current.deletePrefix('test-bucket', 'folder/');
      });

      expect(deleteResult!.success).toBe(false);
      expect(deleteResult!.error).toBe('Delete failed');
    });

    it('should set isLoading during prefix delete operation', async () => {
      let resolvePromise: (value: any) => void;
      mockElectronAPI.s3.deletePrefix.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const { result } = renderHook(() => useFileOperations());

      expect(result.current.isLoading).toBe(false);

      let deletePromise: Promise<{ success: boolean; deletedCount: number; failedCount: number; error?: string }>;
      act(() => {
        deletePromise = result.current.deletePrefix('test-bucket', 'folder/');
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolvePromise!({ success: true, deletedCount: 3, failedCount: 0 });
        await deletePromise;
      });

      expect(result.current.isLoading).toBe(false);
    });

    it('should call electronAPI with correct bucket and prefix', async () => {
      mockElectronAPI.s3.deletePrefix.mockResolvedValue({
        success: true,
        deletedCount: 1,
        failedCount: 0,
      });

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.deletePrefix('my-bucket', 'my/nested/folder/');
      });

      expect(mockElectronAPI.s3.deletePrefix).toHaveBeenCalledWith('my-bucket', 'my/nested/folder/');
    });
  });

  describe('renameFile', () => {
    it('should return true on success', async () => {
      mockElectronAPI.s3.renameFile.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useFileOperations());

      let renameResult: boolean = false;
      await act(async () => {
        renameResult = await result.current.renameFile('test-bucket', 'old.txt', 'new.txt');
      });

      expect(renameResult).toBe(true);
    });

    it('should return false on failure', async () => {
      mockElectronAPI.s3.renameFile.mockResolvedValue({ success: false, error: 'Access denied' });

      const { result } = renderHook(() => useFileOperations());

      let renameResult: boolean = true;
      await act(async () => {
        renameResult = await result.current.renameFile('test-bucket', 'old.txt', 'new.txt');
      });

      expect(renameResult).toBe(false);
    });
  });

  describe('dismissOperation', () => {
    it('should remove operation from list', async () => {
      mockElectronAPI.s3.downloadFile.mockResolvedValue({ success: false, error: 'Error' });

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.downloadFile('test-bucket', 'file.txt');
      });

      expect(result.current.operations).toHaveLength(1);
      const opId = result.current.operations[0].id;

      act(() => {
        result.current.dismissOperation(opId);
      });

      expect(result.current.operations).toHaveLength(0);
    });
  });

  describe('clearCompleted', () => {
    it('should remove completed and errored operations', async () => {
      mockElectronAPI.s3.downloadFile
        .mockResolvedValueOnce({ success: true, localPath: '/downloads/file1.txt' })
        .mockResolvedValueOnce({ success: false, error: 'Error' });

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.downloadFile('test-bucket', 'file1.txt');
        await result.current.downloadFile('test-bucket', 'file2.txt');
      });

      expect(result.current.operations).toHaveLength(2);

      act(() => {
        result.current.clearCompleted();
      });

      expect(result.current.operations).toHaveLength(0);
    });
  });
});
