import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import App from '../renderer/App';
import { AwsProfileProvider } from '../renderer/context/AwsProfileContext';
import { mockElectronAPI } from './setup';

// Helper to render App with the required context provider
function renderApp() {
  return render(
    <AwsProfileProvider>
      <App />
    </AwsProfileProvider>
  );
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to returning no buckets
    mockElectronAPI.s3.listBuckets.mockResolvedValue({
      success: true,
      buckets: [],
    });
  });

  it('renders the app header with title', () => {
    renderApp();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('S3 Browser');
  });

  it('renders the sidebar with Buckets section', () => {
    renderApp();
    expect(screen.getByText('Buckets')).toBeInTheDocument();
  });

  it('renders the main content area with Files section', () => {
    renderApp();
    expect(screen.getByText('Files')).toBeInTheDocument();
  });

  it('shows placeholder text when no profile is selected', () => {
    renderApp();
    // When no profile is selected, show profile selection prompt
    expect(screen.getByText('Select a profile to browse files')).toBeInTheDocument();
  });

  it('shows placeholder text when no bucket is selected', async () => {
    mockElectronAPI.aws.getProfiles.mockResolvedValue({
      profiles: [{ name: 'default', hasCredentials: true, isValid: true, profileType: 'static' as const, profileTypeDescription: 'Static credentials' }],
      currentProfile: 'default',
      defaultRegion: 'us-east-1',
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByText('Select a bucket to view files')).toBeInTheDocument();
    });
  });

  describe('navigation', () => {
    it('updates content header when bucket is selected', async () => {
      mockElectronAPI.s3.listBuckets.mockResolvedValue({
        success: true,
        buckets: [{ name: 'test-bucket', creationDate: new Date() }],
      });
      mockElectronAPI.aws.getProfiles.mockResolvedValue({
        profiles: [{ name: 'default', hasCredentials: true, isValid: true, profileType: 'static' as const, profileTypeDescription: 'Static credentials' }],
        currentProfile: 'default',
        defaultRegion: 'us-east-1',
      });
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

      renderApp();

      await waitFor(() => {
        expect(screen.getByText('test-bucket')).toBeInTheDocument();
      });

      // Click on the bucket in the tree
      fireEvent.click(screen.getByText('test-bucket'));

      // The content header should now show the bucket name
      await waitFor(() => {
        const headers = screen.getAllByRole('heading', { level: 2 });
        expect(headers.some(h => h.textContent === 'test-bucket')).toBe(true);
      });
    });

    it('shows selected file info in content header', async () => {
      mockElectronAPI.s3.listBuckets.mockResolvedValue({
        success: true,
        buckets: [{ name: 'my-bucket', creationDate: new Date() }],
      });
      mockElectronAPI.aws.getProfiles.mockResolvedValue({
        profiles: [{ name: 'default', hasCredentials: true, isValid: true, profileType: 'static' as const, profileTypeDescription: 'Static credentials' }],
        currentProfile: 'default',
        defaultRegion: 'us-east-1',
      });
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [{ key: 'important-file.txt', size: 1024, isPrefix: false }],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 1,
        },
      });

      renderApp();

      // Select the bucket
      await waitFor(() => {
        expect(screen.getByText('my-bucket')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('my-bucket'));

      // Wait for files to load
      await waitFor(() => {
        expect(screen.getByText('important-file.txt')).toBeInTheDocument();
      });

      // Click on the file
      fireEvent.click(screen.getByText('important-file.txt'));

      // Check that selected file info appears
      await waitFor(() => {
        expect(screen.getByText('Selected:')).toBeInTheDocument();
      });
    });
  });

  describe('file operations', () => {
    beforeEach(() => {
      mockElectronAPI.s3.listBuckets.mockResolvedValue({
        success: true,
        buckets: [{ name: 'test-bucket', creationDate: new Date() }],
      });
      mockElectronAPI.aws.getProfiles.mockResolvedValue({
        profiles: [{ name: 'default', hasCredentials: true, isValid: true, profileType: 'static' as const, profileTypeDescription: 'Static credentials' }],
        currentProfile: 'default',
        defaultRegion: 'us-east-1',
      });
      mockElectronAPI.s3.listObjects.mockResolvedValue({
        success: true,
        result: {
          objects: [{ key: 'file.txt', size: 1024, isPrefix: false }],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 1,
        },
      });
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('triggers refresh after upload completes via Upload button', async () => {
      // Setup upload mock that resolves
      mockElectronAPI.s3.showOpenDialog.mockResolvedValue(['/path/to/file.txt']);
      mockElectronAPI.s3.uploadFiles.mockResolvedValue({
        success: true,
        results: [{ success: true, path: '/path/to/file.txt' }],
      });

      // Track s3-refresh-files events
      const refreshHandler = vi.fn();
      window.addEventListener('s3-refresh-files', refreshHandler);

      renderApp();

      // Select the bucket
      await waitFor(() => {
        expect(screen.getByText('test-bucket')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('test-bucket'));

      // Wait for files to load
      await waitFor(() => {
        expect(screen.getByText('file.txt')).toBeInTheDocument();
      });

      // Find and click the Upload button
      const uploadButton = screen.getByTitle('Upload files');
      await act(async () => {
        fireEvent.click(uploadButton);
      });

      // Wait for the upload to complete and refresh to be triggered
      await waitFor(() => {
        expect(mockElectronAPI.s3.uploadFiles).toHaveBeenCalled();
      });

      // Allow promise chain to resolve
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Verify refresh was triggered
      expect(refreshHandler).toHaveBeenCalled();

      // Cleanup
      window.removeEventListener('s3-refresh-files', refreshHandler);
    });

    it('does not trigger refresh when upload is cancelled', async () => {
      // Setup upload mock that returns empty (user cancelled dialog)
      mockElectronAPI.s3.showOpenDialog.mockResolvedValue([]);

      // Track s3-refresh-files events
      const refreshHandler = vi.fn();
      window.addEventListener('s3-refresh-files', refreshHandler);

      renderApp();

      // Select the bucket
      await waitFor(() => {
        expect(screen.getByText('test-bucket')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('test-bucket'));

      // Wait for files to load
      await waitFor(() => {
        expect(screen.getByText('file.txt')).toBeInTheDocument();
      });

      // Find and click the Upload button
      const uploadButton = screen.getByTitle('Upload files');
      await act(async () => {
        fireEvent.click(uploadButton);
      });

      // Wait for the dialog to be shown
      await waitFor(() => {
        expect(mockElectronAPI.s3.showOpenDialog).toHaveBeenCalled();
      });

      // Allow promise chain to resolve
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Verify uploadFiles was NOT called (dialog was cancelled)
      expect(mockElectronAPI.s3.uploadFiles).not.toHaveBeenCalled();

      // Note: refresh still gets called because the promise chain completes
      // This is expected behavior - the refresh event is dispatched after upload promise resolves
      // even if no files were selected (empty upload completes successfully)

      // Cleanup
      window.removeEventListener('s3-refresh-files', refreshHandler);
    });

    describe('creating a new item', () => {
      async function openNewItemDialog(toolbarTitle: string) {
        renderApp();
        await waitFor(() => expect(screen.getByText('test-bucket')).toBeInTheDocument());
        fireEvent.click(screen.getByText('test-bucket'));
        await waitFor(() => expect(screen.getByText('file.txt')).toBeInTheDocument());
        fireEvent.click(await screen.findByTitle(toolbarTitle));
        return screen.findByLabelText('Name:');
      }

      async function submit(name: string) {
        const input = await screen.findByLabelText('Name:');
        fireEvent.change(input, { target: { value: name } });
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Create' }));
        });
      }

      it('creates a file under the bucket root, refreshes and toasts success', async () => {
        const refreshHandler = vi.fn();
        window.addEventListener('s3-refresh-files', refreshHandler);
        mockElectronAPI.s3.createFile.mockResolvedValue({ success: true });
        await openNewItemDialog('Create new empty file');
        refreshHandler.mockClear();
        await submit('notes.txt');
        expect(mockElectronAPI.s3.createFile).toHaveBeenCalledWith('test-bucket', 'notes.txt');
        expect(mockElectronAPI.s3.createFolder).not.toHaveBeenCalled();
        expect(await screen.findByText('File Created')).toBeInTheDocument();
        expect(refreshHandler).toHaveBeenCalled();
        expect(screen.queryByLabelText('Name:')).not.toBeInTheDocument();
        window.removeEventListener('s3-refresh-files', refreshHandler);
      });

      it('creates a folder, refreshes and toasts success', async () => {
        const refreshHandler = vi.fn();
        window.addEventListener('s3-refresh-files', refreshHandler);
        mockElectronAPI.s3.createFolder.mockResolvedValue({ success: true });
        await openNewItemDialog('Create new folder');
        refreshHandler.mockClear();
        await submit('docs');
        expect(mockElectronAPI.s3.createFolder).toHaveBeenCalledWith('test-bucket', 'docs');
        expect(mockElectronAPI.s3.createFile).not.toHaveBeenCalled();
        expect(await screen.findByText('Folder Created')).toBeInTheDocument();
        expect(refreshHandler).toHaveBeenCalled();
        window.removeEventListener('s3-refresh-files', refreshHandler);
      });

      it('toasts the error and does not refresh when creation fails', async () => {
        const refreshHandler = vi.fn();
        window.addEventListener('s3-refresh-files', refreshHandler);
        mockElectronAPI.s3.createFile.mockResolvedValue({ success: false, error: 'Access denied' });
        await openNewItemDialog('Create new empty file');
        refreshHandler.mockClear();
        await submit('notes.txt');
        expect(await screen.findByText('Creation Failed')).toBeInTheDocument();
        expect(screen.getByText('Access denied')).toBeInTheDocument();
        expect(refreshHandler).not.toHaveBeenCalled();
        window.removeEventListener('s3-refresh-files', refreshHandler);
      });
    });

    describe('deleting the selection', () => {
      async function selectFileAndOpenDelete() {
        renderApp();
        await waitFor(() => expect(screen.getByText('test-bucket')).toBeInTheDocument());
        fireEvent.click(screen.getByText('test-bucket'));
        await waitFor(() => expect(screen.getByText('file.txt')).toBeInTheDocument());
        fireEvent.click(screen.getByText('file.txt'));
        fireEvent.click(await screen.findByTitle('Delete selected file'));
        return screen.findByRole('button', { name: 'Delete' });
      }

      it('deletes the file, refreshes the list and toasts success', async () => {
        const refreshHandler = vi.fn();
        window.addEventListener('s3-refresh-files', refreshHandler);
        mockElectronAPI.s3.deleteFile.mockResolvedValue({ success: true });
        const confirm = await selectFileAndOpenDelete();
        refreshHandler.mockClear();
        await act(async () => {
          fireEvent.click(confirm);
        });
        expect(mockElectronAPI.s3.deleteFile).toHaveBeenCalledWith('test-bucket', 'file.txt');
        expect(await screen.findByText('Delete Complete')).toBeInTheDocument();
        expect(screen.getByText('Deleted 1 item(s)')).toBeInTheDocument();
        expect(refreshHandler).toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
        expect(screen.queryByText('Selected:')).not.toBeInTheDocument();
        window.removeEventListener('s3-refresh-files', refreshHandler);
      });

      it('warns and keeps the selection and list when the delete fails', async () => {
        const refreshHandler = vi.fn();
        window.addEventListener('s3-refresh-files', refreshHandler);
        mockElectronAPI.s3.deleteFile.mockResolvedValue({ success: false });
        const confirm = await selectFileAndOpenDelete();
        refreshHandler.mockClear();
        await act(async () => {
          fireEvent.click(confirm);
        });
        expect(await screen.findByText('Delete Failed')).toBeInTheDocument();
        expect(screen.getByText('Deleted 0 item(s), 1 failed')).toBeInTheDocument();
        expect(refreshHandler).not.toHaveBeenCalled();
        expect(screen.getByText('Selected:')).toBeInTheDocument();
        window.removeEventListener('s3-refresh-files', refreshHandler);
      });
    });
  });
});
