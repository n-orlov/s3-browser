import React, { useState, useCallback, useEffect, useMemo } from 'react';

export interface JsonViewerProps {
  bucket: string;
  fileKey: string;
  fileName: string;
  fileSize: number;
  onClose: () => void;
}

/**
 * Maximum file size for JSON preview (10MB)
 */
const MAX_JSON_SIZE = 10 * 1024 * 1024;

/**
 * View modes for the JSON viewer
 */
type ViewMode = 'tree' | 'text';

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Props for a single JSON tree node
 */
interface JsonTreeNodeProps {
  name: string;
  value: unknown;
  level: number;
  isLast: boolean;
  defaultExpanded?: boolean;
  searchTerm?: string;
}

/**
 * Check if a node or its children match the search term
 */
function nodeMatchesSearch(value: unknown, searchTerm: string): boolean {
  if (!searchTerm) return false;
  const term = searchTerm.toLowerCase();

  if (value === null) return 'null'.includes(term);
  if (typeof value === 'boolean') return String(value).includes(term);
  if (typeof value === 'number') return String(value).includes(term);
  if (typeof value === 'string') return value.toLowerCase().includes(term);

  if (Array.isArray(value)) {
    return value.some(item => nodeMatchesSearch(item, searchTerm));
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) => k.toLowerCase().includes(term) || nodeMatchesSearch(v, searchTerm)
    );
  }

  return false;
}

/**
 * Render a single value (primitive) with appropriate styling
 */
function JsonValue({ value, searchTerm }: { value: unknown; searchTerm?: string }): React.ReactElement {
  const renderValue = () => {
    if (value === null) {
      return <span className="json-value json-null">null</span>;
    }
    if (typeof value === 'boolean') {
      return <span className="json-value json-boolean">{String(value)}</span>;
    }
    if (typeof value === 'number') {
      return <span className="json-value json-number">{value}</span>;
    }
    if (typeof value === 'string') {
      // Check if it matches search
      const isMatch = searchTerm && value.toLowerCase().includes(searchTerm.toLowerCase());
      return (
        <span className={`json-value json-string ${isMatch ? 'json-match' : ''}`}>
          &quot;{value}&quot;
        </span>
      );
    }
    return <span className="json-value">{String(value)}</span>;
  };

  return renderValue();
}

/**
 * A collapsible tree node for JSON objects/arrays
 */
function JsonTreeNode({
  name,
  value,
  level,
  isLast,
  defaultExpanded = false,
  searchTerm = '',
}: JsonTreeNodeProps): React.ReactElement {
  // Auto-expand if matches search
  const matchesSearch = searchTerm && nodeMatchesSearch(value, searchTerm);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded || matchesSearch);

  // Update expansion when search changes
  useEffect(() => {
    if (searchTerm && nodeMatchesSearch(value, searchTerm)) {
      setIsExpanded(true);
    }
  }, [searchTerm, value]);

  const isNameMatch = searchTerm && name.toLowerCase().includes(searchTerm.toLowerCase());
  const indent = level * 16;

  // Primitive values
  if (value === null || typeof value !== 'object') {
    return (
      <div className="json-tree-line" style={{ paddingLeft: `${indent}px` }}>
        <span className={`json-key ${isNameMatch ? 'json-match' : ''}`}>{name}</span>
        <span className="json-colon">: </span>
        <JsonValue value={value} searchTerm={searchTerm} />
        {!isLast && <span className="json-comma">,</span>}
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? value.map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(value as Record<string, unknown>);
  const bracketOpen = isArray ? '[' : '{';
  const bracketClose = isArray ? ']' : '}';
  const isEmpty = entries.length === 0;

  // Empty object/array
  if (isEmpty) {
    return (
      <div className="json-tree-line" style={{ paddingLeft: `${indent}px` }}>
        <span className={`json-key ${isNameMatch ? 'json-match' : ''}`}>{name}</span>
        <span className="json-colon">: </span>
        <span className="json-bracket">{bracketOpen}{bracketClose}</span>
        {!isLast && <span className="json-comma">,</span>}
      </div>
    );
  }

  // Collapsible object/array
  return (
    <div className="json-tree-node">
      <div
        className="json-tree-line json-tree-collapsible"
        style={{ paddingLeft: `${indent}px` }}
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            setIsExpanded(!isExpanded);
          }
        }}
      >
        <span className={`json-tree-toggle ${isExpanded ? 'expanded' : ''}`}>
          {isExpanded ? '▼' : '▶'}
        </span>
        <span className={`json-key ${isNameMatch ? 'json-match' : ''}`}>{name}</span>
        <span className="json-colon">: </span>
        <span className="json-bracket">{bracketOpen}</span>
        {!isExpanded && (
          <>
            <span className="json-collapsed-hint">
              {isArray ? `${entries.length} items` : `${entries.length} keys`}
            </span>
            <span className="json-bracket">{bracketClose}</span>
            {!isLast && <span className="json-comma">,</span>}
          </>
        )}
      </div>
      {isExpanded && (
        <>
          {entries.map(([key, val], idx) => (
            <JsonTreeNode
              key={key}
              name={isArray ? `[${key}]` : key}
              value={val}
              level={level + 1}
              isLast={idx === entries.length - 1}
              defaultExpanded={level < 1}
              searchTerm={searchTerm}
            />
          ))}
          <div className="json-tree-line" style={{ paddingLeft: `${indent}px` }}>
            <span className="json-bracket">{bracketClose}</span>
            {!isLast && <span className="json-comma">,</span>}
          </div>
        </>
      )}
    </div>
  );
}

