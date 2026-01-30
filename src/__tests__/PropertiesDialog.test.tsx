import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PropertiesDialog from '../renderer/components/PropertiesDialog';

describe('PropertiesDialog', () => {
  const defaultProps = {
    isOpen: true,
    bucket: 'test-bucket',
    fileKey: 'test-folder/test-file.txt',
    isFolder: false,
    onClose: vi.fn(),
  };

  const mockMetadata = {
    key: 'test-folder/test-file.txt',
    bucket: 'test-bucket',
    s3Url: 's3://test-bucket/test-folder/test-file.txt',
    httpUrl: 'https://test-bucket.s3.amazonaws.com/test-folder%2Ftest-file.txt',
    contentLength: 1234567,
    contentType: 'text/plain',
    lastModified: new Date('2024-01-15T10:30:00Z'),
    etag: 'abc123def456',
    storageClass: 'STANDARD',
    versionId: 'v123456',
    serverSideEncryption: 'AES256',
    tags: { environment: 'production', owner: 'team-a' },
    customMetadata: { 'x-custom-header': 'custom-value' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock the electronAPI
    window.electronAPI = {
      getObjectMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: mockMetadata,
      }),
    } as unknown as typeof window.electronAPI;
  });

  describe('rendering', () => {
    it('does not render when closed', () => {
      render(<PropertiesDialog {...defaultProps} isOpen={false} />);
      expect(screen.queryByText('File Properties')).not.toBeInTheDocument();
    });

    it('renders dialog when open', () => {
      render(<PropertiesDialog {...defaultProps} />);
      expect(screen.getByText('File Properties')).toBeInTheDocument();
    });

    it('shows Folder Properties header for folders', () => {
      render(<PropertiesDialog {...defaultProps} isFolder={true} />);
      expect(screen.getByText('Folder Properties')).toBeInTheDocument();
    });

    it('shows loading state while fetching metadata', () => {
      // Delay the mock response
      window.electronAPI.getObjectMetadata = vi.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ success: true, metadata: mockMetadata }), 1000))
      );

      render(<PropertiesDialog {...defaultProps} />);
      expect(screen.getByText('Loading metadata...')).toBeInTheDocument();
    });

    it('shows error state when metadata fetch fails', async () => {
      window.electronAPI.getObjectMetadata = vi.fn().mockResolvedValue({
        success: false,
        error: 'Access denied',
      });

      render(<PropertiesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Error: Access denied/)).toBeInTheDocument();
      });
    });

    it('displays metadata after successful fetch', async () => {
      render(<PropertiesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('test-file.txt')).toBeInTheDocument();
      });

      expect(screen.getByText('text/plain')).toBeInTheDocument();
      expect(screen.getByText(/1\.18 MB/)).toBeInTheDocument();
      expect(screen.getByText('STANDARD')).toBeInTheDocument();
    });
  });

  describe('folder handling', () => {
    it('does not fetch metadata for folders', () => {
      render(<PropertiesDialog {...defaultProps} isFolder={true} fileKey="test-folder/" />);

      expect(window.electronAPI.getObjectMetadata).not.toHaveBeenCalled();
    });

    it('shows basic info for folders without metadata fetch', () => {
      render(<PropertiesDialog {...defaultProps} isFolder={true} fileKey="test-folder/" />);

      expect(screen.getByText('test-folder')).toBeInTheDocument();
      expect(screen.getByText('Folder')).toBeInTheDocument();
      expect(screen.getByText('s3://test-bucket/test-folder/')).toBeInTheDocument();
    });
  });

  describe('sections', () => {
    it('displays General section', async () => {
      render(<PropertiesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('General')).toBeInTheDocument();
      });
    });

    it('displays URLs section', async () => {
      render(<PropertiesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('URLs')).toBeInTheDocument();
      });
    });

    it('displays Details section for files', async () => {
      render(<PropertiesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Details')).toBeInTheDocument();
      });
    });

    it('displays Tags section when tags exist', async () => {
      render(<PropertiesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Tags')).toBeInTheDocument();
        expect(screen.getByText('environment:')).toBeInTheDocument();
        expect(screen.getByText('production')).toBeInTheDocument();
        expect(screen.getByText('owner:')).toBeInTheDocument();
        expect(screen.getByText('team-a')).toBeInTheDocument();
      });
    });

    it('displays Custom Metadata section when custom metadata exists', async () => {
      render(<PropertiesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Custom Metadata')).toBeInTheDocument();
        expect(screen.getByText('x-custom-header:')).toBeInTheDocument();
        expect(screen.getByText('custom-value')).toBeInTheDocument();
      });
    });

    it('does not display Tags section when no tags', async () => {
      window.electronAPI.getObjectMetadata = vi.fn().mockResolvedValue({
        success: true,
        metadata: { ...mockMetadata, tags: {} },
      });

      render(<PropertiesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('General')).toBeInTheDocument();
      });

      expect(screen.queryByText('Tags')).not.toBeInTheDocument();
    });

    it('does not display Custom Metadata section when no custom metadata', async () => {
      window.electronAPI.getObjectMetadata = vi.fn().mockResolvedValue({
        success: true,
        metadata: { ...mockMetadata, customMetadata: {} },
      });

      render(<PropertiesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('General')).toBeInTheDocument();
      });

      expect(screen.queryByText('Custom Metadata')).not.toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onClose when Close button is clicked', async () => {
      const onClose = vi.fn();
      render(<PropertiesDialog {...defaultProps} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('General')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Close'));
      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when overlay is clicked', async () => {
      const onClose = vi.fn();
      render(<PropertiesDialog {...defaultProps} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('General')).toBeInTheDocument();
      });

      // Click the overlay (dialog-overlay class)
      const overlay = document.querySelector('.dialog-overlay');
      if (overlay) {
        fireEvent.click(overlay);
        expect(onClose).toHaveBeenCalled();
      }
    });

    it('calls onClose when Escape key is pressed', async () => {
      const onClose = vi.fn();
      render(<PropertiesDialog {...defaultProps} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('General')).toBeInTheDocument();
      });

      fireEvent.keyDown(document.querySelector('.dialog-overlay')!, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });

    it('has Copy buttons for URLs', async () => {
      render(<PropertiesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('General')).toBeInTheDocument();
      });

      const copyButtons = screen.getAllByText('Copy');
      expect(copyButtons).toHaveLength(2); // S3 URI and HTTP URL
    });
  });

  describe('metadata formatting', () => {
    it('formats file size correctly', async () => {
      render(<PropertiesDialog {...defaultProps} />);

      await waitFor(() => {
        // 1234567 bytes = 1.18 MB
        expect(screen.getByText(/1\.18 MB/)).toBeInTheDocument();
      });
    });

    it('formats date correctly', async () => {
      render(<PropertiesDialog {...defaultProps} />);

      await waitFor(() => {
        // Date should be formatted to locale string
        expect(screen.getByText(/2024/)).toBeInTheDocument();
      });
    });

    it('shows ETag value', async () => {
      render(<PropertiesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('abc123def456')).toBeInTheDocument();
      });
    });

    it('shows version ID when present', async () => {
      render(<PropertiesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('v123456')).toBeInTheDocument();
      });
    });

    it('shows encryption info when present', async () => {
      render(<PropertiesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('AES256')).toBeInTheDocument();
      });
    });
  });

  describe('file name extraction', () => {
    it('extracts file name from full key', async () => {
      render(<PropertiesDialog {...defaultProps} fileKey="deep/nested/path/myfile.txt" />);

      window.electronAPI.getObjectMetadata = vi.fn().mockResolvedValue({
        success: true,
        metadata: { ...mockMetadata, key: 'deep/nested/path/myfile.txt' },
      });

      await waitFor(() => {
        expect(screen.getByText('myfile.txt')).toBeInTheDocument();
      });
    });

    it('extracts folder name from folder key', () => {
      render(<PropertiesDialog {...defaultProps} isFolder={true} fileKey="parent/folder-name/" />);

      expect(screen.getByText('folder-name')).toBeInTheDocument();
    });

    it('handles root-level file name', async () => {
      window.electronAPI.getObjectMetadata = vi.fn().mockResolvedValue({
        success: true,
        metadata: { ...mockMetadata, key: 'root-file.txt' },
      });

      render(<PropertiesDialog {...defaultProps} fileKey="root-file.txt" />);

      await waitFor(() => {
        // Use getAllByText since the filename appears in both Name and Key rows
        const elements = screen.getAllByText('root-file.txt');
        expect(elements.length).toBeGreaterThan(0);
      });
    });
  });
});
