import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ImagePreview from '../renderer/components/ImagePreview';
import { mockElectronAPI } from './setup';

// Mock URL.createObjectURL and URL.revokeObjectURL
const mockObjectUrl = 'blob:mock-url';
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => mockObjectUrl);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

describe('ImagePreview', () => {
  const defaultProps = {
    bucket: 'test-bucket',
    fileKey: 'path/to/image.png',
    fileName: 'image.png',
    fileSize: 1024 * 1024, // 1MB
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows loading indicator while fetching image', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockImplementation(() => new Promise(() => {}));

      render(<ImagePreview {...defaultProps} />);

      expect(screen.getByText('Loading image...')).toBeInTheDocument();
    });

    it('loads image content on mount', async () => {
      const testData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: testData,
      });

      render(<ImagePreview {...defaultProps} />);

      await waitFor(() => {
        expect(mockElectronAPI.s3.downloadBinaryContent).toHaveBeenCalledWith(
          'test-bucket',
          'path/to/image.png'
        );
      });

      await waitFor(() => {
        const image = screen.getByRole('img');
        expect(image).toHaveAttribute('src', mockObjectUrl);
      });
    });
  });

  describe('file size validation', () => {
    it('shows error for files exceeding max size (50MB)', async () => {
      render(
        <ImagePreview
          {...defaultProps}
          fileSize={60 * 1024 * 1024} // 60MB
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Image file is too large to preview/)).toBeInTheDocument();
      });

      // Should not try to download content
      expect(mockElectronAPI.s3.downloadBinaryContent).not.toHaveBeenCalled();
    });

    it('allows images within size limit', async () => {
      const testData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: testData,
      });

      render(
        <ImagePreview
          {...defaultProps}
          fileSize={10 * 1024 * 1024} // 10MB - within limit
        />
      );

      await waitFor(() => {
        expect(mockElectronAPI.s3.downloadBinaryContent).toHaveBeenCalled();
      });
    });
  });

  describe('error handling', () => {
    it('shows error when image download fails', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: false,
        error: 'Access denied',
      });

      render(<ImagePreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Access denied/)).toBeInTheDocument();
      });
    });

    it('allows dismissing error message', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: false,
        error: 'Some error',
      });

      render(<ImagePreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Some error/)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Dismiss'));

      await waitFor(() => {
        expect(screen.queryByText(/Some error/)).not.toBeInTheDocument();
      });
    });
  });

  describe('header display', () => {
    it('displays file name', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array(),
      });

      render(<ImagePreview {...defaultProps} />);

      expect(screen.getByText('image.png')).toBeInTheDocument();
    });

    it('displays file size', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array(),
      });

      render(<ImagePreview {...defaultProps} fileSize={1024 * 1024} />);

      expect(screen.getByText('1.0 MB')).toBeInTheDocument();
    });

    it('displays full S3 path in footer', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array(),
      });

      render(<ImagePreview {...defaultProps} />);

      expect(screen.getByText('s3://test-bucket/path/to/image.png')).toBeInTheDocument();
    });
  });

  describe('zoom controls', () => {
    beforeEach(async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      });
    });

    it('displays zoom value', async () => {
      render(<ImagePreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('100%')).toBeInTheDocument();
      });
    });

    it('zooms in when + button is clicked', async () => {
      render(<ImagePreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument();
      });

      const zoomInButton = screen.getByTitle('Zoom in (+)');
      fireEvent.click(zoomInButton);

      await waitFor(() => {
        expect(screen.getByText('125%')).toBeInTheDocument();
      });
    });

    it('zooms out when - button is clicked', async () => {
      render(<ImagePreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument();
      });

      const zoomOutButton = screen.getByTitle('Zoom out (-)');
      fireEvent.click(zoomOutButton);

      await waitFor(() => {
        expect(screen.getByText('75%')).toBeInTheDocument();
      });
    });

    it('resets zoom when clicking on zoom value', async () => {
      render(<ImagePreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument();
      });

      // Zoom in first
      const zoomInButton = screen.getByTitle('Zoom in (+)');
      fireEvent.click(zoomInButton);
      fireEvent.click(zoomInButton);

      await waitFor(() => {
        expect(screen.getByText('150%')).toBeInTheDocument();
      });

      // Click to reset
      fireEvent.click(screen.getByText('150%'));

      await waitFor(() => {
        expect(screen.getByText('100%')).toBeInTheDocument();
      });
    });

    it('disables zoom out at minimum zoom (25%)', async () => {
      render(<ImagePreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument();
      });

      // Zoom out to minimum
      const zoomOutButton = screen.getByTitle('Zoom out (-)');
      for (let i = 0; i < 3; i++) {
        fireEvent.click(zoomOutButton);
      }

      await waitFor(() => {
        expect(screen.getByText('25%')).toBeInTheDocument();
      });

      expect(zoomOutButton).toBeDisabled();
    });

    it('disables zoom in at maximum zoom (500%)', async () => {
      render(<ImagePreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument();
      });

      // Zoom in to maximum
      const zoomInButton = screen.getByTitle('Zoom in (+)');
      for (let i = 0; i < 16; i++) {
        fireEvent.click(zoomInButton);
      }

      await waitFor(() => {
        expect(screen.getByText('500%')).toBeInTheDocument();
      });

      expect(zoomInButton).toBeDisabled();
    });
  });

  describe('close functionality', () => {
    it('calls onClose when Close button is clicked', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array(),
      });

      render(<ImagePreview {...defaultProps} />);

      fireEvent.click(screen.getByText('Close'));

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('calls onClose when Escape key is pressed', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array(),
      });

      render(<ImagePreview {...defaultProps} />);

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('calls onClose when clicking overlay background', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array(),
      });

      render(<ImagePreview {...defaultProps} />);

      const overlay = screen.getByRole('dialog').parentElement;
      fireEvent.click(overlay!);

      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  describe('keyboard shortcuts', () => {
    beforeEach(async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      });
    });

    it('zooms in with + key', async () => {
      render(<ImagePreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument();
      });

      fireEvent.keyDown(window, { key: '+' });

      await waitFor(() => {
        expect(screen.getByText('125%')).toBeInTheDocument();
      });
    });

    it('zooms in with = key', async () => {
      render(<ImagePreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument();
      });

      fireEvent.keyDown(window, { key: '=' });

      await waitFor(() => {
        expect(screen.getByText('125%')).toBeInTheDocument();
      });
    });

    it('zooms out with - key', async () => {
      render(<ImagePreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument();
      });

      fireEvent.keyDown(window, { key: '-' });

      await waitFor(() => {
        expect(screen.getByText('75%')).toBeInTheDocument();
      });
    });

    it('resets zoom with 0 key', async () => {
      render(<ImagePreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument();
      });

      // Zoom in first
      fireEvent.keyDown(window, { key: '+' });
      fireEvent.keyDown(window, { key: '+' });

      await waitFor(() => {
        expect(screen.getByText('150%')).toBeInTheDocument();
      });

      // Reset with 0
      fireEvent.keyDown(window, { key: '0' });

      await waitFor(() => {
        expect(screen.getByText('100%')).toBeInTheDocument();
      });
    });
  });

  describe('MIME type detection', () => {
    const testCases = [
      { fileName: 'image.png', expectedMime: 'image/png' },
      { fileName: 'photo.jpg', expectedMime: 'image/jpeg' },
      { fileName: 'photo.jpeg', expectedMime: 'image/jpeg' },
      { fileName: 'animation.gif', expectedMime: 'image/gif' },
      { fileName: 'modern.webp', expectedMime: 'image/webp' },
      { fileName: 'vector.svg', expectedMime: 'image/svg+xml' },
      { fileName: 'icon.ico', expectedMime: 'image/x-icon' },
      { fileName: 'bitmap.bmp', expectedMime: 'image/bmp' },
    ];

    testCases.forEach(({ fileName, expectedMime }) => {
      it(`creates blob with correct MIME type for ${fileName}`, async () => {
        const testData = new Uint8Array([0x00]);
        mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
          success: true,
          data: testData,
        });

        render(
          <ImagePreview
            {...defaultProps}
            fileKey={`path/to/${fileName}`}
            fileName={fileName}
          />
        );

        await waitFor(() => {
          expect(URL.createObjectURL).toHaveBeenCalled();
        });

        // Check that Blob was created with correct MIME type
        const blobCall = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(blobCall.type).toBe(expectedMime);
      });
    });
  });

  describe('cleanup', () => {
    it('revokes object URL on unmount', async () => {
      const testData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: testData,
      });

      const { unmount } = render(<ImagePreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument();
      });

      unmount();

      expect(URL.revokeObjectURL).toHaveBeenCalledWith(mockObjectUrl);
    });
  });
});
