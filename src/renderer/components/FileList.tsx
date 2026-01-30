import React, { useEffect, useCallback, useRef, useState, useMemo, DragEvent } from 'react';
import FileListControls, {
  SortConfig,
  SortField,
  sortItems,
  filterByType,
  filterBySearch,
} from './FileListControls';

export interface S3Object {
  key: string;
  size: number;
  lastModified?: Date;
  etag?: string;
  storageClass?: string;
  isPrefix: boolean;
}

/** State for tracking file search progress during URL navigation */
interface FileSearchState {
  isSearching: boolean;
  targetKey: string;
  loadedCount: number;
  cancelled: boolean;
}

export interface FileListProps {
  currentProfile: string | null;
  selectedBucket: string | null;
  currentPrefix: string;
  onNavigate: (prefix: string) => void;
  onSelectFile: (file: S3Object | null) => void;
  selectedFile: S3Object | null;
  onFilesDropped?: (filePaths: string[]) => void;
  onRefreshRequest?: () => void;
  /** Key to auto-select after files are loaded (for URL navigation) */
  pendingFileSelection?: string | null;
  /** Callback when pending file selection is processed */
  onPendingFileSelectionHandled?: () => void;
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
  if (isPrefix) return '📁';

  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'json':
      return '📋';
    case 'yaml':
    case 'yml':
      return '📋';
    case 'txt':
      return '📄';
    case 'csv':
      return '📊';
    case 'parquet':
      return '📊';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return '🖼️';
    case 'pdf':
      return '📕';
    case 'zip':
    case 'tar':
    case 'gz':
      return '📦';
    default:
      return '📄';
  }
}

