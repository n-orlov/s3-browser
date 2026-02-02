import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DeleteConfirmDialog from '../renderer/components/DeleteConfirmDialog';

describe('DeleteConfirmDialog', () => {
  const defaultProps = {
    isOpen: true,
    fileNames: ['test-file.txt'],
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  describe('single file delete', () => {
    it('renders dialog when open', () => {
      render(<DeleteConfirmDialog {...defaultProps} />);

      expect(screen.getByText('Delete File')).toBeInTheDocument();
      expect(screen.getByText('test-file.txt')).toBeInTheDocument();
    });

    it('does not render when closed', () => {
      render(<DeleteConfirmDialog {...defaultProps} isOpen={false} />);

      expect(screen.queryByText('Delete File')).not.toBeInTheDocument();
    });

    it('shows the filename', () => {
      render(<DeleteConfirmDialog {...defaultProps} fileNames={['my-document.pdf']} />);

      expect(screen.getByText('my-document.pdf')).toBeInTheDocument();
    });

    it('shows single delete button text', () => {
      render(<DeleteConfirmDialog {...defaultProps} />);

      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('calls onConfirm when delete button is clicked', () => {
      const onConfirm = vi.fn();
      render(<DeleteConfirmDialog {...defaultProps} onConfirm={onConfirm} />);

      fireEvent.click(screen.getByText('Delete'));
      expect(onConfirm).toHaveBeenCalled();
    });

    it('calls onCancel when cancel button is clicked', () => {
      const onCancel = vi.fn();
      render(<DeleteConfirmDialog {...defaultProps} onCancel={onCancel} />);

      fireEvent.click(screen.getByText('Cancel'));
      expect(onCancel).toHaveBeenCalled();
    });

    it('calls onCancel when overlay is clicked', () => {
      const onCancel = vi.fn();
      render(<DeleteConfirmDialog {...defaultProps} onCancel={onCancel} />);

      const overlay = screen.getByText('Delete File').closest('.dialog')?.parentElement;
      if (overlay) {
        fireEvent.click(overlay);
        expect(onCancel).toHaveBeenCalled();
      }
    });

    it('calls onCancel on Escape key', () => {
      const onCancel = vi.fn();
      render(<DeleteConfirmDialog {...defaultProps} onCancel={onCancel} />);

      const overlay = screen.getByText('Delete File').closest('.dialog')?.parentElement;
      if (overlay) {
        fireEvent.keyDown(overlay, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalled();
      }
    });

    it('calls onConfirm on Enter key', () => {
      const onConfirm = vi.fn();
      render(<DeleteConfirmDialog {...defaultProps} onConfirm={onConfirm} />);

      const overlay = screen.getByText('Delete File').closest('.dialog')?.parentElement;
      if (overlay) {
        fireEvent.keyDown(overlay, { key: 'Enter' });
        expect(onConfirm).toHaveBeenCalled();
      }
    });
  });

  describe('batch delete (multiple files)', () => {
    it('shows correct title for multiple files', () => {
      render(<DeleteConfirmDialog {...defaultProps} fileNames={['file1.txt', 'file2.txt', 'file3.txt']} />);

      // Get the title in the header
      const heading = screen.getByRole('heading', { name: /Delete 3 files/ });
      expect(heading).toBeInTheDocument();
    });

    it('shows first 5 files in the list', () => {
      const files = ['file1.txt', 'file2.txt', 'file3.txt', 'file4.txt', 'file5.txt'];
      render(<DeleteConfirmDialog {...defaultProps} fileNames={files} />);

      files.forEach(file => {
        expect(screen.getByText(file)).toBeInTheDocument();
      });
    });

    it('shows "and X more" message when more than 5 files', () => {
      const files = ['file1.txt', 'file2.txt', 'file3.txt', 'file4.txt', 'file5.txt', 'file6.txt', 'file7.txt'];
      render(<DeleteConfirmDialog {...defaultProps} fileNames={files} />);

      expect(screen.getByText('...and 2 more')).toBeInTheDocument();
    });

    it('shows delete button with file count', () => {
      render(<DeleteConfirmDialog {...defaultProps} fileNames={['file1.txt', 'file2.txt', 'file3.txt']} />);

      // Look for the button specifically
      const deleteButton = screen.getByRole('button', { name: /Delete 3 files/ });
      expect(deleteButton).toBeInTheDocument();
    });

    it('shows warning message', () => {
      render(<DeleteConfirmDialog {...defaultProps} fileNames={['file1.txt', 'file2.txt']} />);

      expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
    });
  });

  describe('hasFolders prop', () => {
    it('shows "Delete Item" instead of "Delete File" for single item when hasFolders is true', () => {
      render(<DeleteConfirmDialog {...defaultProps} fileNames={['my-folder/']} hasFolders={true} />);

      expect(screen.getByText('Delete Item')).toBeInTheDocument();
      expect(screen.queryByText('Delete File')).not.toBeInTheDocument();
    });

    it('shows "Delete X items" instead of "Delete X files" for multiple items when hasFolders is true', () => {
      render(
        <DeleteConfirmDialog
          {...defaultProps}
          fileNames={['folder1/', 'folder2/', 'file.txt']}
          hasFolders={true}
        />
      );

      const heading = screen.getByRole('heading', { name: /Delete 3 items/ });
      expect(heading).toBeInTheDocument();
    });

    it('shows folder warning message when hasFolders is true', () => {
      render(<DeleteConfirmDialog {...defaultProps} fileNames={['my-folder/']} hasFolders={true} />);

      expect(screen.getByText('Folders and all their contents will be deleted!')).toBeInTheDocument();
    });

    it('does not show folder warning message when hasFolders is false', () => {
      render(<DeleteConfirmDialog {...defaultProps} fileNames={['file.txt']} hasFolders={false} />);

      expect(screen.queryByText('Folders and all their contents will be deleted!')).not.toBeInTheDocument();
    });

    it('does not show folder warning message when hasFolders is undefined', () => {
      render(<DeleteConfirmDialog {...defaultProps} fileNames={['file.txt']} />);

      expect(screen.queryByText('Folders and all their contents will be deleted!')).not.toBeInTheDocument();
    });

    it('shows delete button with "items" text when hasFolders is true and multiple files', () => {
      render(
        <DeleteConfirmDialog
          {...defaultProps}
          fileNames={['folder1/', 'folder2/']}
          hasFolders={true}
        />
      );

      const deleteButton = screen.getByRole('button', { name: /Delete 2 items/ });
      expect(deleteButton).toBeInTheDocument();
    });

    it('shows "these items" in confirmation text when hasFolders is true', () => {
      render(
        <DeleteConfirmDialog
          {...defaultProps}
          fileNames={['folder1/', 'folder2/']}
          hasFolders={true}
        />
      );

      expect(screen.getByText(/Are you sure you want to delete these items/)).toBeInTheDocument();
    });

    it('shows "these files" in confirmation text when hasFolders is false', () => {
      render(
        <DeleteConfirmDialog
          {...defaultProps}
          fileNames={['file1.txt', 'file2.txt']}
          hasFolders={false}
        />
      );

      expect(screen.getByText(/Are you sure you want to delete these files/)).toBeInTheDocument();
    });

    it('shows folder warning even for single folder', () => {
      render(
        <DeleteConfirmDialog
          {...defaultProps}
          fileNames={['single-folder/']}
          hasFolders={true}
        />
      );

      expect(screen.getByText('Folders and all their contents will be deleted!')).toBeInTheDocument();
      expect(screen.getByText('single-folder/')).toBeInTheDocument();
    });

    it('maintains keyboard handlers with hasFolders prop', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      render(
        <DeleteConfirmDialog
          {...defaultProps}
          fileNames={['folder/']}
          hasFolders={true}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      const overlay = screen.getByText('Delete Item').closest('.dialog')?.parentElement;
      if (overlay) {
        fireEvent.keyDown(overlay, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalled();

        fireEvent.keyDown(overlay, { key: 'Enter' });
        expect(onConfirm).toHaveBeenCalled();
      }
    });
  });
});
