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
  onProperties: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
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

// SVG Icons as components for better readability
const Icons = {
  newFile: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  ),
  newFolder: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  ),
  upload: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17,8 12,3 7,8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7,10 12,15 17,10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  parquet: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21,15 16,10 5,21" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  ),
  rename: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  ),
  delete: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,6 5,6 21,6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  ),
  properties: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  refresh: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23,4 23,10 17,10" />
      <polyline points="1,20 1,14 7,14" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  ),
};

interface ToolbarButtonProps {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  badge?: string;
}

function ToolbarButton({ icon, title, onClick, disabled, className = '', badge }: ToolbarButtonProps): React.ReactElement {
  return (
    <button
      className={`toolbar-btn toolbar-btn-icon ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      <span className="toolbar-icon">{icon}</span>
      {badge && <span className="toolbar-badge">{badge}</span>}
    </button>
  );
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
  onProperties,
  onNewFile,
  onNewFolder,
  disabled = false,
}: FileToolbarProps): React.ReactElement {
  const hasSelection = selectedFile !== null && !selectedFile.isPrefix;
  const hasFolderSelection = selectedFile !== null && selectedFile.isPrefix;
  const hasAnySelection = selectedFile !== null;
  const hasMultipleSelection = selectedCount > 1;
  const canEdit = hasSelection && !hasMultipleSelection && isEditableFile(selectedFile!.key);
  const canViewParquet = hasSelection && !hasMultipleSelection && isParquetFile(selectedFile!.key);
  const canViewImage = hasSelection && !hasMultipleSelection && isImageFile(selectedFile!.key);
  // Delete is allowed for any number of files selected (but not folders)
  const canDelete = selectedCount > 0;
  // Properties can be shown for any single selected item (file or folder)
  const canShowProperties = hasAnySelection && !hasMultipleSelection;

  return (
    <div className="file-toolbar">
      <ToolbarButton
        icon={Icons.newFile}
        title="Create new empty file"
        onClick={onNewFile}
        disabled={disabled || !selectedBucket}
      />
      <ToolbarButton
        icon={Icons.newFolder}
        title="Create new folder"
        onClick={onNewFolder}
        disabled={disabled || !selectedBucket}
      />
      <ToolbarButton
        icon={Icons.upload}
        title="Upload files"
        onClick={onUpload}
        disabled={disabled || !selectedBucket}
      />
      <ToolbarButton
        icon={Icons.download}
        title={hasMultipleSelection ? 'Download not available for multiple files' : 'Download selected file'}
        onClick={onDownload}
        disabled={disabled || !hasSelection || hasMultipleSelection}
      />
      <ToolbarButton
        icon={Icons.edit}
        title={canEdit ? 'Edit selected file' : 'Select a text file to edit'}
        onClick={onEdit}
        disabled={disabled || !canEdit}
      />
      <ToolbarButton
        icon={Icons.parquet}
        title={canViewParquet ? 'View parquet file' : 'Select a parquet file to view'}
        onClick={onViewParquet}
        disabled={disabled || !canViewParquet}
      />
      <ToolbarButton
        icon={Icons.image}
        title={canViewImage ? 'Preview image' : 'Select an image file to preview'}
        onClick={onViewImage}
        disabled={disabled || !canViewImage}
      />
      <ToolbarButton
        icon={Icons.copy}
        title={hasMultipleSelection ? 'Copy URL not available for multiple files' : (hasSelection ? 'Copy S3 URL to clipboard' : 'Select a file to copy URL')}
        onClick={onCopyUrl}
        disabled={disabled || !hasSelection || hasMultipleSelection}
        className="toolbar-btn-copy"
      />
      <ToolbarButton
        icon={Icons.rename}
        title={hasMultipleSelection ? 'Rename not available for multiple files' : 'Rename selected file'}
        onClick={onRename}
        disabled={disabled || !hasSelection || hasMultipleSelection}
      />
      <ToolbarButton
        icon={Icons.delete}
        title={selectedCount > 1 ? `Delete ${selectedCount} files` : 'Delete selected file'}
        onClick={onDelete}
        disabled={disabled || !canDelete}
        className="toolbar-btn-danger"
        badge={selectedCount > 1 ? String(selectedCount) : undefined}
      />
      <ToolbarButton
        icon={Icons.properties}
        title={canShowProperties ? 'View properties' : 'Select a file or folder to view properties'}
        onClick={onProperties}
        disabled={disabled || !canShowProperties}
      />
      <div className="toolbar-spacer" />
      <ToolbarButton
        icon={Icons.refresh}
        title="Refresh file list"
        onClick={onRefresh}
        disabled={disabled || !selectedBucket}
      />
    </div>
  );
}

export default FileToolbar;
