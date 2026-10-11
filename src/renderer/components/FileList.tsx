import React, { useEffect, useCallback, useRef, useState, useMemo, DragEvent } from 'react';
import FileListControls, {
  SortConfig,
  SortField,
  sortItems,
  filterByType,
  filterBySearch,
} from './FileListControls';
import { usePendingFileSelection, type PendingFileSelection } from './usePendingFileSelection';
import { useResettingState } from './useResettingState';
import { useObjectListing } from './useObjectListing';
import { FOLDER_ICON, getIconForExtension, getKeyExtension } from '../utils/fileIcons';

export interface S3Object {
  key: string;
  size: number;
  lastModified?: Date;
  etag?: string;
  storageClass?: string;
  isPrefix: boolean;
}

export interface FileListProps {
  currentProfile: string | null;
  selectedBucket: string | null;
  currentPrefix: string;
  onNavigate: (prefix: string) => void;
  onSelectFile: (file: S3Object | null) => void;
  selectedFile: S3Object | null;
  /** Array of selected files for multiselect */
  selectedFiles: S3Object[];
  /** Callback for multiselect changes */
  onSelectFiles: (files: S3Object[]) => void;
  onFilesDropped?: (filePaths: string[]) => void;
  onRefreshRequest?: () => void;
  /** Key to auto-select after files are loaded (for URL navigation) */
  pendingFileSelection?: string | null;
  /** Callback when pending file selection is processed */
  onPendingFileSelectionHandled?: () => void;
  /** Callback to report item count changes for status bar */
  onItemCountChange?: (count: number, allLoaded: boolean, loading: boolean) => void;
  /** Callback for double-click on a file (triggers download) */
  onDownloadFile?: (file: S3Object) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(date: Date | undefined): string {
  if (!date) return '--';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

function getFileName(key: string, prefix: string): string {
  // Remove the current prefix from the key to get just the filename
  const name = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  // Remove trailing slash for folders
  return name.endsWith('/') ? name.slice(0, -1) : name;
}

function getFileIcon(key: string, isPrefix: boolean): string {
  if (isPrefix) return FOLDER_ICON;
  return getIconForExtension(getKeyExtension(key));
}

/** Progress overlay shown while further pages are loaded to find the pending file. */
function FileSearchOverlay({
  search,
  loadedCount,
}: {
  search: PendingFileSelection;
  loadedCount: number;
}): React.ReactElement | null {
  if (!search.isSearching) return null;
  return (
    <div className="file-search-overlay">
      <div className="file-search-progress">
        <span className="loading-spinner"></span>
        <div className="file-search-info">
          <span className="file-search-title">Searching for file...</span>
          <span className="file-search-detail">Loaded {loadedCount} items</span>
          <span className="file-search-target" title={search.targetKey}>
            {search.targetKey.split('/').pop()}
          </span>
        </div>
        <button className="file-search-cancel" onClick={search.cancel} title="Cancel search">
          Cancel
        </button>
      </div>
    </div>
  );
}

function FileList({
  currentProfile,
  selectedBucket,
  currentPrefix,
  onNavigate,
  onSelectFile,
  selectedFile,
  selectedFiles,
  onSelectFiles,
  onFilesDropped,
  onRefreshRequest,
  pendingFileSelection,
  onPendingFileSelectionHandled,
  onItemCountChange,
  onDownloadFile,
}: FileListProps): React.ReactElement {
  const listing = useObjectListing(currentProfile, selectedBucket, currentPrefix);
  const { items, loading, error, hasMore, loadMore, reload } = listing;
  const [isDragOver, setIsDragOver] = useState(false);

  // Sorting and filtering state
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    field: 'name',
    direction: 'asc',
  });
  const [filterType, setFilterType] = useState('all');
  // The search box is cleared when navigating to a new location
  const [searchQuery, setSearchQuery] = useResettingState(
    '',
    `${selectedBucket}|${currentPrefix}`
  );

  const listContainerRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  // Track last clicked index for shift+click range selection
  const lastClickedIndexRef = useRef<number>(-1);

  // Clear selection on navigation
  useEffect(() => {
    onSelectFile(null);
    onSelectFiles([]);
    lastClickedIndexRef.current = -1;
  }, [currentProfile, selectedBucket, currentPrefix, onSelectFile, onSelectFiles]);

  // Scroll to a specific file row
  const scrollToFile = useCallback((key: string) => {
    const rowElement = rowRefs.current.get(key);
    if (rowElement) {
      rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add a brief highlight effect
      rowElement.classList.add('highlight-found');
      setTimeout(() => rowElement.classList.remove('highlight-found'), 2000);
    }
  }, []);

  // Select the pending file once loaded, loading further pages while it is missing
  const fileSearch = usePendingFileSelection({
    listing,
    pendingFileSelection,
    onSelectFile,
    onPendingFileSelectionHandled,
    scrollToFile,
  });
  const loadingMore = listing.loadingMore || fileSearch.isSearching;

