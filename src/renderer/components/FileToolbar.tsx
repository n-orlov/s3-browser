import React, { useState } from 'react';

export interface FileToolbarProps {
  selectedBucket: string | null;
  currentPrefix: string;
  selectedFile: {
    key: string;
    isPrefix: boolean;
  } | null;
  onUpload: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onRename: () => void;
  onRefresh: () => void;
  disabled?: boolean;
}

function FileToolbar({
  selectedBucket,
  currentPrefix,
  selectedFile,
  onUpload,
  onDownload,
  onDelete,
  onRename,
  onRefresh,
  disabled = false,
}: FileToolbarProps): React.ReactElement {
  const hasSelection = selectedFile !== null && !selectedFile.isPrefix;

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
        disabled={disabled || !hasSelection}
        title="Download selected file"
      >
        <span className="toolbar-icon">D</span>
        <span className="toolbar-label">Download</span>
      </button>
      <button
        className="toolbar-btn"
        onClick={onRename}
        disabled={disabled || !hasSelection}
        title="Rename selected file"
      >
        <span className="toolbar-icon">R</span>
        <span className="toolbar-label">Rename</span>
      </button>
      <button
        className="toolbar-btn toolbar-btn-danger"
        onClick={onDelete}
        disabled={disabled || !hasSelection}
        title="Delete selected file"
      >
        <span className="toolbar-icon">X</span>
        <span className="toolbar-label">Delete</span>
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