function FileList({
  currentProfile,
  selectedBucket,
  currentPrefix,
  onNavigate,
  onSelectFile,
  selectedFile,
  onFilesDropped,
  onRefreshRequest,
  pendingFileSelection,
  onPendingFileSelectionHandled,
}: FileListProps): React.ReactElement {
  const [items, setItems] = useState<S3Object[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Sorting and filtering state
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    field: 'name',
    direction: 'asc',
  });
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // State for file search during URL navigation
  const [fileSearchState, setFileSearchState] = useState<FileSearchState>({
    isSearching: false,
    targetKey: '',
    loadedCount: 0,
    cancelled: false,
  });

  const continuationTokenRef = useRef<string | undefined>(undefined);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  const loadObjects = useCallback(
    async (reset = true) => {
      if (!currentProfile || !selectedBucket) {
        setItems([]);
        return;
      }

      try {
        if (reset) {
          setLoading(true);
          setItems([]);
          continuationTokenRef.current = undefined;
        } else {
          setLoadingMore(true);
        }
        setError(null);

        const result = await window.electronAPI.s3.listObjects({
          bucket: selectedBucket,
          prefix: currentPrefix,
          delimiter: '/',
          maxKeys: 100,
          continuationToken: reset ? undefined : continuationTokenRef.current,
        });

        if (!result.success) {
          setError(result.error ?? 'Failed to list objects');
          return;
        }

        const data = result.result!;
        continuationTokenRef.current = data.continuationToken;
        setHasMore(data.isTruncated);

        // Combine prefixes and objects - prefixes first
        const combined = [...data.prefixes, ...data.objects];

        if (reset) {
          setItems(combined);
        } else {
          // For pagination, only new objects are appended (prefixes come in first page)
          setItems((prev) => [...prev, ...data.objects]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to list objects');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [currentProfile, selectedBucket, currentPrefix]
  );

  useEffect(() => {
    loadObjects(true);
    onSelectFile(null); // Clear selection on navigation
  }, [selectedBucket, currentPrefix, loadObjects, onSelectFile]);

  // Cancel file search
  const cancelFileSearch = useCallback(() => {
    setFileSearchState((prev) => ({ ...prev, cancelled: true, isSearching: false }));
    onPendingFileSelectionHandled?.();
  }, [onPendingFileSelectionHandled]);

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

  // Handle pending file selection - search through all pages if needed
  useEffect(() => {
    // Skip if no pending selection, still loading, or search was cancelled
    if (!pendingFileSelection || loading || fileSearchState.cancelled) {
      return;
    }

    // Check if file is in currently loaded items
    const fileToSelect = items.find((item) => item.key === pendingFileSelection);

    if (fileToSelect) {
      // File found! Select it and scroll to it
      onSelectFile(fileToSelect);
      setFileSearchState({ isSearching: false, targetKey: '', loadedCount: 0, cancelled: false });
      onPendingFileSelectionHandled?.();

      // Scroll to the file after a brief delay to let the DOM update
      setTimeout(() => scrollToFile(fileToSelect.key), 100);
      return;
    }

    // File not found yet - check if we need to load more
    if (hasMore && !loadingMore) {
      // Start or continue searching
      setFileSearchState({
        isSearching: true,
        targetKey: pendingFileSelection,
        loadedCount: items.length,
        cancelled: false,
      });

      // Load more items to continue searching
      loadObjects(false);
    } else if (!hasMore) {
      // No more items to load, file not found
      setFileSearchState({ isSearching: false, targetKey: '', loadedCount: 0, cancelled: false });
      onPendingFileSelectionHandled?.();
    }
  }, [
    pendingFileSelection,
    items,
    loading,
    loadingMore,
    hasMore,
    fileSearchState.cancelled,
    onSelectFile,
    onPendingFileSelectionHandled,
    loadObjects,
    scrollToFile,
  ]);

  // Compute filtered and sorted items
  const displayedItems = useMemo(() => {
    let result = items;
    result = filterByType(result, filterType);
    result = filterBySearch(result, searchQuery, currentPrefix);
    result = sortItems(result, sortConfig);
    return result;
  }, [items, filterType, searchQuery, currentPrefix, sortConfig]);

  // Reset filters when navigating to new location
  useEffect(() => {
    setSearchQuery('');
  }, [selectedBucket, currentPrefix]);

  const handleScroll = useCallback(() => {
    if (!listContainerRef.current || loadingMore || !hasMore) return;

    const { scrollTop, scrollHeight, clientHeight } = listContainerRef.current;
    // Load more when within 100px of bottom
    if (scrollHeight - scrollTop - clientHeight < 100) {
      loadObjects(false);
    }
  }, [loadingMore, hasMore, loadObjects]);

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

  const handleItemClick = (item: S3Object) => {
    if (item.isPrefix) {
      // Navigate into folder
      onNavigate(item.key);
      onSelectFile(null);
    } else {
      // Select file
      onSelectFile(item);
    }
  };

  const handleItemDoubleClick = (item: S3Object) => {
    if (item.isPrefix) {
      onNavigate(item.key);
    }
    // Double-click on file could open preview/editor (future feature)
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
    const handleRefresh = () => loadObjects(true);
    window.addEventListener('s3-refresh-files', handleRefresh);
    return () => window.removeEventListener('s3-refresh-files', handleRefresh);
  }, [loadObjects]);

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
          <button className="retry-btn" onClick={() => loadObjects(true)}>
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
      {/* File search progress overlay */}
      {fileSearchState.isSearching && (
        <div className="file-search-overlay">
          <div className="file-search-progress">
            <span className="loading-spinner"></span>
            <div className="file-search-info">
              <span className="file-search-title">Searching for file...</span>
              <span className="file-search-detail">
                Loaded {fileSearchState.loadedCount} items
              </span>
              <span className="file-search-target" title={fileSearchState.targetKey}>
                {fileSearchState.targetKey.split('/').pop()}
              </span>
            </div>
            <button
              className="file-search-cancel"
              onClick={cancelFileSearch}
              title="Cancel search"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
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
              {displayedItems.map((item) => {
                const name = getFileName(item.key, currentPrefix);
                const isSelected = selectedFile?.key === item.key;
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
                    className={`file-row ${item.isPrefix ? 'folder' : 'file'} ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleItemClick(item)}
                    onDoubleClick={() => handleItemDoubleClick(item)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (item.isPrefix) {
                          onNavigate(item.key);
                        } else {
                          onSelectFile(item);
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
