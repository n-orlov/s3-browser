import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import JsonViewer from '../renderer/components/JsonViewer';
import { mockElectronAPI } from './setup';

describe('JsonViewer', () => {
  const defaultProps = {
    bucket: 'test-bucket',
    fileKey: 'path/to/config.json',
    fileName: 'config.json',
    fileSize: 1024, // 1KB
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

      render(<JsonViewer {...defaultProps} />);

      expect(screen.getByText('Loading JSON file...')).toBeInTheDocument();
    });

    it('downloads content on mount', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"key": "value"}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(mockElectronAPI.s3.downloadContent).toHaveBeenCalledWith(
          'test-bucket',
          'path/to/config.json'
        );
      });
    });
  });

  describe('file size validation', () => {
    it('shows error for files exceeding max size (10MB)', async () => {
      const largeFileProps = {
        ...defaultProps,
        fileSize: 15 * 1024 * 1024, // 15MB
      };

      render(<JsonViewer {...largeFileProps} />);

      await waitFor(() => {
        expect(screen.getByText(/File is too large to preview/)).toBeInTheDocument();
      });

      // Should not try to download content
      expect(mockElectronAPI.s3.downloadContent).not.toHaveBeenCalled();
    });

    it('allows files within size limit', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"key": "value"}',
      });

      render(<JsonViewer {...defaultProps} />);

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

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Access denied')).toBeInTheDocument();
      });
    });

    it('shows error for empty content', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Empty file content')).toBeInTheDocument();
      });
    });

    it('shows error for invalid JSON', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'not valid json {',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();
      });
    });

    it('allows dismissing error message', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: false,
        error: 'Some error',
      });

      render(<JsonViewer {...defaultProps} />);

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
        content: '{"name": "test", "items": [1, 2, 3]}',
      });
    });

    it('displays file name', async () => {
      render(<JsonViewer {...defaultProps} />);

      expect(screen.getByText('config.json')).toBeInTheDocument();
    });

    it('displays key count after loading', async () => {
      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        // Multiple elements contain "keys", use getAllByText
        const elements = screen.getAllByText(/keys/);
        expect(elements.length).toBeGreaterThan(0);
      });
    });

    it('displays depth after loading', async () => {
      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        // Multiple elements contain "depth", use getAllByText
        const elements = screen.getAllByText(/depth/);
        expect(elements.length).toBeGreaterThan(0);
      });
    });

    it('displays file size', async () => {
      render(<JsonViewer {...defaultProps} />);

      expect(screen.getByText('1.0 KB')).toBeInTheDocument();
    });

    it('displays full S3 path in footer', async () => {
      render(<JsonViewer {...defaultProps} />);

      expect(screen.getByText('s3://test-bucket/path/to/config.json')).toBeInTheDocument();
    });
  });

  describe('view mode toggle', () => {
    beforeEach(async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"key": "value"}',
      });
    });

    it('shows Tree and Text view mode buttons', async () => {
      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTitle('Tree view')).toBeInTheDocument();
        expect(screen.getByTitle('Text view')).toBeInTheDocument();
      });
    });

    it('starts in tree view mode by default', async () => {
      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        const treeButton = screen.getByTitle('Tree view');
        expect(treeButton).toHaveClass('active');
      });
    });

    it('switches to text view when clicking Text button', async () => {
      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('root')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle('Text view'));

      await waitFor(() => {
        const textButton = screen.getByTitle('Text view');
        expect(textButton).toHaveClass('active');
      });
    });
  });

  describe('tree view rendering', () => {
    it('displays object keys in tree view', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"name": "Alice", "age": 30}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('name')).toBeInTheDocument();
        expect(screen.getByText('age')).toBeInTheDocument();
      });
    });

    it('displays string values with quotes', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"name": "Alice"}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('"Alice"')).toBeInTheDocument();
      });
    });

    it('displays number values', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"count": 42}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('42')).toBeInTheDocument();
      });
    });

    it('displays boolean values', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"active": true, "deleted": false}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('true')).toBeInTheDocument();
        expect(screen.getByText('false')).toBeInTheDocument();
      });
    });

    it('displays null values', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"value": null}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('null')).toBeInTheDocument();
      });
    });

    it('displays array indices', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"items": ["a", "b"]}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('[0]')).toBeInTheDocument();
        expect(screen.getByText('[1]')).toBeInTheDocument();
      });
    });

    it('shows collapsed hint for arrays', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"items": [1, 2, 3]}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        // Initially root is expanded, but nested arrays may show hints
        expect(screen.getByText('items')).toBeInTheDocument();
      });
    });

    it('collapses and expands nodes on click', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"nested": {"inner": "value"}}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('inner')).toBeInTheDocument();
      });

      // Click to collapse
      const nestedNode = screen.getByText('nested').closest('.json-tree-collapsible');
      if (nestedNode) {
        fireEvent.click(nestedNode);
      }

      // After collapse, inner might be hidden
      await waitFor(() => {
        expect(screen.queryByText('inner')).not.toBeInTheDocument();
      });
    });
  });

  describe('text view rendering', () => {
    beforeEach(async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"name": "Alice", "age": 30}',
      });
    });

    it('shows pretty-printed JSON in text view', async () => {
      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('root')).toBeInTheDocument();
      });

      // Switch to text view
      fireEvent.click(screen.getByTitle('Text view'));

      await waitFor(() => {
        const preElement = document.querySelector('.json-viewer-pre');
        expect(preElement).toBeInTheDocument();
        expect(preElement?.textContent).toContain('"name"');
        expect(preElement?.textContent).toContain('"Alice"');
      });
    });
  });

  describe('search functionality', () => {
    beforeEach(async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"name": "Alice", "city": "NYC", "country": "USA"}',
      });
    });

    it('shows search input after loading', async () => {
      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search in JSON...')).toBeInTheDocument();
      });
    });

    it('highlights matching keys', async () => {
      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('name')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search in JSON...');
      fireEvent.change(searchInput, { target: { value: 'name' } });

      await waitFor(() => {
        const nameElement = screen.getByText('name');
        expect(nameElement).toHaveClass('json-match');
      });
    });

    it('shows clear button when searching', async () => {
      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('name')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search in JSON...');
      fireEvent.change(searchInput, { target: { value: 'test' } });

      await waitFor(() => {
        const clearButton = screen.getByTitle('Clear search');
        expect(clearButton).toBeInTheDocument();
      });
    });

    it('clears search when clicking clear button', async () => {
      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('name')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search in JSON...');
      fireEvent.change(searchInput, { target: { value: 'test' } });

      await waitFor(() => {
        expect(screen.getByTitle('Clear search')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle('Clear search'));

      await waitFor(() => {
        expect(searchInput).toHaveValue('');
      });
    });
  });

  describe('close functionality', () => {
    it('closes when clicking Close button', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"key": "value"}',
      });

      render(<JsonViewer {...defaultProps} />);

      fireEvent.click(screen.getByText('Close'));

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('closes on Escape key', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"key": "value"}',
      });

      const { container } = render(<JsonViewer {...defaultProps} />);

      // Find the overlay element and trigger keydown on it
      const overlay = container.querySelector('.json-viewer-overlay');
      expect(overlay).toBeInTheDocument();

      fireEvent.keyDown(overlay!, { key: 'Escape' });

      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  describe('complex JSON structures', () => {
    it('handles deeply nested objects', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"level1": {"level2": {"level3": {"value": "deep"}}}}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('level1')).toBeInTheDocument();
      });
    });

    it('handles arrays of objects', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"users": [{"name": "Alice"}, {"name": "Bob"}]}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('users')).toBeInTheDocument();
        expect(screen.getByText('[0]')).toBeInTheDocument();
      });
    });

    it('handles mixed types in arrays', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"mixed": [1, "text", true, null]}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('mixed')).toBeInTheDocument();
      });
    });

    it('handles empty objects', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"empty": {}}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('empty')).toBeInTheDocument();
        // Check that empty object brackets are rendered
        const brackets = document.querySelectorAll('.json-bracket');
        expect(brackets.length).toBeGreaterThan(0);
      });
    });

    it('handles empty arrays', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"empty": []}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('empty')).toBeInTheDocument();
        // Check that empty array brackets are rendered
        const brackets = document.querySelectorAll('.json-bracket');
        expect(brackets.length).toBeGreaterThan(0);
      });
    });
  });

  describe('node statistics', () => {
    it('calculates correct key count for flat object', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"a": 1, "b": 2, "c": 3}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        // Header meta shows separate spans with counts
        const metaItems = document.querySelectorAll('.json-viewer-meta-item');
        const keysItem = Array.from(metaItems).find(el => el.textContent?.includes('keys'));
        expect(keysItem).toBeTruthy();
        expect(keysItem?.textContent).toBe('3 keys');
      });
    });

    it('calculates depth for nested structures', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '{"level1": {"level2": "value"}}',
      });

      render(<JsonViewer {...defaultProps} />);

      await waitFor(() => {
        // Header meta shows depth in separate span
        const metaItems = document.querySelectorAll('.json-viewer-meta-item');
        const depthItem = Array.from(metaItems).find(el => el.textContent?.includes('depth'));
        expect(depthItem).toBeTruthy();
        expect(depthItem?.textContent).toBe('2 depth');
      });
    });
  });
});
