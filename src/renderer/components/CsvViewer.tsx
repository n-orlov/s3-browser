import React, { useState, useCallback, useEffect, useRef } from 'react';

export interface CsvViewerProps {
  bucket: string;
  fileKey: string;
  fileName: string;
  fileSize: number;
  onClose: () => void;
}

interface CsvData {
  headers: string[];
  rows: string[][];
  totalRows: number;
}

/**
 * Maximum file size for CSV preview (50MB)
 */
const MAX_CSV_SIZE = 50 * 1024 * 1024;

/**
 * Initial rows to load
 */
const INITIAL_ROWS = 100;

/**
 * Rows to load per batch during lazy loading
 */
const ROWS_PER_BATCH = 100;

/**
 * Parse CSV content, handling quoted fields with commas and newlines
 */
function parseCsv(content: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          currentField += '"';
          i++;
        } else {
          // End of quoted field
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\r') {
        // Skip carriage return
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField);
        if (currentRow.length > 0 && currentRow.some(field => field.trim() !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  // Handle last field/row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some(field => field.trim() !== '')) {
      rows.push(currentRow);
    }
  }

  // First row is headers
  const headers = rows.length > 0 ? rows[0] : [];
  const dataRows = rows.slice(1);

  return { headers, rows: dataRows };
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

function CsvViewer({
  bucket,
  fileKey,
  fileName,
  fileSize,
  onClose,
}: CsvViewerProps): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CsvData | null>(null);
  const [displayedRows, setDisplayedRows] = useState<string[][]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const allRowsRef = useRef<string[][]>([]);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Load CSV file on mount
  useEffect(() => {
    let mounted = true;

    const loadCsv = async () => {
      setLoading(true);
      setError(null);

      try {
        // Check file size first
        if (fileSize > MAX_CSV_SIZE) {
          throw new Error(
            `File is too large to preview (${formatSize(fileSize)}). Maximum size is ${formatSize(MAX_CSV_SIZE)}.`
          );
        }

        // Download the file as text
        const result = await window.electronAPI.s3.downloadContent(bucket, fileKey);
        if (!result.success) {
          throw new Error(result.error || 'Failed to download file');
        }

        if (!result.content) {
          throw new Error('Empty file content');
        }

        if (!mounted) return;

        // Parse CSV
        const { headers, rows } = parseCsv(result.content);

        allRowsRef.current = rows;
        setData({
          headers,
          rows,
          totalRows: rows.length,
        });
        setDisplayedRows(rows.slice(0, INITIAL_ROWS));
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load CSV file');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadCsv();

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
          const cellStr = cell.toLowerCase();
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
    <div className="csv-viewer-overlay" onKeyDown={handleKeyDown}>
      <div className="csv-viewer">
        {/* Header */}
        <div className="csv-viewer-header">
          <div className="csv-viewer-title">
            <span className="csv-viewer-icon">&#128196;</span>
            <span className="csv-viewer-filename" title={fileKey}>
              {fileName}
            </span>
          </div>
          <div className="csv-viewer-meta">
            {data && (
              <>
                <span className="csv-viewer-meta-item">
                  {data.totalRows.toLocaleString()} rows
                </span>
                <span className="csv-viewer-meta-item">
                  {data.headers.length} columns
                </span>
              </>
            )}
            <span className="csv-viewer-meta-item">{formatSize(fileSize)}</span>
          </div>
          <div className="csv-viewer-actions">
            <button
              className="csv-viewer-btn csv-viewer-btn-close"
              onClick={onClose}
              title="Close (Escape)"
            >
              Close
            </button>
          </div>
        </div>

        {/* Search bar */}
        {data && (
          <div className="csv-viewer-search">
            <input
              type="text"
              className="csv-viewer-search-input"
              placeholder="Search in data..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <span className="csv-viewer-search-count">
                {filteredRows.length} matches
              </span>
            )}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="csv-viewer-error">
            <span className="error-icon">!</span>
            <span>{error}</span>
            <button
              className="csv-viewer-error-dismiss"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Table content */}
        <div className="csv-viewer-content">
          {loading ? (
            <div className="csv-viewer-loading">
              <span className="loading-spinner"></span>
              <span>Loading CSV file...</span>
            </div>
          ) : data ? (
            <div
              className="csv-viewer-table-wrapper"
              ref={tableContainerRef}
              onScroll={handleScroll}
            >
              <table className="csv-viewer-table">
                <thead>
                  <tr>
                    <th className="csv-col-index">#</th>
                    {data.headers.map((header, idx) => (
                      <th key={idx} title={header}>
                        <div className="csv-col-header">
                          <span className="csv-col-name">{header}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      <td className="csv-col-index">{rowIdx + 1}</td>
                      {row.map((cell, cellIdx) => (
                        <td key={cellIdx} title={cell}>
                          {cell}
                        </td>
                      ))}
                      {/* Pad with empty cells if row has fewer columns than headers */}
                      {row.length < data.headers.length &&
                        Array.from({ length: data.headers.length - row.length }).map((_, i) => (
                          <td key={`empty-${i}`}></td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {loadingMore && (
                <div className="csv-viewer-loading-more">
                  <span className="loading-spinner small"></span>
                  <span>Loading more rows...</span>
                </div>
              )}
              {displayedRows.length < data.totalRows && !loadingMore && (
                <div className="csv-viewer-has-more">
                  Showing {displayedRows.length.toLocaleString()} of {data.totalRows.toLocaleString()} rows
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer status */}
        <div className="csv-viewer-footer">
          <span className="csv-viewer-path" title={`s3://${bucket}/${fileKey}`}>
            s3://{bucket}/{fileKey}
          </span>
          <span className="csv-viewer-status">
            {data
              ? `Loaded ${displayedRows.length.toLocaleString()} of ${data.totalRows.toLocaleString()} rows`
              : 'Loading...'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default CsvViewer;
