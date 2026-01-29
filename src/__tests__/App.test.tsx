import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
      profiles: [{ name: 'default', hasCredentials: true, isValid: true }],
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
        profiles: [{ name: 'default', hasCredentials: true, isValid: true }],
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
        profiles: [{ name: 'default', hasCredentials: true, isValid: true }],
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
});
