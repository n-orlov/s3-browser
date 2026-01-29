import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FileToolbar from '../renderer/components/FileToolbar';

describe('FileToolbar', () => {
  const defaultProps = {
    selectedBucket: 'test-bucket',
    currentPrefix: 'path/',
    selectedFile: null,
    onUpload: vi.fn(),
    onDownload: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onEdit: vi.fn(),
    onViewParquet: vi.fn(),
    onRefresh: vi.fn(),
    disabled: false,
  };

  describe('Edit button', () => {
    it('disables Edit button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const editButton = screen.getByTitle(/Select a text file to edit/);
      expect(editButton).toBeDisabled();
    });

    it('disables Edit button when a folder is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'folder/', isPrefix: true }}
        />
      );

      const editButton = screen.getByTitle(/Select a text file to edit/);
      expect(editButton).toBeDisabled();
    });

    it('disables Edit button for non-editable file types', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'image.png', isPrefix: false }}
        />
      );

      const editButton = screen.getByTitle(/Select a text file to edit/);
      expect(editButton).toBeDisabled();
    });

    it('enables Edit button for JSON files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'config.json', isPrefix: false }}
        />
      );

      const editButton = screen.getByTitle('Edit selected file');
      expect(editButton).not.toBeDisabled();
    });

    it('enables Edit button for YAML files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'config.yaml', isPrefix: false }}
        />
      );

      const editButton = screen.getByTitle('Edit selected file');
      expect(editButton).not.toBeDisabled();
    });

    it('enables Edit button for TXT files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'readme.txt', isPrefix: false }}
        />
      );

      const editButton = screen.getByTitle('Edit selected file');
      expect(editButton).not.toBeDisabled();
    });

    it('enables Edit button for CSV files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'data.csv', isPrefix: false }}
        />
      );

      const editButton = screen.getByTitle('Edit selected file');
      expect(editButton).not.toBeDisabled();
    });

    it('enables Edit button for code files', () => {
      const codeExtensions = ['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'rb', 'php'];

      codeExtensions.forEach((ext) => {
        const { unmount } = render(
          <FileToolbar
            {...defaultProps}
            selectedFile={{ key: `code.${ext}`, isPrefix: false }}
          />
        );

        const editButton = screen.getByTitle('Edit selected file');
        expect(editButton).not.toBeDisabled();
        unmount();
      });
    });

    it('enables Edit button for config files', () => {
      const configExtensions = ['xml', 'toml', 'ini', 'conf', 'env', 'properties'];

      configExtensions.forEach((ext) => {
        const { unmount } = render(
          <FileToolbar
            {...defaultProps}
            selectedFile={{ key: `config.${ext}`, isPrefix: false }}
          />
        );

        const editButton = screen.getByTitle('Edit selected file');
        expect(editButton).not.toBeDisabled();
        unmount();
      });
    });

    it('enables Edit button for markup files', () => {
      const markupExtensions = ['md', 'html', 'htm', 'css', 'scss'];

      markupExtensions.forEach((ext) => {
        const { unmount } = render(
          <FileToolbar
            {...defaultProps}
            selectedFile={{ key: `file.${ext}`, isPrefix: false }}
          />
        );

        const editButton = screen.getByTitle('Edit selected file');
        expect(editButton).not.toBeDisabled();
        unmount();
      });
    });

    it('calls onEdit when Edit button is clicked', () => {
      const onEdit = vi.fn();
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.json', isPrefix: false }}
          onEdit={onEdit}
        />
      );

      fireEvent.click(screen.getByText('Edit'));
      expect(onEdit).toHaveBeenCalled();
    });

    it('disables Edit button when toolbar is disabled', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.json', isPrefix: false }}
          disabled={true}
        />
      );

      const editButton = screen.getByText('Edit').closest('button');
      expect(editButton).toBeDisabled();
    });
  });

  describe('other buttons', () => {
    it('enables Upload button when bucket is selected', () => {
      render(<FileToolbar {...defaultProps} />);

      const uploadButton = screen.getByTitle('Upload files');
      expect(uploadButton).not.toBeDisabled();
    });

    it('disables Download button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const downloadButton = screen.getByTitle('Download selected file');
      expect(downloadButton).toBeDisabled();
    });

    it('enables Download button when a file is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
        />
      );

      const downloadButton = screen.getByTitle('Download selected file');
      expect(downloadButton).not.toBeDisabled();
    });

    it('disables Rename button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const renameButton = screen.getByTitle('Rename selected file');
      expect(renameButton).toBeDisabled();
    });

    it('disables Delete button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const deleteButton = screen.getByTitle('Delete selected file');
      expect(deleteButton).toBeDisabled();
    });

    it('calls onRefresh when Refresh button is clicked', () => {
      const onRefresh = vi.fn();
      render(<FileToolbar {...defaultProps} onRefresh={onRefresh} />);

      fireEvent.click(screen.getByText('Refresh'));
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  describe('Parquet button', () => {
    it('disables Parquet button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const parquetButton = screen.getByTitle(/Select a parquet file to view/);
      expect(parquetButton).toBeDisabled();
    });

    it('disables Parquet button when a folder is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'folder/', isPrefix: true }}
        />
      );

      const parquetButton = screen.getByTitle(/Select a parquet file to view/);
      expect(parquetButton).toBeDisabled();
    });

    it('disables Parquet button for non-parquet files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'data.json', isPrefix: false }}
        />
      );

      const parquetButton = screen.getByTitle(/Select a parquet file to view/);
      expect(parquetButton).toBeDisabled();
    });

    it('enables Parquet button for parquet files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'data.parquet', isPrefix: false }}
        />
      );

      const parquetButton = screen.getByTitle('View parquet file');
      expect(parquetButton).not.toBeDisabled();
    });

    it('calls onViewParquet when Parquet button is clicked', () => {
      const onViewParquet = vi.fn();
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'data.parquet', isPrefix: false }}
          onViewParquet={onViewParquet}
        />
      );

      fireEvent.click(screen.getByText('Parquet'));
      expect(onViewParquet).toHaveBeenCalled();
    });

    it('disables Parquet button when toolbar is disabled', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'data.parquet', isPrefix: false }}
          disabled={true}
        />
      );

      const parquetButton = screen.getByText('Parquet').closest('button');
      expect(parquetButton).toBeDisabled();
    });
  });
});
