import React from 'react';

export interface FileToolbarProps {
  selectedBucket: string | null;
  currentPrefix: string;
  selectedFile: {
    key: string;
    isPrefix: boolean;
  } | null;
  /** Number of files selected in multiselect */
  selectedCount: number;
  onUpload: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onRename: () => void;
  onEdit: () => void;
  onViewParquet: () => void;
  onViewImage: () => void;
  onCopyUrl: () => void;
  onRefresh: () => void;
  disabled?: boolean;
}

/**
 * Determine if a file can be edited in the text editor
 */
function isEditableFile(key: string): boolean {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  const editableExtensions = [
    // Text
    'txt', 'log', 'csv', 'tsv',
    // Data
    'json', 'yaml', 'yml', 'xml', 'toml', 'ini', 'conf', 'cfg', 'properties', 'env',
    // Code
    'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php',
    'sh', 'bash', 'zsh', 'ps1', 'sql',
    // Markup
    'md', 'markdown', 'html', 'htm', 'css', 'scss', 'less', 'svg',
    // Other
    'dockerfile', 'makefile', 'gitignore', 'editorconfig', 'graphql', 'gql',
  ];
  return editableExtensions.includes(ext) || key.endsWith('file'); // e.g., Dockerfile, Makefile
}

/**
 * Determine if a file is a parquet file
 */
function isParquetFile(key: string): boolean {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'parquet';
}

/**
 * Determine if a file is an image that can be previewed
 */
function isImageFile(key: string): boolean {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
  return imageExtensions.includes(ext);
}

function FileToolbar({
  selectedBucket,
  currentPrefix,
  selectedFile,
  selectedCount,
  onUpload,
  onDownload,
  onDelete,
  onRename,
  onEdit,
  onViewParquet,
  onViewImage,
  onCopyUrl,
  onRefresh,
  disabled = false,
}: FileToolbarProps): React.ReactElement {
  const hasSelection = selectedFile !== null && !selectedFile.isPrefix;
  const hasMultipleSelection = selectedCount > 1;
  const canEdit = hasSelection && !hasMultipleSelection && isEditableFile(selectedFile!.key);
  const canViewParquet = hasSelection && !hasMultipleSelection && isParquetFile(selectedFile!.key);
  const canViewImage = hasSelection && !hasMultipleSelection && isImageFile(selectedFile!.key);
  // Delete is allowed for any number of files selected (but not folders)
  const canDelete = selectedCount > 0;

  return (
    <div className="file-toolbar">
      <button
        className="toolbar-btn"
        onClick={onUpload}
        disabled={disabled || !selectedBucket}
        title="Upload files"
      >
        <span className="toolbar-icon">+</span>
        <span className="toolbar-label">Upload</span>
      </button>
      <button
        className="toolbar-btn"
        onClick={onDownload}
        disabled={disabled || !hasSelection || hasMultipleSelection}
        title={hasMultipleSelection ? 'Download not available for multiple files' : 'Download selected file'}
      >
        <span className="toolbar-icon">D</span>
        <span className="toolbar-label">Download</span>
      </button>
      <button
        className="toolbar-btn"
        onClick={onEdit}
        disabled={disabled || !canEdit}
        title={canEdit ? 'Edit selected file' : 'Select a text file to edit'}
      >
        <span className="toolbar-icon">E</span>
        <span className="toolbar-label">Edit</span>
      </button>
      <button
        className="toolbar-btn"
        onClick={onViewParquet}
        disabled={disabled || !canViewParquet}
        title={canViewParquet ? 'View parquet file' : 'Select a parquet file to view'}
      >
        <span className="toolbar-icon">P</span>
        <span className="toolbar-label">Parquet</span>
      </button>
      <button
        className="toolbar-btn"
        onClick={onViewImage}
        disabled={disabled || !canViewImage}
        title={canViewImage ? 'Preview image' : 'Select an image file to preview'}
      >
        <span className="toolbar-icon">I</span>
        <span className="toolbar-label">Image</span>
      </button>
      <button
        className="toolbar-btn toolbar-btn-copy"
        onClick={onCopyUrl}
        disabled={disabled || !hasSelection || hasMultipleSelection}
        title={hasMultipleSelection ? 'Copy URL not available for multiple files' : (hasSelection ? 'Copy S3 URL to clipboard' : 'Select a file to copy URL')}
      >
        <span className="toolbar-icon">C</span>
        <span className="toolbar-label">Copy URL</span>
      </button>
      <button
        className="toolbar-btn"
        onClick={onRename}
        disabled={disabled || !hasSelection || hasMultipleSelection}
        title={hasMultipleSelection ? 'Rename not available for multiple files' : 'Rename selected file'}
      >
        <span className="toolbar-icon">R</span>
        <span className="toolbar-label">Rename</span>
      </button>
      <button
        className="toolbar-btn toolbar-btn-danger"
        onClick={onDelete}
        disabled={disabled || !canDelete}
        title={selectedCount > 1 ? `Delete ${selectedCount} files` : 'Delete selected file'}
      >
        <span className="toolbar-icon">X</span>
        <span className="toolbar-label">{selectedCount > 1 ? `Delete (${selectedCount})` : 'Delete'}</span>
      </button>
      <div className="toolbar-spacer" />
      <button
        className="toolbar-btn"
        onClick={onRefresh}
        disabled={disabled || !selectedBucket}
        title="Refresh file list"
      >
        <span className="toolbar-icon">R</span>
        <span className="toolbar-label">Refresh</span>
      </button>
    </div>
  );
}

export default FileToolbar;
