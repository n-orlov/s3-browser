import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FileList, { type FileListProps, type S3Object } from '../renderer/components/FileList';
import { mockElectronAPI } from './setup';

// Helper to create default props for FileList
const createDefaultProps = (overrides: Partial<FileListProps> = {}): FileListProps => ({
  currentProfile: null,
  selectedBucket: null,
  currentPrefix: '',
  onNavigate: vi.fn(),
  onSelectFile: vi.fn(),
  selectedFile: null,
  selectedFiles: [],
  onSelectFiles: vi.fn(),
  ...overrides,
});

describe('FileList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('placeholder states', () => {
    it('shows placeholder when no profile selected', () => {
      render(<FileList {...createDefaultProps()} />);

      expect(screen.getByText('Select a profile to browse files')).toBeInTheDocument();
    });

    it('shows placeholder when no bucket selected', () => {
      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile' })} />);

      expect(screen.getByText('Select a bucket to view files')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading indicator while fetching', () => {
      mockElectronAPI.s3.listObjects.mockImplementation(() => new Promise(() => {}));

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />);

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });
  });

  describe('listing objects', () => {
    it('displays folders and files', async () => {
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [
            { key: 'file1.txt', size: 1024, isPrefix: false },
            { key: 'file2.json', size: 2048, isPrefix: false },
          ],
          prefixes: [
            { key: 'folder1/', size: 0, isPrefix: true },
          ],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 3,
        },
      });

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />);

      await waitFor(() => {
        expect(screen.getByText('folder1')).toBeInTheDocument();
        expect(screen.getByText('file1.txt')).toBeInTheDocument();
        expect(screen.getByText('file2.json')).toBeInTheDocument();
      });
    });

    it('shows empty message when no objects', async () => {
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 0,
        },
      });

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />);

      await waitFor(() => {
        expect(screen.getByText('This folder is empty')).toBeInTheDocument();
      });
    });

    it('displays file size formatted', async () => {
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [
            { key: 'small.txt', size: 512, isPrefix: false },
            { key: 'medium.txt', size: 2048, isPrefix: false },
            { key: 'large.txt', size: 1536000, isPrefix: false },
          ],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 3,
        },
      });

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />);

      await waitFor(() => {
        expect(screen.getByText('512 B')).toBeInTheDocument();
        expect(screen.getByText('2.0 KB')).toBeInTheDocument();
        expect(screen.getByText('1.5 MB')).toBeInTheDocument();
      });
    });
  });

  describe('navigation', () => {
    it('navigates into folder on click', async () => {
      const onNavigate = vi.fn();
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [],
          prefixes: [{ key: 'subfolder/', size: 0, isPrefix: true }],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 1,
        },
      });

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket', onNavigate })} />);

      await waitFor(() => {
        expect(screen.getByText('subfolder')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('subfolder'));
      expect(onNavigate).toHaveBeenCalledWith('subfolder/');
    });

    it('displays breadcrumb for current path', async () => {
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: 'folder1/folder2/',
          keyCount: 0,
        },
      });

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket', currentPrefix: 'folder1/folder2/' })} />);

      await waitFor(() => {
        expect(screen.getByText('my-bucket')).toBeInTheDocument();
        expect(screen.getByText('folder1')).toBeInTheDocument();
        expect(screen.getByText('folder2')).toBeInTheDocument();
      });
    });

    it('navigates to breadcrumb segment on click', async () => {
      const onNavigate = vi.fn();
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: 'folder1/folder2/',
          keyCount: 0,
        },
      });

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket', currentPrefix: 'folder1/folder2/', onNavigate })} />);

      await waitFor(() => {
        expect(screen.getByText('folder1')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('folder1'));
      expect(onNavigate).toHaveBeenCalledWith('folder1/');
    });

    it('navigates to bucket root when bucket name clicked', async () => {
      const onNavigate = vi.fn();
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: 'some/path/',
          keyCount: 0,
        },
      });

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket', currentPrefix: 'some/path/', onNavigate })} />);

      await waitFor(() => {
        expect(screen.getByText('my-bucket')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('my-bucket'));
      expect(onNavigate).toHaveBeenCalledWith('');
    });

    it('shows and handles go up button', async () => {
      const onNavigate = vi.fn();
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: 'a/b/c/',
          keyCount: 0,
        },
      });

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket', currentPrefix: 'a/b/c/', onNavigate })} />);

      await waitFor(() => {
        expect(screen.getByTitle('Go to parent folder')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle('Go to parent folder'));
      expect(onNavigate).toHaveBeenCalledWith('a/b/');
    });
  });

  describe('file selection', () => {
    it('selects file on click', async () => {
      const onSelectFile = vi.fn();
      const file = { key: 'data.csv', size: 500, isPrefix: false };
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [file],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 1,
        },
      });

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket', onSelectFile })} />);

      await waitFor(() => {
        expect(screen.getByText('data.csv')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('data.csv'));
      expect(onSelectFile).toHaveBeenCalledWith(expect.objectContaining({ key: 'data.csv' }));
    });

    it('highlights selected file', async () => {
      const selectedFile = { key: 'selected.txt', size: 100, isPrefix: false };
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [
            selectedFile,
            { key: 'other.txt', size: 200, isPrefix: false },
          ],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 2,
        },
      });

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket', selectedFile, selectedFiles: [selectedFile] })} />);

      await waitFor(() => {
        expect(screen.getByText('selected.txt')).toBeInTheDocument();
      });

      const selectedRow = screen.getByText('selected.txt').closest('.file-row');
      expect(selectedRow).toHaveClass('selected');

      const otherRow = screen.getByText('other.txt').closest('.file-row');
      expect(otherRow).not.toHaveClass('selected');
    });
  });

  describe('error handling', () => {
    it('shows error message on API failure', async () => {
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: false,
        error: 'Permission denied',
      });

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />);

      await waitFor(() => {
        expect(screen.getByText('Permission denied')).toBeInTheDocument();
      });
    });

    it('retries on retry button click', async () => {
      mockElectronAPI.s3.listObjects.mockResolvedValueOnce({
        success: false,
        error: 'Temporary error',
      });

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />);

      await waitFor(() => {
        expect(screen.getByText('Temporary error')).toBeInTheDocument();
      });

      mockElectronAPI.s3.listObjects.mockResolvedValueOnce({
        success: true,
        result: {
          objects: [{ key: 'recovered.txt', size: 100, isPrefix: false }],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 1,
        },
      });

      fireEvent.click(screen.getByText('Retry'));

      await waitFor(() => {
        expect(screen.getByText('recovered.txt')).toBeInTheDocument();
      });
    });
  });

  describe('pagination', () => {
    it('shows indicator when more items available', async () => {
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [{ key: 'file.txt', size: 100, isPrefix: false }],
          prefixes: [],
          continuationToken: 'next-token',
          isTruncated: true,
          prefix: '',
          keyCount: 1,
        },
      });

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />);

      await waitFor(() => {
        expect(screen.getByText('Scroll to load more')).toBeInTheDocument();
      });
    });
  });

  describe('keyboard navigation', () => {
    it('handles Enter key on file row', async () => {
      const onSelectFile = vi.fn();
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [{ key: 'keyboard-file.txt', size: 100, isPrefix: false }],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 1,
        },
      });

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket', onSelectFile })} />);

      await waitFor(() => {
        expect(screen.getByText('keyboard-file.txt')).toBeInTheDocument();
      });

      const row = screen.getByText('keyboard-file.txt').closest('.file-row')!;
      fireEvent.keyDown(row, { key: 'Enter' });

      expect(onSelectFile).toHaveBeenCalled();
    });

    it('handles Enter key on folder row', async () => {
      const onNavigate = vi.fn();
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [],
          prefixes: [{ key: 'keyboard-folder/', size: 0, isPrefix: true }],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 1,
        },
      });

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket', onNavigate })} />);

      await waitFor(() => {
        expect(screen.getByText('keyboard-folder')).toBeInTheDocument();
      });

      const row = screen.getByText('keyboard-folder').closest('.file-row')!;
      fireEvent.keyDown(row, { key: 'Enter' });

      expect(onNavigate).toHaveBeenCalledWith('keyboard-folder/');
    });
  });

  describe('sorting and filtering', () => {
    beforeEach(() => {
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [
            { key: 'alpha.txt', size: 500, lastModified: new Date('2024-01-15'), isPrefix: false },
            { key: 'beta.json', size: 1000, lastModified: new Date('2024-01-10'), isPrefix: false },
            { key: 'gamma.png', size: 2000, lastModified: new Date('2024-01-20'), isPrefix: false },
          ],
          prefixes: [
            { key: 'folder/', size: 0, isPrefix: true },
          ],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 4,
        },
      });
    });

    it('renders filter controls', async () => {
      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Quick filter...')).toBeInTheDocument();
        expect(screen.getByLabelText('Filter by type')).toBeInTheDocument();
      });
    });

    it('renders sortable column headers', async () => {
      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />);

      await waitFor(() => {
        expect(screen.getByTitle('Sort by name')).toBeInTheDocument();
        expect(screen.getByTitle('Sort by size')).toBeInTheDocument();
        expect(screen.getByTitle('Sort by date')).toBeInTheDocument();
      });
    });

    it('filters by search query', async () => {
      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />);

      await waitFor(() => {
        expect(screen.getByText('alpha.txt')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Quick filter...');
      fireEvent.change(searchInput, { target: { value: 'alpha' } });

      await waitFor(() => {
        expect(screen.getByText('alpha.txt')).toBeInTheDocument();
        expect(screen.queryByText('beta.json')).not.toBeInTheDocument();
        expect(screen.queryByText('gamma.png')).not.toBeInTheDocument();
      });
    });

    it('filters by file type', async () => {
      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />);

      await waitFor(() => {
        expect(screen.getByText('alpha.txt')).toBeInTheDocument();
      });

      const typeFilter = screen.getByLabelText('Filter by type');
      fireEvent.change(typeFilter, { target: { value: 'images' } });

      await waitFor(() => {
        expect(screen.getByText('gamma.png')).toBeInTheDocument();
        expect(screen.queryByText('alpha.txt')).not.toBeInTheDocument();
        expect(screen.queryByText('beta.json')).not.toBeInTheDocument();
        // Folders should still be visible
        expect(screen.getByText('folder')).toBeInTheDocument();
      });
    });

    it('sorts by clicking column header', async () => {
      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />);

      await waitFor(() => {
        expect(screen.getByText('alpha.txt')).toBeInTheDocument();
      });

      // Click on Size header to sort by size ascending
      const sizeHeader = screen.getByTitle('Sort by size');
      fireEvent.click(sizeHeader);

      // Files should now be sorted by size (smallest first, after folder)
      const rows = screen.getAllByRole('row').slice(1); // Skip header row
      const cellTexts = rows.map(row => row.querySelector('.file-name')?.textContent);

      // folder comes first, then files by size: alpha (500), beta (1000), gamma (2000)
      expect(cellTexts[0]).toBe('folder');
      expect(cellTexts[1]).toBe('alpha.txt');
      expect(cellTexts[2]).toBe('beta.json');
      expect(cellTexts[3]).toBe('gamma.png');
    });

    it('shows item count', async () => {
      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />);

      await waitFor(() => {
        expect(screen.getByText('4 items')).toBeInTheDocument();
      });
    });

    it('shows filtered count when filtering', async () => {
      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />);

      await waitFor(() => {
        expect(screen.getByText('alpha.txt')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Quick filter...');
      fireEvent.change(searchInput, { target: { value: 'alpha' } });

      await waitFor(() => {
        expect(screen.getByText('1 of 4 items')).toBeInTheDocument();
      });
    });

    it('shows no results message when filter matches nothing', async () => {
      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />);

      await waitFor(() => {
        expect(screen.getByText('alpha.txt')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Quick filter...');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

      await waitFor(() => {
        expect(screen.getByText('No files match your filter')).toBeInTheDocument();
      });
    });

    it('clears search when navigating to new location', async () => {
      const { rerender } = render(
        <FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket' })} />
      );

      await waitFor(() => {
        expect(screen.getByText('alpha.txt')).toBeInTheDocument();
      });

      // Type in search
      const searchInput = screen.getByPlaceholderText('Quick filter...');
      fireEvent.change(searchInput, { target: { value: 'test' } });
      expect(searchInput).toHaveValue('test');

      // Navigate to new prefix
      rerender(
        <FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket', currentPrefix: 'folder/' })} />
      );

      // Search should be cleared
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Quick filter...')).toHaveValue('');
      });
    });
  });

  describe('pending file selection (URL navigation)', () => {
    it('selects file when found in initial load', async () => {
      const onSelectFile = vi.fn();
      const onPendingFileSelectionHandled = vi.fn();
      const targetFile = { key: 'prefix/target.txt', size: 100, isPrefix: false };

      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [
            targetFile,
            { key: 'prefix/other.txt', size: 200, isPrefix: false },
          ],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: 'prefix/',
          keyCount: 2,
        },
      });

      render(
        <FileList {...createDefaultProps({
          currentProfile: 'test-profile',
          selectedBucket: 'my-bucket',
          currentPrefix: 'prefix/',
          onSelectFile,
          pendingFileSelection: 'prefix/target.txt',
          onPendingFileSelectionHandled,
        })} />
      );

      await waitFor(() => {
        expect(onSelectFile).toHaveBeenCalledWith(expect.objectContaining({ key: 'prefix/target.txt' }));
        expect(onPendingFileSelectionHandled).toHaveBeenCalled();
      });
    });

    it('continues loading more pages to find file', async () => {
      const onSelectFile = vi.fn();
      const onPendingFileSelectionHandled = vi.fn();
      const targetFile = { key: 'prefix/target.txt', size: 100, isPrefix: false };

      // First page - file not found
      mockElectronAPI.s3.listObjects.mockResolvedValueOnce({
        success: true,
        result: {
          objects: [
            { key: 'prefix/file1.txt', size: 100, isPrefix: false },
          ],
          prefixes: [],
          continuationToken: 'next-token',
          isTruncated: true,
          prefix: 'prefix/',
          keyCount: 1,
        },
      });

      // Second page - file found
      mockElectronAPI.s3.listObjects.mockResolvedValueOnce({
        success: true,
        result: {
          objects: [targetFile],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: 'prefix/',
          keyCount: 1,
        },
      });

      render(
        <FileList {...createDefaultProps({
          currentProfile: 'test-profile',
          selectedBucket: 'my-bucket',
          currentPrefix: 'prefix/',
          onSelectFile,
          pendingFileSelection: 'prefix/target.txt',
          onPendingFileSelectionHandled,
        })} />
      );

      // Wait for file search to complete
      await waitFor(() => {
        expect(onSelectFile).toHaveBeenCalledWith(expect.objectContaining({ key: 'prefix/target.txt' }));
      }, { timeout: 3000 });

      expect(onPendingFileSelectionHandled).toHaveBeenCalled();
      // Should have called listObjects twice
      expect(mockElectronAPI.s3.listObjects).toHaveBeenCalledTimes(2);
    });

    it('shows search progress overlay while searching', async () => {
      const onSelectFile = vi.fn();
      const onPendingFileSelectionHandled = vi.fn();

      // First page returns immediately, but has more
      mockElectronAPI.s3.listObjects.mockResolvedValueOnce({
        success: true,
        result: {
          objects: [{ key: 'prefix/file1.txt', size: 100, isPrefix: false }],
          prefixes: [],
          continuationToken: 'next-token',
          isTruncated: true,
          prefix: 'prefix/',
          keyCount: 1,
        },
      });

      // Second page takes time
      mockElectronAPI.s3.listObjects.mockImplementationOnce(
        () => new Promise((resolve) =>
          setTimeout(() => resolve({
            success: true,
            result: {
              objects: [{ key: 'prefix/target.txt', size: 100, isPrefix: false }],
              prefixes: [],
              continuationToken: undefined,
              isTruncated: false,
              prefix: 'prefix/',
              keyCount: 1,
            },
          }), 100)
        )
      );

      render(
        <FileList {...createDefaultProps({
          currentProfile: 'test-profile',
          selectedBucket: 'my-bucket',
          currentPrefix: 'prefix/',
          onSelectFile,
          pendingFileSelection: 'prefix/target.txt',
          onPendingFileSelectionHandled,
        })} />
      );

      // Should show search progress overlay
      await waitFor(() => {
        expect(screen.getByText('Searching for file...')).toBeInTheDocument();
        expect(screen.getByText('Cancel')).toBeInTheDocument();
      });

      // Wait for search to complete
      await waitFor(() => {
        expect(onSelectFile).toHaveBeenCalledWith(expect.objectContaining({ key: 'prefix/target.txt' }));
      }, { timeout: 3000 });
    });

    it('cancels search when cancel button clicked', async () => {
      const onSelectFile = vi.fn();
      const onPendingFileSelectionHandled = vi.fn();

      // First page - file not found, more available
      mockElectronAPI.s3.listObjects.mockResolvedValueOnce({
        success: true,
        result: {
          objects: [{ key: 'prefix/file1.txt', size: 100, isPrefix: false }],
          prefixes: [],
          continuationToken: 'next-token',
          isTruncated: true,
          prefix: 'prefix/',
          keyCount: 1,
        },
      });

      // Second page never completes (simulating slow load)
      mockElectronAPI.s3.listObjects.mockImplementationOnce(
        () => new Promise((resolve) =>
          setTimeout(() => resolve({
            success: true,
            result: {
              objects: [{ key: 'prefix/target.txt', size: 100, isPrefix: false }],
              prefixes: [],
              continuationToken: undefined,
              isTruncated: false,
              prefix: 'prefix/',
              keyCount: 1,
            },
          }), 5000) // Very slow
        )
      );

      render(
        <FileList {...createDefaultProps({
          currentProfile: 'test-profile',
          selectedBucket: 'my-bucket',
          currentPrefix: 'prefix/',
          onSelectFile,
          pendingFileSelection: 'prefix/target.txt',
          onPendingFileSelectionHandled,
        })} />
      );

      // Wait for search progress to show
      await waitFor(() => {
        expect(screen.getByText('Cancel')).toBeInTheDocument();
      });

      // Click cancel
      fireEvent.click(screen.getByText('Cancel'));

      // Should clear pending selection
      await waitFor(() => {
        expect(onPendingFileSelectionHandled).toHaveBeenCalled();
      });

      // Should hide the overlay
      await waitFor(() => {
        expect(screen.queryByText('Searching for file...')).not.toBeInTheDocument();
      });
    });

    it('clears pending selection if file not found after all pages loaded', async () => {
      const onSelectFile = vi.fn();
      const onPendingFileSelectionHandled = vi.fn();

      // Only one page, file not there
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [{ key: 'prefix/other.txt', size: 100, isPrefix: false }],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: 'prefix/',
          keyCount: 1,
        },
      });

      render(
        <FileList {...createDefaultProps({
          currentProfile: 'test-profile',
          selectedBucket: 'my-bucket',
          currentPrefix: 'prefix/',
          onSelectFile,
          pendingFileSelection: 'prefix/nonexistent.txt',
          onPendingFileSelectionHandled,
        })} />
      );

      // Should clear pending selection since file not found
      await waitFor(() => {
        expect(onPendingFileSelectionHandled).toHaveBeenCalled();
      });

      // File should not be selected
      expect(onSelectFile).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'prefix/nonexistent.txt' }));
    });
  });
});
