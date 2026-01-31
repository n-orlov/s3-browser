import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import YamlViewer from '../renderer/components/YamlViewer';
import { mockElectronAPI } from './setup';

describe('YamlViewer', () => {
  const defaultProps = {
    bucket: 'test-bucket',
    fileKey: 'path/to/config.yaml',
    fileName: 'config.yaml',
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

      render(<YamlViewer {...defaultProps} />);

      expect(screen.getByText('Loading YAML file...')).toBeInTheDocument();
    });

    it('downloads content on mount', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name: test\nvalue: 123',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        expect(mockElectronAPI.s3.downloadContent).toHaveBeenCalledWith(
          'test-bucket',
          'path/to/config.yaml'
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

      render(<YamlViewer {...largeFileProps} />);

      await waitFor(() => {
        expect(screen.getByText(/File is too large to preview/)).toBeInTheDocument();
      });

      // Should not try to download content
      expect(mockElectronAPI.s3.downloadContent).not.toHaveBeenCalled();
    });

    it('allows files within size limit', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name: test',
      });

      render(<YamlViewer {...defaultProps} />);

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

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Access denied')).toBeInTheDocument();
      });
    });

    it('shows error for empty content', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Empty file content')).toBeInTheDocument();
      });
    });

    it('allows dismissing error message', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: false,
        error: 'Some error',
      });

      render(<YamlViewer {...defaultProps} />);

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
        content: 'name: test\nvalue: 123\nitems:\n  - one\n  - two',
      });
    });

    it('displays file name', async () => {
      render(<YamlViewer {...defaultProps} />);

      expect(screen.getByText('config.yaml')).toBeInTheDocument();
    });

    it('displays YAML icon/label', async () => {
      render(<YamlViewer {...defaultProps} />);

      expect(screen.getByText('YAML')).toBeInTheDocument();
    });

    it('displays line count after loading', async () => {
      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        const elements = screen.getAllByText(/lines/);
        expect(elements.length).toBeGreaterThan(0);
      });
    });

    it('displays key count after loading', async () => {
      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        const elements = screen.getAllByText(/keys/);
        expect(elements.length).toBeGreaterThan(0);
      });
    });

    it('displays file size', async () => {
      render(<YamlViewer {...defaultProps} />);

      expect(screen.getByText('1.0 KB')).toBeInTheDocument();
    });

    it('displays full S3 path in footer', async () => {
      render(<YamlViewer {...defaultProps} />);

      expect(screen.getByText('s3://test-bucket/path/to/config.yaml')).toBeInTheDocument();
    });
  });

  describe('content rendering', () => {
    it('displays YAML content with line numbers', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name: test\nvalue: 123',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
      });
    });

    it('displays key names with syntax highlighting', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'username: admin',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        const keyElement = document.querySelector('.yaml-key');
        expect(keyElement).toBeInTheDocument();
        expect(keyElement?.textContent).toBe('username');
      });
    });

    it('highlights boolean values', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'enabled: true\ndisabled: false',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        const boolElements = document.querySelectorAll('.yaml-boolean');
        expect(boolElements.length).toBe(2);
      });
    });

    it('highlights null values', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'value: null\nempty: ~',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        const nullElements = document.querySelectorAll('.yaml-null');
        expect(nullElements.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('highlights number values', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'count: 42\nprice: 19.99',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        const numberElements = document.querySelectorAll('.yaml-number');
        expect(numberElements.length).toBe(2);
      });
    });

    it('highlights comments', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: '# This is a comment\nname: test',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        const commentElement = document.querySelector('.yaml-comment');
        expect(commentElement).toBeInTheDocument();
        expect(commentElement?.textContent).toContain('# This is a comment');
      });
    });

    it('handles list items', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'items:\n  - first\n  - second',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('items')).toBeInTheDocument();
      });
    });
  });

  describe('search functionality', () => {
    beforeEach(async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name: Alice\ncity: NYC\ncountry: USA',
      });
    });

    it('shows search input after loading', async () => {
      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search in YAML...')).toBeInTheDocument();
      });
    });

    it('highlights matching text', async () => {
      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('name')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search in YAML...');
      fireEvent.change(searchInput, { target: { value: 'Alice' } });

      await waitFor(() => {
        const matchElement = document.querySelector('.yaml-search-match');
        expect(matchElement).toBeInTheDocument();
        expect(matchElement?.textContent).toBe('Alice');
      });
    });

    it('shows match count when searching', async () => {
      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('name')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search in YAML...');
      fireEvent.change(searchInput, { target: { value: 'A' } });

      await waitFor(() => {
        expect(screen.getByText(/match/)).toBeInTheDocument();
      });
    });

    it('shows clear button when searching', async () => {
      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('name')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search in YAML...');
      fireEvent.change(searchInput, { target: { value: 'test' } });

      await waitFor(() => {
        const clearButton = screen.getByTitle('Clear search');
        expect(clearButton).toBeInTheDocument();
      });
    });

    it('clears search when clicking clear button', async () => {
      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('name')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search in YAML...');
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
        content: 'key: value',
      });

      render(<YamlViewer {...defaultProps} />);

      fireEvent.click(screen.getByText('Close'));

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('closes on Escape key', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'key: value',
      });

      const { container } = render(<YamlViewer {...defaultProps} />);

      // Find the overlay element and trigger keydown on it
      const overlay = container.querySelector('.yaml-viewer-overlay');
      expect(overlay).toBeInTheDocument();

      fireEvent.keyDown(overlay!, { key: 'Escape' });

      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  describe('complex YAML structures', () => {
    it('handles nested objects', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'database:\n  host: localhost\n  port: 5432',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('database')).toBeInTheDocument();
        expect(screen.getByText('host')).toBeInTheDocument();
        expect(screen.getByText('port')).toBeInTheDocument();
      });
    });

    it('handles arrays of objects', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'users:\n  - name: Alice\n  - name: Bob',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('users')).toBeInTheDocument();
      });
    });

    it('handles anchors', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'defaults: &defaults\n  timeout: 30',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        const anchorElement = document.querySelector('.yaml-anchor');
        expect(anchorElement).toBeInTheDocument();
        expect(anchorElement?.textContent).toBe('&defaults');
      });
    });

    it('handles aliases', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'defaults: &defaults\n  timeout: 30\nproduction: *defaults',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        const aliasElement = document.querySelector('.yaml-alias');
        expect(aliasElement).toBeInTheDocument();
        expect(aliasElement?.textContent).toBe('*defaults');
      });
    });

    it('handles multiline strings with pipe', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'description: |\n  This is a\n  multiline string',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('description')).toBeInTheDocument();
        // The pipe should be present in the content
        const preElement = document.querySelector('.yaml-viewer-pre');
        expect(preElement?.textContent).toContain('|');
      });
    });

    it('handles quoted strings', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'message: "Hello, World!"\npath: \'/usr/local\'',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('message')).toBeInTheDocument();
        expect(screen.getByText('path')).toBeInTheDocument();
      });
    });
  });

  describe('yml file extension', () => {
    it('works with .yml files', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'name: test',
      });

      const ymlProps = {
        ...defaultProps,
        fileKey: 'path/to/config.yml',
        fileName: 'config.yml',
      };

      render(<YamlViewer {...ymlProps} />);

      await waitFor(() => {
        expect(mockElectronAPI.s3.downloadContent).toHaveBeenCalledWith(
          'test-bucket',
          'path/to/config.yml'
        );
      });
    });
  });

  describe('stats calculation', () => {
    it('calculates correct line count', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'line1: a\nline2: b\nline3: c',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        // Look for the meta item with lines count
        const metaItems = document.querySelectorAll('.yaml-viewer-meta-item');
        const linesItem = Array.from(metaItems).find(el => el.textContent?.includes('lines'));
        expect(linesItem).toBeTruthy();
        expect(linesItem?.textContent).toBe('3 lines');
      });
    });

    it('calculates correct key count', async () => {
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: 'key1: value1\nkey2: value2\nnested:\n  key3: value3',
      });

      render(<YamlViewer {...defaultProps} />);

      await waitFor(() => {
        // Look for the meta item with keys count
        const metaItems = document.querySelectorAll('.yaml-viewer-meta-item');
        const keysItem = Array.from(metaItems).find(el => el.textContent?.includes('keys'));
        expect(keysItem).toBeTruthy();
        expect(keysItem?.textContent).toBe('4 keys');
      });
    });
  });
});
