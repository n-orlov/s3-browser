import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FileToolbar from '../renderer/components/FileToolbar';

describe('FileToolbar', () => {
  const defaultProps = {
    selectedBucket: 'test-bucket',
    currentPrefix: 'path/',
    selectedFile: null,
    selectedCount: 0,
    onUpload: vi.fn(),
    onDownload: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onEdit: vi.fn(),
    onViewParquet: vi.fn(),
    onViewImage: vi.fn(),
    onCopyUrl: vi.fn(),
    onRefresh: vi.fn(),
    onProperties: vi.fn(),
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
          selectedCount={1}
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

  describe('Image button', () => {
    it('disables Image button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const imageButton = screen.getByTitle(/Select an image file to preview/);
      expect(imageButton).toBeDisabled();
    });

    it('disables Image button when a folder is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'folder/', isPrefix: true }}
        />
      );

      const imageButton = screen.getByTitle(/Select an image file to preview/);
      expect(imageButton).toBeDisabled();
    });

    it('disables Image button for non-image files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'data.json', isPrefix: false }}
        />
      );

      const imageButton = screen.getByTitle(/Select an image file to preview/);
      expect(imageButton).toBeDisabled();
    });

    it('enables Image button for PNG files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'image.png', isPrefix: false }}
        />
      );

      const imageButton = screen.getByTitle('Preview image');
      expect(imageButton).not.toBeDisabled();
    });

    it('enables Image button for JPG files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'photo.jpg', isPrefix: false }}
        />
      );

      const imageButton = screen.getByTitle('Preview image');
      expect(imageButton).not.toBeDisabled();
    });

    it('enables Image button for JPEG files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'photo.jpeg', isPrefix: false }}
        />
      );

      const imageButton = screen.getByTitle('Preview image');
      expect(imageButton).not.toBeDisabled();
    });

    it('enables Image button for GIF files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'animation.gif', isPrefix: false }}
        />
      );

      const imageButton = screen.getByTitle('Preview image');
      expect(imageButton).not.toBeDisabled();
    });

    it('enables Image button for WebP files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'image.webp', isPrefix: false }}
        />
      );

      const imageButton = screen.getByTitle('Preview image');
      expect(imageButton).not.toBeDisabled();
    });

    it('enables Image button for various image formats', () => {
      const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];

      imageExtensions.forEach((ext) => {
        const { unmount } = render(
          <FileToolbar
            {...defaultProps}
            selectedFile={{ key: `image.${ext}`, isPrefix: false }}
          />
        );

        const imageButton = screen.getByTitle('Preview image');
        expect(imageButton).not.toBeDisabled();
        unmount();
      });
    });

    it('calls onViewImage when Image button is clicked', () => {
      const onViewImage = vi.fn();
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'photo.png', isPrefix: false }}
          onViewImage={onViewImage}
        />
      );

      fireEvent.click(screen.getByText('Image'));
      expect(onViewImage).toHaveBeenCalled();
    });

    it('disables Image button when toolbar is disabled', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'photo.png', isPrefix: false }}
          disabled={true}
        />
      );

      const imageButton = screen.getByText('Image').closest('button');
      expect(imageButton).toBeDisabled();
    });
  });

  describe('multiselect behavior', () => {
    it('disables Download button when multiple files are selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
          selectedCount={2}
        />
      );

      const downloadButton = screen.getByTitle(/Download not available for multiple files/);
      expect(downloadButton).toBeDisabled();
    });

    it('disables Rename button when multiple files are selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
          selectedCount={2}
        />
      );

      const renameButton = screen.getByTitle(/Rename not available for multiple files/);
      expect(renameButton).toBeDisabled();
    });

    it('disables Copy URL button when multiple files are selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
          selectedCount={2}
        />
      );

      const copyButton = screen.getByTitle(/Copy URL not available for multiple files/);
      expect(copyButton).toBeDisabled();
    });

    it('enables Delete button when multiple files are selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
          selectedCount={3}
        />
      );

      const deleteButton = screen.getByTitle(/Delete 3 files/);
      expect(deleteButton).not.toBeDisabled();
    });

    it('shows file count on Delete button when multiple files selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
          selectedCount={5}
        />
      );

      expect(screen.getByText('Delete (5)')).toBeInTheDocument();
    });

    it('disables Edit button when multiple files are selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.json', isPrefix: false }}
          selectedCount={2}
        />
      );

      const editButton = screen.getByTitle(/Select a text file to edit/);
      expect(editButton).toBeDisabled();
    });

    it('disables Parquet button when multiple files are selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'data.parquet', isPrefix: false }}
          selectedCount={2}
        />
      );

      const parquetButton = screen.getByTitle(/Select a parquet file to view/);
      expect(parquetButton).toBeDisabled();
    });

    it('disables Image button when multiple files are selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'image.png', isPrefix: false }}
          selectedCount={2}
        />
      );

      const imageButton = screen.getByTitle(/Select an image file to preview/);
      expect(imageButton).toBeDisabled();
    });
  });

  describe('Copy URL button', () => {
    it('disables Copy URL button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const copyButton = screen.getByTitle(/Select a file to copy URL/);
      expect(copyButton).toBeDisabled();
    });

    it('disables Copy URL button when a folder is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'folder/', isPrefix: true }}
        />
      );

      const copyButton = screen.getByTitle(/Select a file to copy URL/);
      expect(copyButton).toBeDisabled();
    });

    it('enables Copy URL button when a file is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'data.json', isPrefix: false }}
        />
      );

      const copyButton = screen.getByTitle('Copy S3 URL to clipboard');
      expect(copyButton).not.toBeDisabled();
    });

    it('enables Copy URL button for any file type', () => {
      const fileTypes = ['data.json', 'image.png', 'video.mp4', 'archive.zip', 'data.parquet'];

      fileTypes.forEach((fileName) => {
        const { unmount } = render(
          <FileToolbar
            {...defaultProps}
            selectedFile={{ key: fileName, isPrefix: false }}
          />
        );

        const copyButton = screen.getByTitle('Copy S3 URL to clipboard');
        expect(copyButton).not.toBeDisabled();
        unmount();
      });
    });

    it('calls onCopyUrl when Copy URL button is clicked', () => {
      const onCopyUrl = vi.fn();
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
          onCopyUrl={onCopyUrl}
        />
      );

      fireEvent.click(screen.getByText('Copy URL'));
      expect(onCopyUrl).toHaveBeenCalled();
    });

    it('disables Copy URL button when toolbar is disabled', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
          disabled={true}
        />
      );

      const copyButton = screen.getByText('Copy URL').closest('button');
      expect(copyButton).toBeDisabled();
    });
  });

  describe('Properties button', () => {
    it('disables Properties button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const propertiesButton = screen.getByTitle(/Select a file or folder to view properties/);
      expect(propertiesButton).toBeDisabled();
    });

    it('enables Properties button when a file is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
        />
      );

      const propertiesButton = screen.getByTitle('View properties');
      expect(propertiesButton).not.toBeDisabled();
    });

    it('enables Properties button when a folder is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'folder/', isPrefix: true }}
        />
      );

      const propertiesButton = screen.getByTitle('View properties');
      expect(propertiesButton).not.toBeDisabled();
    });

    it('calls onProperties when Properties button is clicked', () => {
      const onProperties = vi.fn();
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
          onProperties={onProperties}
        />
      );

      fireEvent.click(screen.getByText('Properties'));
      expect(onProperties).toHaveBeenCalled();
    });

    it('disables Properties button when toolbar is disabled', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
          disabled={true}
        />
      );

      const propertiesButton = screen.getByText('Properties').closest('button');
      expect(propertiesButton).toBeDisabled();
    });

    it('disables Properties button when multiple files are selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
          selectedCount={2}
        />
      );

      const propertiesButton = screen.getByTitle(/Select a file or folder to view properties/);
      expect(propertiesButton).toBeDisabled();
    });
  });
});