  // Compute filtered and sorted items
  const displayedItems = useMemo(() => {
    let result = items;
    result = filterByType(result, filterType);
    result = filterBySearch(result, searchQuery, currentPrefix);
    result = sortItems(result, sortConfig);
    return result;
  }, [items, filterType, searchQuery, currentPrefix, sortConfig]);

  const handleScroll = useCallback(() => {
    if (!listContainerRef.current || loadingMore || !hasMore) return;

    const { scrollTop, scrollHeight, clientHeight } = listContainerRef.current;
    // Load more when within 100px of bottom
    if (scrollHeight - scrollTop - clientHeight < 100) {
      loadMore();
    }
  }, [loadingMore, hasMore, loadMore]);

  // Column header sorting handler
  const handleSort = useCallback((field: SortField) => {
    setSortConfig((prev) => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  const getSortIndicator = useCallback(
    (field: SortField) => {
      if (sortConfig.field !== field) return null;
      return sortConfig.direction === 'asc' ? ' \u25B2' : ' \u25BC';
    },
    [sortConfig]
  );

  const handleItemClick = (item: S3Object, index: number, event: React.MouseEvent) => {
    // Handle multiselect with modifier keys - works for both files and folders
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isCtrlOrCmd = isMac ? event.metaKey : event.ctrlKey;

    if (event.shiftKey && lastClickedIndexRef.current >= 0) {
      // Shift+click: range selection (includes both files and folders)
      const start = Math.min(lastClickedIndexRef.current, index);
      const end = Math.max(lastClickedIndexRef.current, index);
      const rangeItems = displayedItems.slice(start, end + 1);

      if (isCtrlOrCmd) {
        // Shift+Ctrl/Cmd: add range to existing selection
        const existingKeys = new Set(selectedFiles.map(f => f.key));
        const newSelection = [...selectedFiles];
        for (const rangeItem of rangeItems) {
          if (!existingKeys.has(rangeItem.key)) {
            newSelection.push(rangeItem);
          }
        }
        onSelectFiles(newSelection);
      } else {
        // Shift only: replace selection with range
        onSelectFiles(rangeItems);
      }
      // Set the primary selected file to the clicked item
      onSelectFile(item);
    } else if (isCtrlOrCmd) {
      // Ctrl/Cmd+click: toggle selection
      const isSelected = selectedFiles.some(f => f.key === item.key);
      if (isSelected) {
        const newSelection = selectedFiles.filter(f => f.key !== item.key);
        onSelectFiles(newSelection);
        onSelectFile(newSelection.length > 0 ? newSelection[newSelection.length - 1] : null);
      } else {
        onSelectFiles([...selectedFiles, item]);
        onSelectFile(item);
      }
      lastClickedIndexRef.current = index;
    } else {
      // Single click: select only this item (same behavior for files and folders)
      onSelectFile(item);
      onSelectFiles([item]);
      lastClickedIndexRef.current = index;
    }
  };

  const handleItemDoubleClick = (item: S3Object) => {
    if (item.isPrefix) {
      // Double-click on folder: navigate into it
      onNavigate(item.key);
      onSelectFile(null);
      onSelectFiles([]);
      lastClickedIndexRef.current = -1;
    } else {
      // Double-click on file: trigger download
      onDownloadFile?.(item);
    }
  };

  const handleGoUp = () => {
    if (!currentPrefix) return;

    // Get parent prefix
    const parts = currentPrefix.slice(0, -1).split('/');
    parts.pop();
    const parentPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
    onNavigate(parentPrefix);
  };

  // Expose refresh via callback
  useEffect(() => {
    if (onRefreshRequest) {
      // This is a bit of a hack - we're using the callback to trigger refresh
      // A more elegant solution would use useImperativeHandle
    }
  }, [onRefreshRequest]);

  // Drag and drop handlers
  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    if (onFilesDropped && e.dataTransfer.files.length > 0) {
      // Get file paths from dropped files
      const files = Array.from(e.dataTransfer.files);
      // Note: In Electron, file.path gives us the absolute path
      const paths = files.map((f) => (f as File & { path: string }).path).filter(Boolean);
      if (paths.length > 0) {
        onFilesDropped(paths);
      }
    }
  };

  // Expose refresh function through a custom event listener approach
  useEffect(() => {
    const handleRefresh = reload;
    window.addEventListener('s3-refresh-files', handleRefresh);
    return () => window.removeEventListener('s3-refresh-files', handleRefresh);
  }, [reload]);

  // Notify parent of item count changes for status bar
  useEffect(() => {
    if (onItemCountChange) {
      const allLoaded = !hasMore;
      const isLoading = loading || loadingMore;
      onItemCountChange(items.length, allLoaded, isLoading);
    }
  }, [items.length, hasMore, loading, loadingMore, onItemCountChange]);

  if (!currentProfile) {
    return (
      <div className="file-list-container">
        <p className="file-list-placeholder">Select a profile to browse files</p>
      </div>
    );
  }

  if (!selectedBucket) {
    return (
      <div className="file-list-container">
        <p className="file-list-placeholder">Select a bucket to view files</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="file-list-container">
        <div className="file-list-loading">
          <span className="loading-spinner"></span>
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="file-list-container">
        <div className="file-list-error">
          <span className="error-icon">!</span>
          <span>{error}</span>
          <button className="retry-btn" onClick={reload}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`file-list-container ${isDragOver ? 'drag-over' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="drop-overlay">
          <div className="drop-message">Drop files here to upload</div>
        </div>
      )}
      <FileSearchOverlay search={fileSearch} loadedCount={items.length} />
      {/* Breadcrumb / current path */}
      <div className="file-list-toolbar">
        <div className="breadcrumb">
          <button
            className="breadcrumb-item breadcrumb-bucket"
            onClick={() => onNavigate('')}
            title={selectedBucket}
          >
            {selectedBucket}
          </button>
          {currentPrefix && (
            <>
              {currentPrefix.split('/').filter(Boolean).map((part, idx, arr) => {
                const prefix = arr.slice(0, idx + 1).join('/') + '/';
                return (
                  <React.Fragment key={prefix}>
                    <span className="breadcrumb-separator">/</span>
                    <button
                      className="breadcrumb-item"
                      onClick={() => onNavigate(prefix)}
                      title={part}
                    >
                      {part}
                    </button>
                  </React.Fragment>
                );
              })}
            </>
          )}
        </div>
        {currentPrefix && (
          <button className="go-up-btn" onClick={handleGoUp} title="Go to parent folder">
            ↑ Up
          </button>
        )}
      </div>

      {/* Filter and search controls */}
      <FileListControls
        sortConfig={sortConfig}
        onSortChange={setSortConfig}
        filterType={filterType}
        onFilterTypeChange={setFilterType}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        totalCount={items.length}
        filteredCount={displayedItems.length}
        disabled={loading}
      />

      {/* File list table */}
      <div
        className="file-list-table-wrapper"
        ref={listContainerRef}
        onScroll={handleScroll}
      >
        {items.length === 0 ? (
          <p className="file-list-empty">This folder is empty</p>
        ) : displayedItems.length === 0 ? (
          <p className="file-list-empty">No files match your filter</p>
        ) : (
          <table className="file-list-table">
            <thead>
              <tr>
                <th
                  className="col-name sortable-header"
                  onClick={() => handleSort('name')}
                  title="Sort by name"
                >
                  Name{getSortIndicator('name')}
                </th>
                <th
                  className="col-size sortable-header"
                  onClick={() => handleSort('size')}
                  title="Sort by size"
                >
                  Size{getSortIndicator('size')}
                </th>
                <th
                  className="col-modified sortable-header"
                  onClick={() => handleSort('lastModified')}
                  title="Sort by date"
                >
                  Last Modified{getSortIndicator('lastModified')}
                </th>
              </tr>
            </thead>
            <tbody>
              {displayedItems.map((item, index) => {
                const name = getFileName(item.key, currentPrefix);
                const isSelected = selectedFile?.key === item.key;
                const isInMultiselect = selectedFiles.some(f => f.key === item.key);
                return (
                  <tr
                    key={item.key}
                    ref={(el) => {
                      if (el) {
                        rowRefs.current.set(item.key, el);
                      } else {
                        rowRefs.current.delete(item.key);
                      }
                    }}
                    className={`file-row ${item.isPrefix ? 'folder' : 'file'} ${isSelected ? 'selected' : ''} ${isInMultiselect && !isSelected ? 'multiselected' : ''}`}
                    onClick={(e) => handleItemClick(item, index, e)}
                    onDoubleClick={() => handleItemDoubleClick(item)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (item.isPrefix) {
                          // Enter on folder: navigate into it
                          onNavigate(item.key);
                          onSelectFile(null);
                          onSelectFiles([]);
                          lastClickedIndexRef.current = -1;
                        } else {
                          // Enter on file: trigger download
                          onDownloadFile?.(item);
                        }
                      }
                    }}
                  >
                    <td className="col-name">
                      <span className="file-icon">{getFileIcon(item.key, item.isPrefix)}</span>
                      <span className="file-name" title={name}>
                        {name}
                      </span>
                    </td>
                    <td className="col-size">{formatFileSize(item.size)}</td>
                    <td className="col-modified">{formatDate(item.lastModified)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {loadingMore && (
          <div className="file-list-loading-more">
            <span className="loading-spinner small"></span>
            <span>Loading more...</span>
          </div>
        )}
        {hasMore && !loadingMore && (
          <div className="file-list-has-more">
            <span>Scroll to load more</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default FileList;
