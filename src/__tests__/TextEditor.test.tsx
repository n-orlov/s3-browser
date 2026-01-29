import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import TextEditor from '../renderer/components/TextEditor';
import { mockElectronAPI } from './setup';

// Mock Monaco Editor since it doesn't work in JSDOM
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, onMount }: { value: string; onChange?: (value: string | undefined) => void; onMount?: (editor: unknown) => void }) => {
    // Simulate editor mount
    if (onMount) {
      onMount({ focus: vi.fn() });
    }
    return (
      <textarea
        data-testid="monaco-editor"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );
  },
}));

describe('TextEditor', () => {
  const defaultProps = {
    bucket: 'test-bucket',
    fileKey: 'path/to/file.json',
    fileName: 'file.json',
    onClose: vi.fn(),
    onSaved: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows loading indicator while fetching content', async () => {
      mockElectronAPI.s3.getFileSize.mockImplementation(() => new Promise(() => {}));

      render(<TextEditor {...defaultProps} />);

      expect(screen.getByText('Loading file...')).toBeInTheDocument();
    });

    it('loads file content on mount', async () => {
      const testContent = '{"name": "test"}';
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 100 });
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: true,
        content: testContent,
      });

      render(<TextEditor {...defaultProps} />);

      await waitFor(() => {
        expect(mockElectronAPI.s3.getFileSize).toHaveBeenCalledWith('test-bucket', 'path/to/file.json');
        expect(mockElectronAPI.s3.downloadContent).toHaveBeenCalledWith('test-bucket', 'path/to/file.json');
      });

      await waitFor(() => {
        const editor = screen.getByTestId('monaco-editor') as HTMLTextAreaElement;
        expect(editor.value).toBe(testContent);
      });
    });
  });

  describe('file size validation', () => {
    it('shows error for files exceeding max size', async () => {
      // 10MB - exceeds 5MB limit
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 10 * 1024 * 1024 });

      render(<TextEditor {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/File is too large to edit/)).toBeInTheDocument();
      });

      // Should not try to download content
      expect(mockElectronAPI.s3.downloadContent).not.toHaveBeenCalled();
    });

    it('allows files within size limit', async () => {
      // 1MB - within limit
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 1 * 1024 * 1024 });
      mockElectronAPI.s3.downloadContent.mockResolvedValue({ success: true, content: 'content' });

      render(<TextEditor {...defaultProps} />);

      await waitFor(() => {
        expect(mockElectronAPI.s3.downloadContent).toHaveBeenCalled();
      });
    });
  });

  describe('error handling', () => {
    it('shows error when file size check fails', async () => {
      mockElectronAPI.s3.getFileSize.mockResolvedValue({
        success: false,
        error: 'Access denied',
      });

      render(<TextEditor {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Access denied')).toBeInTheDocument();
      });
    });

    it('shows error when content download fails', async () => {
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 100 });
      mockElectronAPI.s3.downloadContent.mockResolvedValue({
        success: false,
        error: 'Download failed',
      });

      render(<TextEditor {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Download failed')).toBeInTheDocument();
      });
    });

    it('allows dismissing error message', async () => {
      mockElectronAPI.s3.getFileSize.mockResolvedValue({
        success: false,
        error: 'Some error',
      });

      render(<TextEditor {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Some error')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Dismiss'));

      await waitFor(() => {
        expect(screen.queryByText('Some error')).not.toBeInTheDocument();
      });
    });
  });

  describe('editor header', () => {
    it('displays file name', async () => {
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 100 });
      mockElectronAPI.s3.downloadContent.mockResolvedValue({ success: true, content: '' });

      render(<TextEditor {...defaultProps} />);

      expect(screen.getByText('file.json')).toBeInTheDocument();
    });

    it('displays detected language', async () => {
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 100 });
      mockElectronAPI.s3.downloadContent.mockResolvedValue({ success: true, content: '' });

      render(<TextEditor {...defaultProps} />);

      expect(screen.getByText('json')).toBeInTheDocument();
    });

    it('displays full S3 path in footer', async () => {
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 100 });
      mockElectronAPI.s3.downloadContent.mockResolvedValue({ success: true, content: '' });

      render(<TextEditor {...defaultProps} />);

      expect(screen.getByText('s3://test-bucket/path/to/file.json')).toBeInTheDocument();
    });
  });

  describe('modification tracking', () => {
    it('shows modified indicator when content changes', async () => {
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 100 });
      mockElectronAPI.s3.downloadContent.mockResolvedValue({ success: true, content: 'original' });

      render(<TextEditor {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
      });

      // Make a change
      fireEvent.change(screen.getByTestId('monaco-editor'), {
        target: { value: 'modified content' },
      });

      await waitFor(() => {
        expect(screen.getByText('*')).toBeInTheDocument();
        expect(screen.getByText('Modified')).toBeInTheDocument();
      });
    });

    it('removes modified indicator when content matches original', async () => {
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 100 });
      mockElectronAPI.s3.downloadContent.mockResolvedValue({ success: true, content: 'original' });

      render(<TextEditor {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
      });

      // Make a change
      fireEvent.change(screen.getByTestId('monaco-editor'), {
        target: { value: 'modified' },
      });

      // Revert to original
      fireEvent.change(screen.getByTestId('monaco-editor'), {
        target: { value: 'original' },
      });

      await waitFor(() => {
        expect(screen.queryByText('*')).not.toBeInTheDocument();
        expect(screen.getByText('Saved')).toBeInTheDocument();
      });
    });
  });

  describe('save functionality', () => {
    it('saves content to S3', async () => {
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 100 });
      mockElectronAPI.s3.downloadContent.mockResolvedValue({ success: true, content: 'original' });
      mockElectronAPI.s3.uploadContent.mockResolvedValue({ success: true });

      render(<TextEditor {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
      });

      // Make a change
      fireEvent.change(screen.getByTestId('monaco-editor'), {
        target: { value: 'new content' },
      });

      // Click save
      fireEvent.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(mockElectronAPI.s3.uploadContent).toHaveBeenCalledWith(
          'test-bucket',
          'path/to/file.json',
          'new content'
        );
      });
    });

    it('calls onSaved callback after successful save', async () => {
      const onSaved = vi.fn();
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 100 });
      mockElectronAPI.s3.downloadContent.mockResolvedValue({ success: true, content: 'original' });
      mockElectronAPI.s3.uploadContent.mockResolvedValue({ success: true });

      render(<TextEditor {...defaultProps} onSaved={onSaved} />);

      await waitFor(() => {
        expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
      });

      // Make a change and save
      fireEvent.change(screen.getByTestId('monaco-editor'), {
        target: { value: 'new content' },
      });
      fireEvent.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(onSaved).toHaveBeenCalled();
      });
    });

    it('shows error when save fails', async () => {
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 100 });
      mockElectronAPI.s3.downloadContent.mockResolvedValue({ success: true, content: 'original' });
      mockElectronAPI.s3.uploadContent.mockResolvedValue({
        success: false,
        error: 'Upload failed',
      });

      render(<TextEditor {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
      });

      // Make a change and save
      fireEvent.change(screen.getByTestId('monaco-editor'), {
        target: { value: 'new content' },
      });
      fireEvent.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(screen.getByText('Upload failed')).toBeInTheDocument();
      });
    });

    it('disables save button when no changes', async () => {
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 100 });
      mockElectronAPI.s3.downloadContent.mockResolvedValue({ success: true, content: 'original' });

      render(<TextEditor {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
      });

      const saveButton = screen.getByText('Save');
      expect(saveButton).toBeDisabled();
    });
  });

  describe('close functionality', () => {
    it('closes without prompt when no changes', async () => {
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 100 });
      mockElectronAPI.s3.downloadContent.mockResolvedValue({ success: true, content: 'original' });

      render(<TextEditor {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Close'));

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('prompts before closing with unsaved changes', async () => {
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 100 });
      mockElectronAPI.s3.downloadContent.mockResolvedValue({ success: true, content: 'original' });

      // Mock window.confirm
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

      render(<TextEditor {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
      });

      // Make a change
      fireEvent.change(screen.getByTestId('monaco-editor'), {
        target: { value: 'modified' },
      });

      fireEvent.click(screen.getByText('Close'));

      expect(confirmSpy).toHaveBeenCalledWith('You have unsaved changes. Are you sure you want to close?');
      expect(defaultProps.onClose).not.toHaveBeenCalled();

      confirmSpy.mockRestore();
    });

    it('closes when user confirms closing with unsaved changes', async () => {
      mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 100 });
      mockElectronAPI.s3.downloadContent.mockResolvedValue({ success: true, content: 'original' });

      // Mock window.confirm to return true
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      render(<TextEditor {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
      });

      // Make a change
      fireEvent.change(screen.getByTestId('monaco-editor'), {
        target: { value: 'modified' },
      });

      fireEvent.click(screen.getByText('Close'));

      expect(defaultProps.onClose).toHaveBeenCalled();

      confirmSpy.mockRestore();
    });
  });

  describe('language detection', () => {
    const testCases = [
      { fileKey: 'file.json', expectedLanguage: 'json' },
      { fileKey: 'file.yaml', expectedLanguage: 'yaml' },
      { fileKey: 'file.yml', expectedLanguage: 'yaml' },
      { fileKey: 'file.txt', expectedLanguage: 'plaintext' },
      { fileKey: 'file.csv', expectedLanguage: 'plaintext' },
      { fileKey: 'file.js', expectedLanguage: 'javascript' },
      { fileKey: 'file.ts', expectedLanguage: 'typescript' },
      { fileKey: 'file.py', expectedLanguage: 'python' },
      { fileKey: 'file.md', expectedLanguage: 'markdown' },
      { fileKey: 'file.html', expectedLanguage: 'html' },
      { fileKey: 'file.css', expectedLanguage: 'css' },
      { fileKey: 'file.sql', expectedLanguage: 'sql' },
      { fileKey: 'file.unknown', expectedLanguage: 'plaintext' },
    ];

    testCases.forEach(({ fileKey, expectedLanguage }) => {
      it(`detects ${expectedLanguage} for ${fileKey}`, async () => {
        mockElectronAPI.s3.getFileSize.mockResolvedValue({ success: true, size: 100 });
        mockElectronAPI.s3.downloadContent.mockResolvedValue({ success: true, content: '' });

        render(<TextEditor {...defaultProps} fileKey={fileKey} fileName={fileKey} />);

        await waitFor(() => {
          expect(screen.getByText(expectedLanguage)).toBeInTheDocument();
        });
      });
    });
  });
});
