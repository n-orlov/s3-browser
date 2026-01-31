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
    onViewCsv: vi.fn(),
    onViewJson: vi.fn(),
    onViewImage: vi.fn(),
    onCopyUrl: vi.fn(),
    onRefresh: vi.fn(),
    onProperties: vi.fn(),
    onNewFile: vi.fn(),
    onNewFolder: vi.fn(),
    disabled: false,
  };

  // Helper to get button by its tooltip (title attribute)
  const getButtonByTitle = (title: string | RegExp) => screen.getByTitle(title);

  describe('Edit button', () => {
    it('disables Edit button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const editButton = getButtonByTitle(/Select a text file to edit/);
      expect(editButton).toBeDisabled();
    });

    it('disables Edit button when a folder is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'folder/', isPrefix: true }}
        />
      );

      const editButton = getButtonByTitle(/Select a text file to edit/);
      expect(editButton).toBeDisabled();
    });

    it('disables Edit button for non-editable file types', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'image.png', isPrefix: false }}
        />
      );

      const editButton = getButtonByTitle(/Select a text file to edit/);
      expect(editButton).toBeDisabled();
    });

    it('enables Edit button for JSON files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'config.json', isPrefix: false }}
        />
      );

      const editButton = getButtonByTitle('Edit selected file');
      expect(editButton).not.toBeDisabled();
    });

    it('enables Edit button for YAML files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'config.yaml', isPrefix: false }}
        />
      );

      const editButton = getButtonByTitle('Edit selected file');
      expect(editButton).not.toBeDisabled();
    });

    it('enables Edit button for TXT files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'readme.txt', isPrefix: false }}
        />
      );

      const editButton = getButtonByTitle('Edit selected file');
      expect(editButton).not.toBeDisabled();
    });

    it('enables Edit button for CSV files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'data.csv', isPrefix: false }}
        />
      );

      const editButton = getButtonByTitle('Edit selected file');
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

        const editButton = getButtonByTitle('Edit selected file');
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

        const editButton = getButtonByTitle('Edit selected file');
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

        const editButton = getButtonByTitle('Edit selected file');
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

      fireEvent.click(getButtonByTitle('Edit selected file'));
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

      const editButton = getButtonByTitle('Edit selected file');
      expect(editButton).toBeDisabled();
    });
  });

  describe('other buttons', () => {
    it('enables Upload button when bucket is selected', () => {
      render(<FileToolbar {...defaultProps} />);

      const uploadButton = getButtonByTitle('Upload files');
      expect(uploadButton).not.toBeDisabled();
    });

    it('disables Download button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const downloadButton = getButtonByTitle('Download selected file');
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

      const downloadButton = getButtonByTitle('Download selected file');
      expect(downloadButton).not.toBeDisabled();
    });

    it('disables Rename button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const renameButton = getButtonByTitle('Rename selected file');
      expect(renameButton).toBeDisabled();
    });

    it('disables Delete button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const deleteButton = getButtonByTitle('Delete selected file');
      expect(deleteButton).toBeDisabled();
    });

    it('calls onRefresh when Refresh button is clicked', () => {
      const onRefresh = vi.fn();
      render(<FileToolbar {...defaultProps} onRefresh={onRefresh} />);

      fireEvent.click(getButtonByTitle('Refresh file list'));
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  describe('Parquet button', () => {
    it('disables Parquet button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const parquetButton = getButtonByTitle(/Select a parquet file to view/);
      expect(parquetButton).toBeDisabled();
    });

    it('disables Parquet button when a folder is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'folder/', isPrefix: true }}
        />
      );

      const parquetButton = getButtonByTitle(/Select a parquet file to view/);
      expect(parquetButton).toBeDisabled();
    });

    it('disables Parquet button for non-parquet files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'data.json', isPrefix: false }}
        />
      );

      const parquetButton = getButtonByTitle(/Select a parquet file to view/);
      expect(parquetButton).toBeDisabled();
    });

    it('enables Parquet button for parquet files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'data.parquet', isPrefix: false }}
        />
      );

      const parquetButton = getButtonByTitle('View parquet file');
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

      fireEvent.click(getButtonByTitle('View parquet file'));
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

      const parquetButton = getButtonByTitle('View parquet file');
      expect(parquetButton).toBeDisabled();
    });
  });

  describe('Image button', () => {
    it('disables Image button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const imageButton = getButtonByTitle(/Select an image file to preview/);
      expect(imageButton).toBeDisabled();
    });

    it('disables Image button when a folder is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'folder/', isPrefix: true }}
        />
      );

      const imageButton = getButtonByTitle(/Select an image file to preview/);
      expect(imageButton).toBeDisabled();
    });

    it('disables Image button for non-image files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'data.json', isPrefix: false }}
        />
      );

      const imageButton = getButtonByTitle(/Select an image file to preview/);
      expect(imageButton).toBeDisabled();
    });

    it('enables Image button for PNG files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'image.png', isPrefix: false }}
        />
      );

      const imageButton = getButtonByTitle('Preview image');
      expect(imageButton).not.toBeDisabled();
    });

    it('enables Image button for JPG files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'photo.jpg', isPrefix: false }}
        />
      );

      const imageButton = getButtonByTitle('Preview image');
      expect(imageButton).not.toBeDisabled();
    });

    it('enables Image button for JPEG files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'photo.jpeg', isPrefix: false }}
        />
      );

      const imageButton = getButtonByTitle('Preview image');
      expect(imageButton).not.toBeDisabled();
    });

    it('enables Image button for GIF files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'animation.gif', isPrefix: false }}
        />
      );

      const imageButton = getButtonByTitle('Preview image');
      expect(imageButton).not.toBeDisabled();
    });

    it('enables Image button for WebP files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'image.webp', isPrefix: false }}
        />
      );

      const imageButton = getButtonByTitle('Preview image');
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

        const imageButton = getButtonByTitle('Preview image');
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

      fireEvent.click(getButtonByTitle('Preview image'));
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

      const imageButton = getButtonByTitle('Preview image');
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

      const downloadButton = getButtonByTitle(/Download not available for multiple files/);
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

      const renameButton = getButtonByTitle(/Rename not available for multiple files/);
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

      const copyButton = getButtonByTitle(/Copy URL not available for multiple files/);
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

      const deleteButton = getButtonByTitle(/Delete 3 files/);
      expect(deleteButton).not.toBeDisabled();
    });

    it('shows badge on Delete button when multiple files selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
          selectedCount={5}
        />
      );

      const badge = screen.getByText('5');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('toolbar-badge');
    });

    it('disables Edit button when multiple files are selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.json', isPrefix: false }}
          selectedCount={2}
        />
      );

      const editButton = getButtonByTitle(/Select a text file to edit/);
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

      const parquetButton = getButtonByTitle(/Select a parquet file to view/);
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

      const imageButton = getButtonByTitle(/Select an image file to preview/);
      expect(imageButton).toBeDisabled();
    });
  });

  describe('Copy URL button', () => {
    it('disables Copy URL button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const copyButton = getButtonByTitle(/Select a file to copy URL/);
      expect(copyButton).toBeDisabled();
    });

    it('disables Copy URL button when a folder is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'folder/', isPrefix: true }}
        />
      );

      const copyButton = getButtonByTitle(/Select a file to copy URL/);
      expect(copyButton).toBeDisabled();
    });

    it('enables Copy URL button when a file is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'data.json', isPrefix: false }}
        />
      );

      const copyButton = getButtonByTitle('Copy S3 URL to clipboard');
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

        const copyButton = getButtonByTitle('Copy S3 URL to clipboard');
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

      fireEvent.click(getButtonByTitle('Copy S3 URL to clipboard'));
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

      const copyButton = getButtonByTitle('Copy S3 URL to clipboard');
      expect(copyButton).toBeDisabled();
    });
  });

  describe('Properties button', () => {
    it('disables Properties button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const propertiesButton = getButtonByTitle(/Select a file or folder to view properties/);
      expect(propertiesButton).toBeDisabled();
    });

    it('enables Properties button when a file is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
        />
      );

      const propertiesButton = getButtonByTitle('View properties');
      expect(propertiesButton).not.toBeDisabled();
    });

    it('enables Properties button when a folder is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'folder/', isPrefix: true }}
        />
      );

      const propertiesButton = getButtonByTitle('View properties');
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

      fireEvent.click(getButtonByTitle('View properties'));
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

      const propertiesButton = getButtonByTitle('View properties');
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

      const propertiesButton = getButtonByTitle(/Select a file or folder to view properties/);
      expect(propertiesButton).toBeDisabled();
    });
  });

  describe('New File button', () => {
    it('disables New File button when no bucket is selected', () => {
      render(<FileToolbar {...defaultProps} selectedBucket={null} />);

      const newFileButton = getButtonByTitle('Create new empty file');
      expect(newFileButton).toBeDisabled();
    });

    it('enables New File button when a bucket is selected', () => {
      render(<FileToolbar {...defaultProps} />);

      const newFileButton = getButtonByTitle('Create new empty file');
      expect(newFileButton).not.toBeDisabled();
    });

    it('calls onNewFile when New File button is clicked', () => {
      const onNewFile = vi.fn();
      render(<FileToolbar {...defaultProps} onNewFile={onNewFile} />);

      fireEvent.click(getButtonByTitle('Create new empty file'));
      expect(onNewFile).toHaveBeenCalled();
    });

    it('disables New File button when toolbar is disabled', () => {
      render(<FileToolbar {...defaultProps} disabled={true} />);

      const newFileButton = getButtonByTitle('Create new empty file');
      expect(newFileButton).toBeDisabled();
    });

    it('enables New File button regardless of file selection', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
        />
      );

      const newFileButton = getButtonByTitle('Create new empty file');
      expect(newFileButton).not.toBeDisabled();
    });
  });

  describe('New Folder button', () => {
    it('disables New Folder button when no bucket is selected', () => {
      render(<FileToolbar {...defaultProps} selectedBucket={null} />);

      const newFolderButton = getButtonByTitle('Create new folder');
      expect(newFolderButton).toBeDisabled();
    });

    it('enables New Folder button when a bucket is selected', () => {
      render(<FileToolbar {...defaultProps} />);

      const newFolderButton = getButtonByTitle('Create new folder');
      expect(newFolderButton).not.toBeDisabled();
    });

    it('calls onNewFolder when New Folder button is clicked', () => {
      const onNewFolder = vi.fn();
      render(<FileToolbar {...defaultProps} onNewFolder={onNewFolder} />);

      fireEvent.click(getButtonByTitle('Create new folder'));
      expect(onNewFolder).toHaveBeenCalled();
    });

    it('disables New Folder button when toolbar is disabled', () => {
      render(<FileToolbar {...defaultProps} disabled={true} />);

      const newFolderButton = getButtonByTitle('Create new folder');
      expect(newFolderButton).toBeDisabled();
    });

    it('enables New Folder button regardless of file selection', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'file.txt', isPrefix: false }}
        />
      );

      const newFolderButton = getButtonByTitle('Create new folder');
      expect(newFolderButton).not.toBeDisabled();
    });
  });

  describe('JSON button', () => {
    it('disables JSON button when no file is selected', () => {
      render(<FileToolbar {...defaultProps} selectedFile={null} />);

      const jsonButton = getButtonByTitle(/Select a JSON file to view/);
      expect(jsonButton).toBeDisabled();
    });

    it('disables JSON button when a folder is selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'folder/', isPrefix: true }}
        />
      );

      const jsonButton = getButtonByTitle(/Select a JSON file to view/);
      expect(jsonButton).toBeDisabled();
    });

    it('disables JSON button for non-JSON files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'data.csv', isPrefix: false }}
        />
      );

      const jsonButton = getButtonByTitle(/Select a JSON file to view/);
      expect(jsonButton).toBeDisabled();
    });

    it('enables JSON button for JSON files', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'config.json', isPrefix: false }}
        />
      );

      const jsonButton = getButtonByTitle('View JSON file');
      expect(jsonButton).not.toBeDisabled();
    });

    it('calls onViewJson when JSON button is clicked', () => {
      const onViewJson = vi.fn();
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'config.json', isPrefix: false }}
          onViewJson={onViewJson}
        />
      );

      fireEvent.click(getButtonByTitle('View JSON file'));
      expect(onViewJson).toHaveBeenCalled();
    });

    it('disables JSON button when toolbar is disabled', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'config.json', isPrefix: false }}
          disabled={true}
        />
      );

      const jsonButton = getButtonByTitle('View JSON file');
      expect(jsonButton).toBeDisabled();
    });

    it('disables JSON button when multiple files are selected', () => {
      render(
        <FileToolbar
          {...defaultProps}
          selectedFile={{ key: 'config.json', isPrefix: false }}
          selectedCount={2}
        />
      );

      const jsonButton = getButtonByTitle(/Select a JSON file to view/);
      expect(jsonButton).toBeDisabled();
    });
  });

  describe('icon-only toolbar', () => {
    it('renders all buttons as icon-only with correct class', () => {
      render(<FileToolbar {...defaultProps} />);

      // All toolbar buttons should have the icon-only class
      const buttons = document.querySelectorAll('.toolbar-btn.toolbar-btn-icon');
      expect(buttons.length).toBe(14); // All 14 toolbar buttons (including JSON)
    });

    it('all buttons have aria-label for accessibility', () => {
      render(<FileToolbar {...defaultProps} />);

      const buttons = document.querySelectorAll('.toolbar-btn.toolbar-btn-icon');
      buttons.forEach((button) => {
        expect(button).toHaveAttribute('aria-label');
        expect(button.getAttribute('aria-label')).not.toBe('');
      });
    });

    it('all buttons have title attribute for tooltip', () => {
      render(<FileToolbar {...defaultProps} />);

      const buttons = document.querySelectorAll('.toolbar-btn.toolbar-btn-icon');
      buttons.forEach((button) => {
        expect(button).toHaveAttribute('title');
        expect(button.getAttribute('title')).not.toBe('');
      });
    });

    it('buttons contain SVG icons', () => {
      render(<FileToolbar {...defaultProps} />);

      const buttons = document.querySelectorAll('.toolbar-btn.toolbar-btn-icon');
      buttons.forEach((button) => {
        const svg = button.querySelector('svg');
        expect(svg).toBeInTheDocument();
      });
    });
  });
});