function JsonViewer({
  bucket,
  fileKey,
  fileName,
  fileSize,
  onClose,
}: JsonViewerProps): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [parsedJson, setParsedJson] = useState<unknown>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [searchTerm, setSearchTerm] = useState('');

  // Load JSON file on mount
  useEffect(() => {
    let mounted = true;

    const loadJson = async () => {
      setLoading(true);
      setError(null);

      try {
        // Check file size first
        if (fileSize > MAX_JSON_SIZE) {
          throw new Error(
            `File is too large to preview (${formatSize(fileSize)}). Maximum size is ${formatSize(MAX_JSON_SIZE)}.`
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

        setContent(result.content);

        // Try to parse JSON
        try {
          const parsed = JSON.parse(result.content);
          setParsedJson(parsed);
        } catch (parseErr) {
          throw new Error('Invalid JSON: ' + (parseErr instanceof Error ? parseErr.message : 'Parse error'));
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load JSON file');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadJson();

    return () => {
      mounted = false;
    };
  }, [bucket, fileKey, fileSize]);

  // Pretty-printed JSON for text view
  const prettyJson = useMemo(() => {
    if (parsedJson === null && content) {
      // If parsing failed but we have content, show raw content
      return content;
    }
    try {
      return JSON.stringify(parsedJson, null, 2);
    } catch {
      return content;
    }
  }, [parsedJson, content]);

  // Count of nodes for stats
  const nodeStats = useMemo(() => {
    if (parsedJson === null) return { keys: 0, depth: 0 };

    let maxDepth = 0;
    let keyCount = 0;

    const traverse = (obj: unknown, depth: number) => {
      maxDepth = Math.max(maxDepth, depth);
      if (obj === null || typeof obj !== 'object') return;

      if (Array.isArray(obj)) {
        keyCount += obj.length;
        obj.forEach(item => traverse(item, depth + 1));
      } else {
        const entries = Object.entries(obj as Record<string, unknown>);
        keyCount += entries.length;
        entries.forEach(([, v]) => traverse(v, depth + 1));
      }
    };

    traverse(parsedJson, 0);
    return { keys: keyCount, depth: maxDepth };
  }, [parsedJson]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  // Highlight search matches in text view
  const highlightedText = useMemo(() => {
    if (!searchTerm || viewMode !== 'text') return prettyJson;

    const parts = prettyJson.split(new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts;
  }, [prettyJson, searchTerm, viewMode]);

  return (
    <div className="json-viewer-overlay" onKeyDown={handleKeyDown}>
      <div className="json-viewer">
        {/* Header */}
        <div className="json-viewer-header">
          <div className="json-viewer-title">
            <span className="json-viewer-icon">&#123;&#125;</span>
            <span className="json-viewer-filename" title={fileKey}>
              {fileName}
            </span>
          </div>
          <div className="json-viewer-meta">
            {parsedJson !== null && (
              <>
                <span className="json-viewer-meta-item">
                  {nodeStats.keys} keys
                </span>
                <span className="json-viewer-meta-item">
                  {nodeStats.depth} depth
                </span>
              </>
            )}
            <span className="json-viewer-meta-item">{formatSize(fileSize)}</span>
          </div>
          <div className="json-viewer-view-toggle">
            <button
              className={`json-viewer-toggle-btn ${viewMode === 'tree' ? 'active' : ''}`}
              onClick={() => setViewMode('tree')}
              title="Tree view"
            >
              Tree
            </button>
            <button
              className={`json-viewer-toggle-btn ${viewMode === 'text' ? 'active' : ''}`}
              onClick={() => setViewMode('text')}
              title="Text view"
            >
              Text
            </button>
          </div>
          <div className="json-viewer-actions">
            <button
              className="json-viewer-btn json-viewer-btn-close"
              onClick={onClose}
              title="Close (Escape)"
            >
              Close
            </button>
          </div>
        </div>

        {/* Search bar */}
        {parsedJson !== null && (
          <div className="json-viewer-search">
            <input
              type="text"
              className="json-viewer-search-input"
              placeholder="Search in JSON..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                className="json-viewer-search-clear"
                onClick={() => setSearchTerm('')}
                title="Clear search"
              >
                &times;
              </button>
            )}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="json-viewer-error">
            <span className="error-icon">!</span>
            <span>{error}</span>
            <button
              className="json-viewer-error-dismiss"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Content */}
        <div className="json-viewer-content">
          {loading ? (
            <div className="json-viewer-loading">
              <span className="loading-spinner"></span>
              <span>Loading JSON file...</span>
            </div>
          ) : parsedJson !== null ? (
            viewMode === 'tree' ? (
              <div className="json-viewer-tree">
                <JsonTreeNode
                  name="root"
                  value={parsedJson}
                  level={0}
                  isLast={true}
                  defaultExpanded={true}
                  searchTerm={searchTerm}
                />
              </div>
            ) : (
              <div className="json-viewer-text">
                <pre className="json-viewer-pre">
                  {Array.isArray(highlightedText) ? (
                    highlightedText.map((part, i) =>
                      part.toLowerCase() === searchTerm.toLowerCase() ? (
                        <mark key={i} className="json-text-match">{part}</mark>
                      ) : (
                        <span key={i}>{part}</span>
                      )
                    )
                  ) : (
                    highlightedText
                  )}
                </pre>
              </div>
            )
          ) : null}
        </div>

        {/* Footer status */}
        <div className="json-viewer-footer">
          <span className="json-viewer-path" title={`s3://${bucket}/${fileKey}`}>
            s3://{bucket}/{fileKey}
          </span>
          <span className="json-viewer-status">
            {parsedJson !== null
              ? `${viewMode === 'tree' ? 'Tree view' : 'Text view'} - ${nodeStats.keys} keys, depth ${nodeStats.depth}`
              : 'Loading...'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default JsonViewer;
