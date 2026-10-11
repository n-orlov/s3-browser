import { useState } from 'react';
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
    it('selects folder on single click', async () => {
      const onNavigate = vi.fn();
      const onSelectFile = vi.fn();
      const onSelectFiles = vi.fn();
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

      render(<FileList {...createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket', onNavigate, onSelectFile, onSelectFiles })} />);

      await waitFor(() => {
        expect(screen.getByText('subfolder')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('subfolder'));
      // Single click should select, not navigate
      expect(onNavigate).not.toHaveBeenCalled();
      expect(onSelectFile).toHaveBeenCalledWith(expect.objectContaining({ key: 'subfolder/', isPrefix: true }));
      expect(onSelectFiles).toHaveBeenCalledWith([expect.objectContaining({ key: 'subfolder/', isPrefix: true })]);
    });

    it('navigates into folder on double click', async () => {
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

      fireEvent.doubleClick(screen.getByText('subfolder'));
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

  describe('multi-selection with modifier keys', () => {
    const keysOf = (calls: unknown[][]) => (calls[calls.length - 1][0] as S3Object[]).map((f) => f.key);
    const names = ['a.txt', 'b.txt', 'c.txt', 'd.txt'];

    const setup = async (selectedFiles: S3Object[] = []) => {
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: names.map((key) => ({ key, size: 10, isPrefix: false })),
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: names.length,
        },
      });
      const onSelectFile = vi.fn();
      const onSelectFiles = vi.fn();
      render(
        <FileList
          {...createDefaultProps({
            currentProfile: 'test-profile',
            selectedBucket: 'my-bucket',
            onSelectFile,
            onSelectFiles,
            selectedFiles,
          })}
        />
      );
      await screen.findByText('a.txt');
      return { onSelectFile, onSelectFiles };
    };

    it('shift+click selects the range from the last clicked row', async () => {
      const { onSelectFile, onSelectFiles } = await setup();
      fireEvent.click(screen.getByText('a.txt'));
      fireEvent.click(screen.getByText('c.txt'), { shiftKey: true });

      expect(keysOf(onSelectFiles.mock.calls)).toEqual(['a.txt', 'b.txt', 'c.txt']);
      expect(onSelectFile).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'c.txt' }));
    });

    it('shift+click keeps the anchor, so a second shift+click ranges from the first click', async () => {
      const { onSelectFiles } = await setup();
      fireEvent.click(screen.getByText('b.txt'));
      fireEvent.click(screen.getByText('d.txt'), { shiftKey: true });
      fireEvent.click(screen.getByText('a.txt'), { shiftKey: true });

      expect(keysOf(onSelectFiles.mock.calls)).toEqual(['a.txt', 'b.txt']);
    });

    it('ctrl+click adds an unselected row to the selection', async () => {
      const a: S3Object = { key: 'a.txt', size: 10, isPrefix: false };
      const { onSelectFile, onSelectFiles } = await setup([a]);
      fireEvent.click(screen.getByText('c.txt'), { ctrlKey: true });

      expect(keysOf(onSelectFiles.mock.calls)).toEqual(['a.txt', 'c.txt']);
      expect(onSelectFile).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'c.txt' }));
    });

    it('ctrl+click removes a selected row and makes the last remaining row primary', async () => {
      const selected: S3Object[] = ['a.txt', 'b.txt', 'c.txt'].map((key) => ({ key, size: 10, isPrefix: false }));
      const { onSelectFile, onSelectFiles } = await setup(selected);
      fireEvent.click(screen.getByText('b.txt'), { ctrlKey: true });

      expect(keysOf(onSelectFiles.mock.calls)).toEqual(['a.txt', 'c.txt']);
      expect(onSelectFile).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'c.txt' }));
    });

    it('ctrl+click on the only selected row clears the primary selection', async () => {
      const a: S3Object = { key: 'a.txt', size: 10, isPrefix: false };
      const { onSelectFile, onSelectFiles } = await setup([a]);
      fireEvent.click(screen.getByText('a.txt'), { ctrlKey: true });

      expect(onSelectFiles).toHaveBeenLastCalledWith([]);
      expect(onSelectFile).toHaveBeenLastCalledWith(null);
    });

    it('shift+ctrl+click adds the range to the existing selection without duplicates', async () => {
      const c: S3Object = { key: 'c.txt', size: 10, isPrefix: false };
      const { onSelectFiles } = await setup([c]);
      fireEvent.click(screen.getByText('b.txt'));
      fireEvent.click(screen.getByText('d.txt'), { shiftKey: true, ctrlKey: true });

      expect(keysOf(onSelectFiles.mock.calls)).toEqual(['c.txt', 'b.txt', 'd.txt']);
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

    it('includes prefixes from subsequent pages during pagination', async () => {
      // First page: returns some prefixes and objects
      mockElectronAPI.s3.listObjects.mockResolvedValueOnce({
        success: true,
        result: {
          objects: [{ key: 'file1.txt', size: 100, isPrefix: false }],
          prefixes: [{ key: 'folderA/', size: 0, isPrefix: true }],
          continuationToken: 'page2-token',
          isTruncated: true,
          prefix: '',
          keyCount: 2,
        },
      });

      // Second page: returns new prefixes that weren't in the first page
      mockElectronAPI.s3.listObjects.mockResolvedValueOnce({
        success: true,
        result: {
          objects: [{ key: 'file2.txt', size: 200, isPrefix: false }],
          prefixes: [{ key: 'folderB/', size: 0, isPrefix: true }],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 2,
        },
      });

      const onItemCountChange = vi.fn();
      render(<FileList {...createDefaultProps({
        currentProfile: 'test-profile',
        selectedBucket: 'my-bucket',
        pendingFileSelection: 'file2.txt',
        onPendingFileSelectionHandled: vi.fn(),
        onItemCountChange,
      })} />);

      // Wait for first page to load
      await waitFor(() => {
        expect(screen.getByText('folderA')).toBeInTheDocument();
        expect(screen.getByText('file1.txt')).toBeInTheDocument();
      });

      // Wait for second page (triggered by pendingFileSelection search)
      await waitFor(() => {
        expect(screen.getByText('file2.txt')).toBeInTheDocument();
        // Key assertion: folderB from the second page must appear
        expect(screen.getByText('folderB')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Verify all 4 items are present
      expect(screen.getByText('folderA')).toBeInTheDocument();
      expect(screen.getByText('folderB')).toBeInTheDocument();
      expect(screen.getByText('file1.txt')).toBeInTheDocument();
      expect(screen.getByText('file2.txt')).toBeInTheDocument();
    });

    it('deduplicates prefixes that span page boundaries', async () => {
      // First page: returns a prefix
      mockElectronAPI.s3.listObjects.mockResolvedValueOnce({
        success: true,
        result: {
          objects: [],
          prefixes: [{ key: 'shared-folder/', size: 0, isPrefix: true }],
          continuationToken: 'page2-token',
          isTruncated: true,
          prefix: '',
          keyCount: 1,
        },
      });

      // Second page: returns the same prefix again (spans page boundary)
      mockElectronAPI.s3.listObjects.mockResolvedValueOnce({
        success: true,
        result: {
          objects: [{ key: 'target.txt', size: 100, isPrefix: false }],
          prefixes: [{ key: 'shared-folder/', size: 0, isPrefix: true }],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 2,
        },
      });

      render(<FileList {...createDefaultProps({
        currentProfile: 'test-profile',
        selectedBucket: 'my-bucket',
        pendingFileSelection: 'target.txt',
        onPendingFileSelectionHandled: vi.fn(),
      })} />);

      // Wait for both pages to load
      await waitFor(() => {
        expect(screen.getByText('target.txt')).toBeInTheDocument();
      }, { timeout: 3000 });

      // shared-folder should appear only once (deduplicated)
      const folderRows = screen.getAllByText('shared-folder');
      expect(folderRows).toHaveLength(1);
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

  describe('navigating to another location', () => {
    const page = (keys: string[], prefix: string) => ({
      success: true,
      result: {
        objects: keys.map((key) => ({ key, size: 10, isPrefix: false })),
        prefixes: [],
        continuationToken: undefined,
        isTruncated: false,
        prefix,
        keyCount: keys.length,
      },
    });
    const at = (currentPrefix: string, extra: Partial<FileListProps> = {}) =>
      createDefaultProps({ currentProfile: 'test-profile', selectedBucket: 'my-bucket', currentPrefix, ...extra });

    beforeEach(() => {
      mockElectronAPI.s3.listObjects.mockImplementation(async ({ prefix = '' }: { prefix?: string }) =>
        prefix === 'other/' ? page(['other/b.txt'], prefix) : page(['a.txt'], prefix)
      );
    });

    it('reloads the objects of the new prefix', async () => {
      const { rerender } = render(<FileList {...at('')} />);
      await screen.findByText('a.txt');

      rerender(<FileList {...at('other/')} />);

      await screen.findByText('b.txt');
      expect(screen.queryByText('a.txt')).not.toBeInTheDocument();
      expect(mockElectronAPI.s3.listObjects).toHaveBeenLastCalledWith(
        expect.objectContaining({ bucket: 'my-bucket', prefix: 'other/' })
      );
    });

    it('reloads the objects of another bucket', async () => {
      const { rerender } = render(<FileList {...at('')} />);
      await screen.findByText('a.txt');
      mockElectronAPI.s3.listObjects.mockClear();

      rerender(<FileList {...at('', { selectedBucket: 'second-bucket' })} />);

      await waitFor(() => {
        expect(mockElectronAPI.s3.listObjects).toHaveBeenCalledWith(
          expect.objectContaining({ bucket: 'second-bucket', prefix: '' })
        );
      });
    });

    it('clears the single and multi selection', async () => {
      const onSelectFile = vi.fn();
      const onSelectFiles = vi.fn();
      const { rerender } = render(<FileList {...at('', { onSelectFile, onSelectFiles })} />);
      fireEvent.click(await screen.findByText('a.txt'));
      expect(onSelectFile).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'a.txt' }));
      expect(onSelectFiles).toHaveBeenLastCalledWith([expect.objectContaining({ key: 'a.txt' })]);

      rerender(<FileList {...at('other/', { onSelectFile, onSelectFiles })} />);

      await waitFor(() => {
        expect(onSelectFile).toHaveBeenLastCalledWith(null);
        expect(onSelectFiles).toHaveBeenLastCalledWith([]);
      });
    });

    it('clears the search box on every navigation, including back to the first location', async () => {
      const { rerender } = render(<FileList {...at('')} />);
      await screen.findByText('a.txt');
      fireEvent.change(screen.getByPlaceholderText('Quick filter...'), { target: { value: 'zzz' } });

      rerender(<FileList {...at('other/')} />);
      await screen.findByText('b.txt');
      expect(screen.getByPlaceholderText('Quick filter...')).toHaveValue('');

      rerender(<FileList {...at('')} />);
      await screen.findByText('a.txt');
      expect(screen.getByPlaceholderText('Quick filter...')).toHaveValue('');
      expect(screen.getByText('a.txt')).toBeInTheDocument();
    });

    it('selects a pending file only once its location has loaded', async () => {
      const onSelectFile = vi.fn();
      const onPendingFileSelectionHandled = vi.fn();
      const { rerender } = render(<FileList {...at('', { onSelectFile, onPendingFileSelectionHandled })} />);
      await screen.findByText('a.txt');
      onSelectFile.mockClear();
      onPendingFileSelectionHandled.mockClear();

      rerender(
        <FileList {...at('other/', { onSelectFile, onPendingFileSelectionHandled, pendingFileSelection: 'other/b.txt' })} />
      );

      await waitFor(() => {
        expect(onSelectFile).toHaveBeenCalledWith(expect.objectContaining({ key: 'other/b.txt' }));
      });
      // Never resolved against the previous location's items
      expect(onPendingFileSelectionHandled).toHaveBeenCalledTimes(1);
      expect(onSelectFile).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'other/b.txt' }));
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
  describe('pending selection with a parent that clears it once handled', () => {
    it('keeps the pending file until the listing arrives and then selects it', async () => {
      const target = { key: 'prefix/target.txt', size: 100, isPrefix: false };
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [target, { key: 'prefix/other.txt', size: 200, isPrefix: false }],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: 'prefix/',
          keyCount: 2,
        },
      });

      // Mirrors App: the parent owns the pending key and clears it when FileList reports it handled.
      function Parent() {
        const [bucket, setBucket] = useState<string | null>(null);
        const [prefix, setPrefix] = useState('');
        const [pending, setPending] = useState<string | null>(null);
        const [selected, setSelected] = useState<S3Object | null>(null);
        return (
          <>
            <button
              onClick={() => {
                setBucket('my-bucket');
                setPrefix('prefix/');
                setPending(target.key);
              }}
            >
              go
            </button>
            <div data-testid="selected">{selected?.key ?? ''}</div>
            <FileList {...createDefaultProps({
              currentProfile: 'test-profile',
              selectedBucket: bucket,
              currentPrefix: prefix,
              selectedFile: selected,
              onSelectFile: setSelected,
              pendingFileSelection: pending,
              onPendingFileSelectionHandled: () => setPending(null),
            })} />
          </>
        );
      }

      render(<Parent />);
      fireEvent.click(screen.getByText('go'));

      await waitFor(() => {
        expect(screen.getByTestId('selected').textContent).toBe(target.key);
      });
    });
  });
});
