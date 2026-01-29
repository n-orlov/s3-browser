import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NavigationBar from '../renderer/components/NavigationBar';
import { mockElectronAPI } from './setup';

describe('NavigationBar', () => {
  const mockOnNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders the navigation bar with input field', () => {
      render(
        <NavigationBar
          currentBucket={null}
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      expect(screen.getByRole('textbox', { name: /s3 url/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /go/i })).toBeInTheDocument();
    });

    it('shows empty input when no bucket is selected', () => {
      render(
        <NavigationBar
          currentBucket={null}
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByRole('textbox', { name: /s3 url/i });
      expect(input).toHaveValue('');
    });

    it('shows S3 URL for current bucket and prefix', () => {
      render(
        <NavigationBar
          currentBucket="my-bucket"
          currentPrefix="folder/subfolder/"
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByRole('textbox', { name: /s3 url/i });
      expect(input).toHaveValue('s3://my-bucket/folder/subfolder/');
    });

    it('shows only bucket in URL when at root', () => {
      render(
        <NavigationBar
          currentBucket="my-bucket"
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByRole('textbox', { name: /s3 url/i });
      expect(input).toHaveValue('s3://my-bucket/');
    });

    it('has disabled Go button when input is empty', () => {
      render(
        <NavigationBar
          currentBucket={null}
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      expect(screen.getByRole('button', { name: /go/i })).toBeDisabled();
    });
  });

  describe('s3:// URL navigation', () => {
    it('navigates to bucket root for s3://bucket', async () => {
      mockElectronAPI.s3.parseUrl.mockResolvedValue({
        success: true,
        bucket: 'test-bucket',
        key: '',
      });

      render(
        <NavigationBar
          currentBucket={null}
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByRole('textbox', { name: /s3 url/i });
      await userEvent.clear(input);
      await userEvent.type(input, 's3://test-bucket');

      fireEvent.click(screen.getByRole('button', { name: /go/i }));

      await waitFor(() => {
        expect(mockElectronAPI.s3.parseUrl).toHaveBeenCalledWith('s3://test-bucket');
        expect(mockOnNavigate).toHaveBeenCalledWith('test-bucket', '');
      });
    });

    it('navigates to bucket root for s3://bucket/', async () => {
      mockElectronAPI.s3.parseUrl.mockResolvedValue({
        success: true,
        bucket: 'test-bucket',
        key: '',
      });

      render(
        <NavigationBar
          currentBucket={null}
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByRole('textbox', { name: /s3 url/i });
      await userEvent.clear(input);
      await userEvent.type(input, 's3://test-bucket/');

      fireEvent.click(screen.getByRole('button', { name: /go/i }));

      await waitFor(() => {
        expect(mockOnNavigate).toHaveBeenCalledWith('test-bucket', '');
      });
    });

    it('navigates to folder for s3://bucket/folder/', async () => {
      mockElectronAPI.s3.parseUrl.mockResolvedValue({
        success: true,
        bucket: 'test-bucket',
        key: 'folder/',
      });

      render(
        <NavigationBar
          currentBucket={null}
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByRole('textbox', { name: /s3 url/i });
      await userEvent.clear(input);
      await userEvent.type(input, 's3://test-bucket/folder/');

      fireEvent.click(screen.getByRole('button', { name: /go/i }));

      await waitFor(() => {
        expect(mockOnNavigate).toHaveBeenCalledWith('test-bucket', 'folder/');
      });
    });

    it('navigates to parent folder and selects file for file URL', async () => {
      mockElectronAPI.s3.parseUrl.mockResolvedValue({
        success: true,
        bucket: 'test-bucket',
        key: 'folder/file.txt',
      });

      render(
        <NavigationBar
          currentBucket={null}
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByRole('textbox', { name: /s3 url/i });
      await userEvent.clear(input);
      await userEvent.type(input, 's3://test-bucket/folder/file.txt');

      fireEvent.click(screen.getByRole('button', { name: /go/i }));

      await waitFor(() => {
        // Should navigate to parent prefix and pass the full key for selection
        expect(mockOnNavigate).toHaveBeenCalledWith('test-bucket', 'folder/', 'folder/file.txt');
      });
    });

    it('navigates and selects root-level file', async () => {
      mockElectronAPI.s3.parseUrl.mockResolvedValue({
        success: true,
        bucket: 'test-bucket',
        key: 'readme.md',
      });

      render(
        <NavigationBar
          currentBucket={null}
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByRole('textbox', { name: /s3 url/i });
      await userEvent.clear(input);
      await userEvent.type(input, 's3://test-bucket/readme.md');

      fireEvent.click(screen.getByRole('button', { name: /go/i }));

      await waitFor(() => {
        // Root level file - prefix is empty, but file should be selected
        expect(mockOnNavigate).toHaveBeenCalledWith('test-bucket', '', 'readme.md');
      });
    });
  });

  describe('HTTPS URL navigation', () => {
    it('handles virtual-hosted style URL', async () => {
      mockElectronAPI.s3.parseUrl.mockResolvedValue({
        success: true,
        bucket: 'my-bucket',
        key: 'data/file.json',
      });

      render(
        <NavigationBar
          currentBucket={null}
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByRole('textbox', { name: /s3 url/i });
      await userEvent.clear(input);
      await userEvent.type(input, 'https://my-bucket.s3.us-east-1.amazonaws.com/data/file.json');

      fireEvent.click(screen.getByRole('button', { name: /go/i }));

      await waitFor(() => {
        expect(mockElectronAPI.s3.parseUrl).toHaveBeenCalledWith(
          'https://my-bucket.s3.us-east-1.amazonaws.com/data/file.json'
        );
        expect(mockOnNavigate).toHaveBeenCalledWith('my-bucket', 'data/', 'data/file.json');
      });
    });

    it('handles path-style URL', async () => {
      mockElectronAPI.s3.parseUrl.mockResolvedValue({
        success: true,
        bucket: 'my-bucket',
        key: 'folder/',
      });

      render(
        <NavigationBar
          currentBucket={null}
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByRole('textbox', { name: /s3 url/i });
      await userEvent.clear(input);
      await userEvent.type(input, 'https://s3.us-west-2.amazonaws.com/my-bucket/folder/');

      fireEvent.click(screen.getByRole('button', { name: /go/i }));

      await waitFor(() => {
        expect(mockOnNavigate).toHaveBeenCalledWith('my-bucket', 'folder/');
      });
    });
  });

  describe('keyboard navigation', () => {
    it('navigates on Enter key', async () => {
      mockElectronAPI.s3.parseUrl.mockResolvedValue({
        success: true,
        bucket: 'test-bucket',
        key: '',
      });

      render(
        <NavigationBar
          currentBucket={null}
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByRole('textbox', { name: /s3 url/i });
      await userEvent.clear(input);
      await userEvent.type(input, 's3://test-bucket{enter}');

      await waitFor(() => {
        expect(mockOnNavigate).toHaveBeenCalledWith('test-bucket', '');
      });
    });

    it('cancels editing on Escape key', async () => {
      render(
        <NavigationBar
          currentBucket="my-bucket"
          currentPrefix="folder/"
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByRole('textbox', { name: /s3 url/i });
      await userEvent.clear(input);
      await userEvent.type(input, 's3://other-bucket{escape}');

      // Should revert to original value
      await waitFor(() => {
        expect(input).toHaveValue('s3://my-bucket/folder/');
      });
      expect(mockOnNavigate).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('shows error for invalid URL', async () => {
      mockElectronAPI.s3.parseUrl.mockResolvedValue({
        success: false,
        error: 'Invalid URL format',
      });

      render(
        <NavigationBar
          currentBucket={null}
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByRole('textbox', { name: /s3 url/i });
      await userEvent.clear(input);
      await userEvent.type(input, 'invalid-url');

      fireEvent.click(screen.getByRole('button', { name: /go/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/invalid s3 url/i);
      });
      expect(mockOnNavigate).not.toHaveBeenCalled();
    });

    it('shows error when parseUrl returns no bucket', async () => {
      mockElectronAPI.s3.parseUrl.mockResolvedValue({
        success: true,
        bucket: '',
        key: '',
      });

      render(
        <NavigationBar
          currentBucket={null}
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByRole('textbox', { name: /s3 url/i });
      await userEvent.clear(input);
      await userEvent.type(input, 'something');

      fireEvent.click(screen.getByRole('button', { name: /go/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
      expect(mockOnNavigate).not.toHaveBeenCalled();
    });

    it('clears error when input changes', async () => {
      mockElectronAPI.s3.parseUrl.mockResolvedValue({
        success: false,
        error: 'Invalid',
      });

      render(
        <NavigationBar
          currentBucket={null}
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByRole('textbox', { name: /s3 url/i });
      await userEvent.type(input, 'invalid');
      fireEvent.click(screen.getByRole('button', { name: /go/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      // Type more - error should clear
      await userEvent.type(input, '-more');

      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
    });
  });

  describe('URL synchronization', () => {
    it('updates input when bucket changes externally', async () => {
      const { rerender } = render(
        <NavigationBar
          currentBucket="bucket-a"
          currentPrefix=""
          onNavigate={mockOnNavigate}
        />
      );

      expect(screen.getByRole('textbox', { name: /s3 url/i })).toHaveValue('s3://bucket-a/');

      // Simulate navigation to different bucket
      rerender(
        <NavigationBar
          currentBucket="bucket-b"
          currentPrefix="folder/"
          onNavigate={mockOnNavigate}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: /s3 url/i })).toHaveValue('s3://bucket-b/folder/');
      });
    });
  });
});
