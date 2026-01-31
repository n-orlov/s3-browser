import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import CsvViewer from '../renderer/components/CsvViewer';
import { mockElectronAPI } from './setup';

describe('CsvViewer', () => {
  const defaultProps = {
    bucket: 'test-bucket',
    fileKey: 'path/to/data.csv',
    fileName: 'data.csv',
    fileSize: 1024 * 1024, // 1MB
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows loading indicator while fetching content', async () => {
      mockElectronAPI.s3.downloadContent.mockImplementation(
        () => new Promise(() => {})
      );

      render(<CsvViewer {...defaultProps} />);

      expect(screen.getByText('Loading CSV file...')).toBeInTheDocument();
    });

    it('downloads content on mount', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name,age\nAlice,30\nBob,25',
      });

      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(mockElectronAPI.s3.downloadContent).toHaveBeenCalledWith(
          'test-bucket',
          'path/to/data.csv'
        );
      });
    });
  });

  describe('file size validation', () => {
    it('shows error for files exceeding max size (50MB)', async () => {
      const largeFileProps = {
        ...defaultProps,
        fileSize: 60 * 1024 * 1024, // 60MB
      };

      render(<CsvViewer {...largeFileProps} />);

      await waitFor(() => {
        expect(screen.getByText(/File is too large to preview/)).toBeInTheDocument();
      });

      // Should not try to download content
      expect(mockElectronAPI.s3.downloadContent).not.toHaveBeenCalled();
    });

    it('allows files within size limit', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name\ntest',
      });

      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(mockElectronAPI.s3.downloadContent).toHaveBeenCalled();
      });
    });
  });

  describe('error handling', () => {
    it('shows error when download fails', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: false,
        error: 'Access denied',
      });

      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Access denied')).toBeInTheDocument();
      });
    });

    it('shows error for empty content', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '',
      });

      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Empty file content')).toBeInTheDocument();
      });
    });

    it('allows dismissing error message', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: false,
        error: 'Some error',
      });

      render(<CsvViewer {...defaultProps} />);

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
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name,age\nAlice,30\nBob,25',
      });
    });

    it('displays file name', async () => {
      render(<CsvViewer {...defaultProps} />);

      expect(screen.getByText('data.csv')).toBeInTheDocument();
    });

    it('displays row count after loading', async () => {
      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('2 rows')).toBeInTheDocument();
      });
    });

    it('displays column count after loading', async () => {
      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('2 columns')).toBeInTheDocument();
      });
    });

    it('displays file size', async () => {
      render(<CsvViewer {...defaultProps} />);

      expect(screen.getByText('1.0 MB')).toBeInTheDocument();
    });

    it('displays full S3 path in footer', async () => {
      render(<CsvViewer {...defaultProps} />);

      expect(screen.getByText('s3://test-bucket/path/to/data.csv')).toBeInTheDocument();
    });
  });

  describe('table rendering', () => {
    it('displays column headers', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name,age,city\nAlice,30,NYC\nBob,25,LA',
      });

      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('name')).toBeInTheDocument();
        expect(screen.getByText('age')).toBeInTheDocument();
        expect(screen.getByText('city')).toBeInTheDocument();
      });
    });

    it('displays row data', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'value\ntest1\ntest2',
      });

      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('test1')).toBeInTheDocument();
        expect(screen.getByText('test2')).toBeInTheDocument();
      });
    });

    it('displays row numbers', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'col\na\nb\nc',
      });

      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
      });
    });
  });

  describe('CSV parsing', () => {
    it('handles quoted fields with commas', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name,description\nAlice,"Hello, world"',
      });

      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Hello, world')).toBeInTheDocument();
      });
    });

    it('handles quoted fields with escaped quotes', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name,quote\nAlice,"She said ""hello"""',
      });

      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('She said "hello"')).toBeInTheDocument();
      });
    });

    it('handles CRLF line endings', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name\r\nAlice\r\nBob',
      });

      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();
      });
    });

    it('handles quoted fields with newlines', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name,bio\nAlice,"Line 1\nLine 2"',
      });

      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        // The Alice row should be present
        expect(screen.getByText('Alice')).toBeInTheDocument();
        // The table should render with 1 data row
        expect(screen.getByText('1 rows')).toBeInTheDocument();
      });
    });

    it('handles rows with fewer columns than headers', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'a,b,c\nfoo\nbar,baz',
      });

      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('foo')).toBeInTheDocument();
        expect(screen.getByText('bar')).toBeInTheDocument();
        expect(screen.getByText('baz')).toBeInTheDocument();
        // The row should still be rendered with empty cells for missing columns
        const table = screen.getByRole('table');
        expect(table).toBeInTheDocument();
      });
    });

    it('handles empty rows by skipping them', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name\nAlice\n\nBob',
      });

      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();
        // Should only have 2 data rows
        expect(screen.getByText('2 rows')).toBeInTheDocument();
      });
    });
  });

  describe('search functionality', () => {
    beforeEach(async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name\nAlice\nBob\nCharlie',
      });
    });

    it('shows search input after loading', async () => {
      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search in data...')).toBeInTheDocument();
      });
    });

    it('filters rows based on search term', async () => {
      render(<CsvViewer {...defaultProps} />);

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
      render(<CsvViewer {...defaultProps} />);

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
      render(<CsvViewer {...defaultProps} />);

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
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name\ntest',
      });

      render(<CsvViewer {...defaultProps} />);

      fireEvent.click(screen.getByText('Close'));

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('closes on Escape key', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name\ntest',
      });

      const { container } = render(<CsvViewer {...defaultProps} />);

      // Find the overlay element and trigger keydown on it
      const overlay = container.querySelector('.csv-viewer-overlay');
      expect(overlay).toBeInTheDocument();

      fireEvent.keyDown(overlay!, { key: 'Escape' });

      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  describe('lazy loading', () => {
    it('initially loads limited rows', async () => {
      // Create 150 rows to exceed initial load of 100
      const rows = ['id'];
      for (let i = 1; i <= 150; i++) {
        rows.push(String(i));
      }

      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: rows.join('\n'),
      });

      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        // Should show first 100 rows initially
        expect(screen.getByText('Showing 100 of 150 rows')).toBeInTheDocument();
      });
    });

    it('shows total row count in footer', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'col\na\nb\nc',
      });

      render(<CsvViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Loaded 3 of 3 rows')).toBeInTheDocument();
      });
    });
  });
});
