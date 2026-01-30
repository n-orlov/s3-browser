import React from 'react';
import type { S3Object } from './FileList';

export interface StatusBarProps {
  /** Total items loaded so far */
  loadedCount: number;
  /** Whether all items have been loaded (no more pages) */
  allLoaded: boolean;
  /** Currently selected files */
  selectedFiles: S3Object[];
  /** Whether items are currently loading */
  loading?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function StatusBar({
  loadedCount,
  allLoaded,
  selectedFiles,
  loading = false,
}: StatusBarProps): React.ReactElement {
  // Calculate total size of selected files (excluding folders)
  const selectedSize = selectedFiles
    .filter((f) => !f.isPrefix)
    .reduce((sum, f) => sum + (f.size || 0), 0);

  const selectedCount = selectedFiles.filter((f) => !f.isPrefix).length;

  // Build item count string
  const itemCountText = allLoaded
    ? `${loadedCount} items`
    : `${loadedCount} items loaded${loading ? '...' : ' (more available)'}`;

  // Build selection text
  const selectionText =
    selectedCount > 0
      ? `${selectedCount} selected (${formatFileSize(selectedSize)})`
      : 'No selection';

  return (
    <div className="status-bar" data-testid="status-bar">
      <div className="status-bar-left">
        <span className="status-bar-items" data-testid="status-bar-items">
          {itemCountText}
        </span>
      </div>
      <div className="status-bar-right">
        <span className="status-bar-selection" data-testid="status-bar-selection">
          {selectionText}
        </span>
      </div>
    </div>
  );
}

export default StatusBar;
