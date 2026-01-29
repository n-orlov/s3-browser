import React, { useState, useCallback, useEffect, useRef } from 'react';
import { parquetMetadataAsync, parquetRead } from 'hyparquet';

export interface ParquetViewerProps {
  bucket: string;
  fileKey: string;
  fileName: string;
  fileSize: number;
  onClose: () => void;
}

interface ParquetColumn {
  name: string;
  type: string;
}

interface ParquetData {
  columns: ParquetColumn[];
  rows: unknown[][];
  totalRows: number;
}

/**
 * Maximum file size for parquet preview (100MB)
 */
const MAX_PARQUET_SIZE = 100 * 1024 * 1024;

/**
 * Initial rows to load
 */
const INITIAL_ROWS = 100;

/**
 * Rows to load per batch during lazy loading
 */
const ROWS_PER_BATCH = 100;

/**
 * Format a value for display in the table
 */
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Object]';
    }
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return String(value);
}

/**
 * Infer column type from values
 */
function inferColumnType(values: unknown[]): string {
  for (const val of values) {
    if (val === null || val === undefined) continue;
    if (typeof val === 'number') return 'number';
    if (typeof val === 'bigint') return 'bigint';
    if (typeof val === 'boolean') return 'boolean';
    if (val instanceof Date) return 'date';
    if (Array.isArray(val)) return 'array';
    if (typeof val === 'object') return 'object';
    return 'string';
  }
  return 'unknown';
}

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function ParquetViewer({
  bucket,
  fileKey,
  fileName,
  fileSize,
  onClose,
}: ParquetViewerProps): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ParquetData | null>(null);
  const [displayedRows, setDisplayedRows] = useState<unknown[][]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const allRowsRef = useRef<unknown[][]>([]);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Load parquet file on mount
  useEffect(() => {
    let mounted = true;

    const loadParquet = async () => {
      setLoading(true);
      setError(null);

      try {
        // Check file size first
        if (fileSize > MAX_PARQUET_SIZE) {
          throw new Error(
            `File is too large to preview (${formatSize(fileSize)}). Maximum size is ${formatSize(MAX_PARQUET_SIZE)}.`
          );
        }

        // Download the file as binary
        const result = await window.electronAPI.s3.downloadBinaryContent(bucket, fileKey);
        if (!result.success) {
          throw new Error(result.error || 'Failed to download file');
        }

        if (!result.data) {
          throw new Error('Empty file content');
        }

        // Create an AsyncBuffer-compatible object for hyparquet
        const arrayBuffer = result.data.buffer.slice(
          result.data.byteOffset,
          result.data.byteOffset + result.data.byteLength
        );

        // Get metadata first to understand schema
        const metadata = await parquetMetadataAsync({
          byteLength: arrayBuffer.byteLength,
          slice: (start: number, end?: number) => {
            const slice = new Uint8Array(arrayBuffer, start, end ? end - start : undefined);
            return Promise.resolve(slice);
          },
        });

        // Extract column names from schema
        const columnNames: string[] = [];
        if (metadata.schema && metadata.schema.length > 1) {
          // First element is root, rest are columns
          for (let i = 1; i < metadata.schema.length; i++) {
            const col = metadata.schema[i];
            if (col.name) {
              columnNames.push(col.name);
            }
          }
        }

        // Read all data from parquet file
        const rows: unknown[][] = [];
        await parquetRead({
          file: arrayBuffer,
          onComplete: (readData: Record<string, unknown[]>) => {
            // Convert column-oriented data to row-oriented
            const numRows = Object.values(readData)[0]?.length || 0;
            for (let i = 0; i < numRows; i++) {
              const row: unknown[] = [];
              for (const colName of columnNames) {
                row.push(readData[colName]?.[i]);
              }
              rows.push(row);
            }
          },
        });

        if (!mounted) return;

        // Build columns with inferred types
        const columns: ParquetColumn[] = columnNames.map((name, idx) => ({
          name,
          type: inferColumnType(rows.slice(0, 100).map(r => r[idx])),
        }));

        allRowsRef.current = rows;
        setData({
          columns,
          rows,
          totalRows: rows.length,
        });
        setDisplayedRows(rows.slice(0, INITIAL_ROWS));
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load parquet file');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadParquet();

    return () => {
      mounted = false;
    };
  }, [bucket, fileKey, fileSize]);

  // Handle scroll for lazy loading
  const handleScroll = useCallback(() => {
    if (!tableContainerRef.current || loadingMore || !data) return;

    const { scrollTop, scrollHeight, clientHeight } = tableContainerRef.current;

    // Load more when within 200px of bottom
    if (scrollHeight - scrollTop - clientHeight < 200) {
      if (displayedRows.length < allRowsRef.current.length) {
        setLoadingMore(true);
        // Use setTimeout to simulate async loading and prevent UI freeze
        setTimeout(() => {
          const nextBatch = allRowsRef.current.slice(
            displayedRows.length,
            displayedRows.length + ROWS_PER_BATCH
          );
          setDisplayedRows(prev => [...prev, ...nextBatch]);
          setLoadingMore(false);
        }, 0);
      }
    }
  }, [loadingMore, data, displayedRows.length]);

  // Filter rows based on search term
  const filteredRows = searchTerm
    ? displayedRows.filter(row =>
        row.some(cell => {
          const cellStr = formatCellValue(cell).toLowerCase();
          return cellStr.includes(searchTerm.toLowerCase());
        })
      )
    : displayedRows;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <div className="parquet-viewer-overlay" onKeyDown={handleKeyDown}>
      <div className="parquet-viewer">
        {/* Header */}
        <div className="parquet-viewer-header">
          <div className="parquet-viewer-title">
            <span className="parquet-viewer-icon">&#128202;</span>
            <span className="parquet-viewer-filename" title={fileKey}>
              {fileName}
            </span>
          </div>
          <div className="parquet-viewer-meta">
            {data && (
              <>
                <span className="parquet-viewer-meta-item">
                  {data.totalRows.toLocaleString()} rows
                </span>
                <span className="parquet-viewer-meta-item">
                  {data.columns.length} columns
                </span>
              </>
            )}
            <span className="parquet-viewer-meta-item">{formatSize(fileSize)}</span>
          </div>
          <div className="parquet-viewer-actions">
            <button
              className="parquet-viewer-btn parquet-viewer-btn-close"
              onClick={onClose}
              title="Close (Escape)"
            >
              Close
            </button>
          </div>
        </div>

        {/* Search bar */}
        {data && (
          <div className="parquet-viewer-search">
            <input
              type="text"
              className="parquet-viewer-search-input"
              placeholder="Search in data..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <span className="parquet-viewer-search-count">
                {filteredRows.length} matches
              </span>
            )}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="parquet-viewer-error">
            <span className="error-icon">!</span>
            <span>{error}</span>
            <button
              className="parquet-viewer-error-dismiss"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Table content */}
        <div className="parquet-viewer-content">
          {loading ? (
            <div className="parquet-viewer-loading">
              <span className="loading-spinner"></span>
              <span>Loading parquet file...</span>
            </div>
          ) : data ? (
            <div
              className="parquet-viewer-table-wrapper"
              ref={tableContainerRef}
              onScroll={handleScroll}
            >
              <table className="parquet-viewer-table">
                <thead>
                  <tr>
                    <th className="parquet-col-index">#</th>
                    {data.columns.map((col, idx) => (
                      <th key={idx} title={`${col.name} (${col.type})`}>
                        <div className="parquet-col-header">
                          <span className="parquet-col-name">{col.name}</span>
                          <span className="parquet-col-type">{col.type}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      <td className="parquet-col-index">{rowIdx + 1}</td>
                      {row.map((cell, cellIdx) => (
                        <td key={cellIdx} title={formatCellValue(cell)}>
                          {formatCellValue(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {loadingMore && (
                <div className="parquet-viewer-loading-more">
                  <span className="loading-spinner small"></span>
                  <span>Loading more rows...</span>
                </div>
              )}
              {displayedRows.length < data.totalRows && !loadingMore && (
                <div className="parquet-viewer-has-more">
                  Showing {displayedRows.length.toLocaleString()} of {data.totalRows.toLocaleString()} rows
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer status */}
        <div className="parquet-viewer-footer">
          <span className="parquet-viewer-path" title={`s3://${bucket}/${fileKey}`}>
            s3://{bucket}/{fileKey}
          </span>
          <span className="parquet-viewer-status">
            {data
              ? `Loaded ${displayedRows.length.toLocaleString()} of ${data.totalRows.toLocaleString()} rows`
              : 'Loading...'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default ParquetViewer;
