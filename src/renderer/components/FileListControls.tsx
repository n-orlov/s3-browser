import React, { useState, useCallback, useMemo } from 'react';
import { S3Object } from './FileList';

export type SortField = 'name' | 'size' | 'lastModified';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export interface FileTypeFilter {
  value: string;
  label: string;
  extensions: string[];
}

export const FILE_TYPE_FILTERS: FileTypeFilter[] = [
  { value: 'all', label: 'All Files', extensions: [] },
  { value: 'documents', label: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'] },
  { value: 'data', label: 'Data Files', extensions: ['json', 'yaml', 'yml', 'xml', 'csv', 'tsv', 'parquet', 'avro'] },
  { value: 'images', label: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'] },
  { value: 'code', label: 'Code', extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php'] },
  { value: 'archives', label: 'Archives', extensions: ['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2'] },
];

export interface FileListControlsProps {
  sortConfig: SortConfig;
  onSortChange: (config: SortConfig) => void;
  filterType: string;
  onFilterTypeChange: (type: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  totalCount: number;
  filteredCount: number;
  disabled?: boolean;
}

function FileListControls({
  sortConfig,
  onSortChange,
  filterType,
  onFilterTypeChange,
  searchQuery,
  onSearchChange,
  totalCount,
  filteredCount,
  disabled = false,
}: FileListControlsProps): React.ReactElement {
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onSearchChange(e.target.value);
    },
    [onSearchChange]
  );

  const handleClearSearch = useCallback(() => {
    onSearchChange('');
  }, [onSearchChange]);

  const handleFilterChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onFilterTypeChange(e.target.value);
    },
    [onFilterTypeChange]
  );

  const showingText = useMemo(() => {
    if (totalCount === 0) return '';
    if (filteredCount === totalCount) return `${totalCount} items`;
    return `${filteredCount} of ${totalCount} items`;
  }, [totalCount, filteredCount]);

  return (
    <div className="file-list-controls">
      <div className="file-list-controls-row">
        <div className="file-list-search-wrapper">
          <span className="file-list-search-icon">Q</span>
          <input
            type="text"
            className="file-list-search-input"
            placeholder="Quick filter..."
            value={searchQuery}
            onChange={handleSearchChange}
            disabled={disabled}
            aria-label="Quick filter"
          />
          {searchQuery && (
            <button
              className="file-list-search-clear"
              onClick={handleClearSearch}
              disabled={disabled}
              title="Clear filter"
              aria-label="Clear filter"
            >
              x
            </button>
          )}
        </div>
        <select
          className="file-list-type-filter"
          value={filterType}
          onChange={handleFilterChange}
          disabled={disabled}
          aria-label="Filter by type"
        >
          {FILE_TYPE_FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </select>
        {showingText && (
          <span className="file-list-showing-count">{showingText}</span>
        )}
      </div>
    </div>
  );
}

// Helper functions for sorting and filtering

export function sortItems(items: S3Object[], config: SortConfig): S3Object[] {
  return [...items].sort((a, b) => {
    // Folders always come first
    if (a.isPrefix !== b.isPrefix) {
      return a.isPrefix ? -1 : 1;
    }

    let comparison = 0;

    switch (config.field) {
      case 'name': {
        const nameA = a.key.toLowerCase();
        const nameB = b.key.toLowerCase();
        comparison = nameA.localeCompare(nameB);
        break;
      }
      case 'size':
        comparison = a.size - b.size;
        break;
      case 'lastModified': {
        const dateA = a.lastModified ? new Date(a.lastModified).getTime() : 0;
        const dateB = b.lastModified ? new Date(b.lastModified).getTime() : 0;
        comparison = dateA - dateB;
        break;
      }
    }

    return config.direction === 'asc' ? comparison : -comparison;
  });
}

export function filterByType(items: S3Object[], typeFilter: string): S3Object[] {
  if (typeFilter === 'all') return items;

  const filterConfig = FILE_TYPE_FILTERS.find((f) => f.value === typeFilter);
  if (!filterConfig || filterConfig.extensions.length === 0) return items;

  return items.filter((item) => {
    // Always show folders
    if (item.isPrefix) return true;

    const ext = item.key.split('.').pop()?.toLowerCase() ?? '';
    return filterConfig.extensions.includes(ext);
  });
}

export function filterBySearch(items: S3Object[], query: string, currentPrefix: string): S3Object[] {
  if (!query.trim()) return items;

  const lowerQuery = query.toLowerCase().trim();

  return items.filter((item) => {
    // Get just the filename (without the prefix)
    const name = item.key.startsWith(currentPrefix)
      ? item.key.slice(currentPrefix.length)
      : item.key;
    const displayName = name.endsWith('/') ? name.slice(0, -1) : name;
    return displayName.toLowerCase().includes(lowerQuery);
  });
}

export default FileListControls;
