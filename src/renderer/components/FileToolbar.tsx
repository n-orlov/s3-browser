import React from 'react';
import { getToolbarState } from '../utils/fileToolbarState';

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
  onViewCsv: () => void;
  onViewJson: () => void;
  onViewYaml: () => void;
  onViewImage: () => void;
  onCopyUrl: () => void;
  onRefresh: () => void;
  onProperties: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  disabled?: boolean;
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
  csv: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  ),
  json: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6c0-1.1.9-2 2-2h2" />
      <path d="M4 18c0 1.1.9 2 2 2h2" />
      <path d="M20 6c0-1.1-.9-2-2-2h-2" />
      <path d="M20 18c0 1.1-.9 2-2 2h-2" />
      <path d="M4 12h4" />
      <path d="M16 12h4" />
    </svg>
  ),
  yaml: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="12" y2="17" />
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
  selectedFile,
  selectedCount,
  onUpload,
  onDownload,
  onDelete,
  onRename,
  onEdit,
  onViewParquet,
  onViewCsv,
  onViewJson,
  onViewYaml,
  onViewImage,
  onCopyUrl,
  onRefresh,
  onProperties,
  onNewFile,
  onNewFolder,
  disabled = false,
}: FileToolbarProps): React.ReactElement {
  const state = getToolbarState(selectedBucket, selectedFile, selectedCount, disabled);

  return (
    <div className="file-toolbar">
      <ToolbarButton icon={Icons.newFile} onClick={onNewFile} {...state.newFile} />
      <ToolbarButton icon={Icons.newFolder} onClick={onNewFolder} {...state.newFolder} />
      <ToolbarButton icon={Icons.upload} onClick={onUpload} {...state.upload} />
      <ToolbarButton icon={Icons.download} onClick={onDownload} {...state.download} />
      <ToolbarButton icon={Icons.edit} onClick={onEdit} {...state.edit} />
      <ToolbarButton icon={Icons.parquet} onClick={onViewParquet} {...state.parquet} />
      <ToolbarButton icon={Icons.csv} onClick={onViewCsv} {...state.csv} />
      <ToolbarButton icon={Icons.json} onClick={onViewJson} {...state.json} />
      <ToolbarButton icon={Icons.yaml} onClick={onViewYaml} {...state.yaml} />
      <ToolbarButton icon={Icons.image} onClick={onViewImage} {...state.image} />
      <ToolbarButton icon={Icons.copy} onClick={onCopyUrl} className="toolbar-btn-copy" {...state.copy} />
      <ToolbarButton icon={Icons.rename} onClick={onRename} {...state.rename} />
      <ToolbarButton icon={Icons.delete} onClick={onDelete} className="toolbar-btn-danger" {...state.delete} />
      <ToolbarButton icon={Icons.properties} onClick={onProperties} {...state.properties} />
      <div className="toolbar-spacer" />
      <ToolbarButton icon={Icons.refresh} onClick={onRefresh} {...state.refresh} />
    </div>
  );
}

export default FileToolbar;
