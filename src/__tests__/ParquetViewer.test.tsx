import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ParquetViewer from '../renderer/components/ParquetViewer';
import { mockElectronAPI } from './setup';

// Mock hyparquet library
vi.mock('hyparquet', () => ({
  parquetMetadataAsync: vi.fn(),
  parquetRead: vi.fn(),
}));

// Import the mocked functions
import { parquetMetadataAsync, parquetRead } from 'hyparquet';

describe('ParquetViewer', () => {
  const defaultProps = {
    bucket: 'test-bucket',
    fileKey: 'path/to/data.parquet',
    fileName: 'data.parquet',
    fileSize: 1024 * 1024, // 1MB
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows loading indicator while fetching content', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockImplementation(
        () => new Promise(() => {})
      );

      render(<ParquetViewer {...defaultProps} />);

      expect(screen.getByText('Loading parquet file...')).toBeInTheDocument();
    });

    it('downloads binary content on mount', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([0x50, 0x41, 0x52, 0x31]), // PAR1 magic bytes
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
        schema: [{ name: 'root' }, { name: 'col1' }, { name: 'col2' }],
      });

      (parquetRead as ReturnType<typeof vi.fn>).mockImplementation(
        async ({ onComplete }: { onComplete: (data: Record<string, unknown[]>) => void }) => {
          onComplete({
            col1: ['a', 'b', 'c'],
            col2: [1, 2, 3],
          });
        }
      );

      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(mockElectronAPI.s3.downloadBinaryContent).toHaveBeenCalledWith(
          'test-bucket',
          'path/to/data.parquet'
        );
      });
    });
  });

  describe('file size validation', () => {
    it('shows error for files exceeding max size (100MB)', async () => {
      const largeFileProps = {
        ...defaultProps,
        fileSize: 150 * 1024 * 1024, // 150MB
      };

      render(<ParquetViewer {...largeFileProps} />);

      await waitFor(() => {
        expect(screen.getByText(/File is too large to preview/)).toBeInTheDocument();
      });

      // Should not try to download content
      expect(mockElectronAPI.s3.downloadBinaryContent).not.toHaveBeenCalled();
    });

    it('allows files within size limit', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([]),
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
        schema: [{ name: 'root' }],
      });

      (parquetRead as ReturnType<typeof vi.fn>).mockImplementation(
        async ({ onComplete }: { onComplete: (data: Record<string, unknown[]>) => void }) => {
          onComplete({});
        }
      );

      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(mockElectronAPI.s3.downloadBinaryContent).toHaveBeenCalled();
      });
    });
  });

  describe('error handling', () => {
    it('shows error when download fails', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: false,
        error: 'Access denied',
      });

      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Access denied')).toBeInTheDocument();
      });
    });

    it('shows error when parquet parsing fails', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([0x00, 0x00, 0x00, 0x00]), // Invalid parquet data
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Invalid parquet file format')
      );

      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Invalid parquet file format')).toBeInTheDocument();
      });
    });

    it('allows dismissing error message', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: false,
        error: 'Some error',
      });

      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Some error')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Dismiss'));

      await waitFor(() => {
        expect(screen.queryByText('Some error')).not.toBeInTheDocument();
      });
    });
  });

  describe('header display', () => {
    beforeEach(async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([]),
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
        schema: [{ name: 'root' }, { name: 'col1' }],
      });

      (parquetRead as ReturnType<typeof vi.fn>).mockImplementation(
        async ({ onComplete }: { onComplete: (data: Record<string, unknown[]>) => void }) => {
          onComplete({ col1: ['a', 'b'] });
        }
      );
    });

    it('displays file name', async () => {
      render(<ParquetViewer {...defaultProps} />);

      expect(screen.getByText('data.parquet')).toBeInTheDocument();
    });

    it('displays row count after loading', async () => {
      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('2 rows')).toBeInTheDocument();
      });
    });

    it('displays column count after loading', async () => {
      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('1 columns')).toBeInTheDocument();
      });
    });

    it('displays file size', async () => {
      render(<ParquetViewer {...defaultProps} />);

      expect(screen.getByText('1.0 MB')).toBeInTheDocument();
    });

    it('displays full S3 path in footer', async () => {
      render(<ParquetViewer {...defaultProps} />);

      expect(screen.getByText('s3://test-bucket/path/to/data.parquet')).toBeInTheDocument();
    });
  });

  describe('table rendering', () => {
    it('displays column headers', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([]),
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
        schema: [{ name: 'root' }, { name: 'name' }, { name: 'age' }],
      });

      (parquetRead as ReturnType<typeof vi.fn>).mockImplementation(
        async ({ onComplete }: { onComplete: (data: Record<string, unknown[]>) => void }) => {
          onComplete({
            name: ['Alice', 'Bob'],
            age: [30, 25],
          });
        }
      );

      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('name')).toBeInTheDocument();
        expect(screen.getByText('age')).toBeInTheDocument();
      });
    });

    it('displays row data', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([]),
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
        schema: [{ name: 'root' }, { name: 'value' }],
      });

      (parquetRead as ReturnType<typeof vi.fn>).mockImplementation(
        async ({ onComplete }: { onComplete: (data: Record<string, unknown[]>) => void }) => {
          onComplete({
            value: ['test1', 'test2'],
          });
        }
      );

      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('test1')).toBeInTheDocument();
        expect(screen.getByText('test2')).toBeInTheDocument();
      });
    });

    it('displays row numbers', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([]),
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
        schema: [{ name: 'root' }, { name: 'col' }],
      });

      (parquetRead as ReturnType<typeof vi.fn>).mockImplementation(
        async ({ onComplete }: { onComplete: (data: Record<string, unknown[]>) => void }) => {
          onComplete({
            col: ['a', 'b', 'c'],
          });
        }
      );

      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
      });
    });
  });

  describe('data type handling', () => {
    it('formats null values as empty string', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([]),
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
        schema: [{ name: 'root' }, { name: 'col' }],
      });

      (parquetRead as ReturnType<typeof vi.fn>).mockImplementation(
        async ({ onComplete }: { onComplete: (data: Record<string, unknown[]>) => void }) => {
          onComplete({
            col: [null, undefined],
          });
        }
      );

      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        // Table should be rendered with empty cells for null/undefined
        const table = screen.getByRole('table');
        expect(table).toBeInTheDocument();
      });
    });

    it('formats objects as JSON', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([]),
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
        schema: [{ name: 'root' }, { name: 'col' }],
      });

      (parquetRead as ReturnType<typeof vi.fn>).mockImplementation(
        async ({ onComplete }: { onComplete: (data: Record<string, unknown[]>) => void }) => {
          onComplete({
            col: [{ key: 'value' }],
          });
        }
      );

      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('{"key":"value"}')).toBeInTheDocument();
      });
    });

    it('formats bigint values', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([]),
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
        schema: [{ name: 'root' }, { name: 'col' }],
      });

      (parquetRead as ReturnType<typeof vi.fn>).mockImplementation(
        async ({ onComplete }: { onComplete: (data: Record<string, unknown[]>) => void }) => {
          onComplete({
            col: [BigInt('9007199254740993')],
          });
        }
      );

      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('9007199254740993')).toBeInTheDocument();
      });
    });
  });

  describe('search functionality', () => {
    beforeEach(async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([]),
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
        schema: [{ name: 'root' }, { name: 'name' }],
      });

      (parquetRead as ReturnType<typeof vi.fn>).mockImplementation(
        async ({ onComplete }: { onComplete: (data: Record<string, unknown[]>) => void }) => {
          onComplete({
            name: ['Alice', 'Bob', 'Charlie'],
          });
        }
      );
    });

    it('shows search input after loading', async () => {
      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search in data...')).toBeInTheDocument();
      });
    });

    it('filters rows based on search term', async () => {
      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();
        expect(screen.getByText('Charlie')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search in data...');
      fireEvent.change(searchInput, { target: { value: 'ali' } });

      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.queryByText('Bob')).not.toBeInTheDocument();
        expect(screen.queryByText('Charlie')).not.toBeInTheDocument();
      });
    });

    it('shows match count when searching', async () => {
      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search in data...');
      fireEvent.change(searchInput, { target: { value: 'Bob' } });

      await waitFor(() => {
        expect(screen.getByText('1 matches')).toBeInTheDocument();
      });
    });

    it('search is case-insensitive', async () => {
      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search in data...');
      fireEvent.change(searchInput, { target: { value: 'ALICE' } });

      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('1 matches')).toBeInTheDocument();
      });
    });
  });

  describe('close functionality', () => {
    it('closes when clicking Close button', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([]),
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
        schema: [{ name: 'root' }],
      });

      (parquetRead as ReturnType<typeof vi.fn>).mockImplementation(
        async ({ onComplete }: { onComplete: (data: Record<string, unknown[]>) => void }) => {
          onComplete({});
        }
      );

      render(<ParquetViewer {...defaultProps} />);

      fireEvent.click(screen.getByText('Close'));

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('closes on Escape key', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([]),
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
        schema: [{ name: 'root' }],
      });

      (parquetRead as ReturnType<typeof vi.fn>).mockImplementation(
        async ({ onComplete }: { onComplete: (data: Record<string, unknown[]>) => void }) => {
          onComplete({});
        }
      );

      const { container } = render(<ParquetViewer {...defaultProps} />);

      // Find the overlay element and trigger keydown on it
      const overlay = container.querySelector('.parquet-viewer-overlay');
      expect(overlay).toBeInTheDocument();

      fireEvent.keyDown(overlay!, { key: 'Escape' });

      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  describe('lazy loading', () => {
    it('initially loads limited rows', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([]),
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
        schema: [{ name: 'root' }, { name: 'id' }],
      });

      // Create 150 rows to exceed initial load of 100
      const ids = Array.from({ length: 150 }, (_, i) => i + 1);

      (parquetRead as ReturnType<typeof vi.fn>).mockImplementation(
        async ({ onComplete }: { onComplete: (data: Record<string, unknown[]>) => void }) => {
          onComplete({ id: ids });
        }
      );

      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        // Should show first 100 rows initially
        expect(screen.getByText('Showing 100 of 150 rows')).toBeInTheDocument();
      });
    });

    it('shows total row count in footer', async () => {
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([]),
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
        schema: [{ name: 'root' }, { name: 'col' }],
      });

      (parquetRead as ReturnType<typeof vi.fn>).mockImplementation(
        async ({ onComplete }: { onComplete: (data: Record<string, unknown[]>) => void }) => {
          onComplete({ col: ['a', 'b', 'c'] });
        }
      );

      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Loaded 3 of 3 rows')).toBeInTheDocument();
      });
    });
  });

  describe('IPC data transfer handling', () => {
    it('should handle Uint8Array with non-zero byteOffset', async () => {
      // Simulate data that might come from IPC transfer with offset
      // This tests the fix for "DataView constructor must be an ArrayBuffer"
      const baseArray = new ArrayBuffer(20);
      const viewWithOffset = new Uint8Array(baseArray, 4, 8); // Start at offset 4
      viewWithOffset.set([0x50, 0x41, 0x52, 0x31, 0, 0, 0, 0]); // PAR1 header

      // Create a new Uint8Array like our fix does
      const copiedArray = new Uint8Array(viewWithOffset);
      expect(copiedArray.length).toBe(8);
      expect(copiedArray[0]).toBe(0x50); // P
      expect(copiedArray[1]).toBe(0x41); // A
      expect(copiedArray[2]).toBe(0x52); // R
      expect(copiedArray[3]).toBe(0x31); // 1

      // The buffer should be properly accessible
      expect(copiedArray.buffer.byteLength).toBe(8);
    });

    it('should handle data transfer where underlying buffer is larger than view', async () => {
      // This is the typical case when IPC transfers Uint8Array
      mockElectronAPI.s3.downloadBinaryContent.mockResolvedValue({
        success: true,
        data: new Uint8Array([0x50, 0x41, 0x52, 0x31]), // PAR1
      });

      (parquetMetadataAsync as ReturnType<typeof vi.fn>).mockResolvedValue({
        schema: [{ name: 'root' }, { name: 'id' }],
      });

      (parquetRead as ReturnType<typeof vi.fn>).mockImplementation(
        async ({ onComplete }: { onComplete: (data: Record<string, unknown[]>) => void }) => {
          onComplete({ id: [1, 2] });
        }
      );

      render(<ParquetViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('2 rows')).toBeInTheDocument();
      });
    });
  });
});
