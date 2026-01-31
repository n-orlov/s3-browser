import React, { useState, useCallback, useEffect, useMemo } from 'react';

export interface YamlViewerProps {
  bucket: string;
  fileKey: string;
  fileName: string;
  fileSize: number;
  onClose: () => void;
}

/**
 * Maximum file size for YAML preview (10MB)
 */
const MAX_YAML_SIZE = 10 * 1024 * 1024;

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
 * Token types for YAML syntax highlighting
 */
type TokenType = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'comment' | 'anchor' | 'alias' | 'tag' | 'literal' | 'default';

interface Token {
  type: TokenType;
  value: string;
}

/**
 * Tokenize a single line of YAML for syntax highlighting
 */
function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let remaining = line;
  let pos = 0;

  // Check for comment line (possibly after whitespace)
  const commentMatch = line.match(/^(\s*)(#.*)$/);
  if (commentMatch) {
    if (commentMatch[1]) {
      tokens.push({ type: 'default', value: commentMatch[1] });
    }
    tokens.push({ type: 'comment', value: commentMatch[2] });
    return tokens;
  }

  // Key-value patterns
  const keyValueMatch = line.match(/^(\s*)([\w.-]+)(\s*:\s*)(.*)$/);
  if (keyValueMatch) {
    const [, indent, key, colon, value] = keyValueMatch;
    if (indent) {
      tokens.push({ type: 'default', value: indent });
    }
    tokens.push({ type: 'key', value: key });
    tokens.push({ type: 'default', value: colon });

    if (value) {
      tokens.push(...tokenizeValue(value));
    }
    return tokens;
  }

  // List item patterns
  const listMatch = line.match(/^(\s*)(-)(\s*)(.*)$/);
  if (listMatch) {
    const [, indent, dash, space, value] = listMatch;
    if (indent) {
      tokens.push({ type: 'default', value: indent });
    }
    tokens.push({ type: 'default', value: dash });
    if (space) {
      tokens.push({ type: 'default', value: space });
    }
    if (value) {
      // Check if it's a key-value on the same line (- key: value)
      const kvMatch = value.match(/^([\w.-]+)(\s*:\s*)(.*)$/);
      if (kvMatch) {
        const [, k, c, v] = kvMatch;
        tokens.push({ type: 'key', value: k });
        tokens.push({ type: 'default', value: c });
        if (v) {
          tokens.push(...tokenizeValue(v));
        }
      } else {
        tokens.push(...tokenizeValue(value));
      }
    }
    return tokens;
  }

  // Block literal indicators (| or >)
  const literalMatch = line.match(/^(\s*)([|>][+-]?\d*)\s*$/);
  if (literalMatch) {
    const [, indent, indicator] = literalMatch;
    if (indent) {
      tokens.push({ type: 'default', value: indent });
    }
    tokens.push({ type: 'literal', value: indicator });
    return tokens;
  }

  // Default: treat as plain value or continuation
  tokens.push(...tokenizeValue(line));
  return tokens;
}

/**
 * Tokenize a value portion of YAML
 */
function tokenizeValue(value: string): Token[] {
  const tokens: Token[] = [];
  const trimmed = value.trim();

  if (!value) {
    return tokens;
  }

  // Preserve leading whitespace
  const leadingSpace = value.match(/^(\s*)/)?.[1] || '';
  if (leadingSpace) {
    tokens.push({ type: 'default', value: leadingSpace });
  }

  // Handle inline comment
  const commentIdx = findCommentStart(trimmed);
  const valueWithoutComment = commentIdx >= 0 ? trimmed.substring(0, commentIdx).trim() : trimmed;
  const comment = commentIdx >= 0 ? trimmed.substring(commentIdx) : '';

  if (valueWithoutComment) {
    // Anchor
    if (valueWithoutComment.startsWith('&')) {
      const anchorMatch = valueWithoutComment.match(/^(&[\w-]+)(.*)$/);
      if (anchorMatch) {
        tokens.push({ type: 'anchor', value: anchorMatch[1] });
        if (anchorMatch[2]) {
          tokens.push(...tokenizeValue(anchorMatch[2]));
        }
        if (comment) {
          tokens.push({ type: 'default', value: ' ' });
          tokens.push({ type: 'comment', value: comment });
        }
        return tokens;
      }
    }

    // Alias
    if (valueWithoutComment.startsWith('*')) {
      const aliasMatch = valueWithoutComment.match(/^(\*[\w-]+)(.*)$/);
      if (aliasMatch) {
        tokens.push({ type: 'alias', value: aliasMatch[1] });
        if (aliasMatch[2]) {
          tokens.push(...tokenizeValue(aliasMatch[2]));
        }
        if (comment) {
          tokens.push({ type: 'default', value: ' ' });
          tokens.push({ type: 'comment', value: comment });
        }
        return tokens;
      }
    }

    // Tag
    if (valueWithoutComment.startsWith('!')) {
      const tagMatch = valueWithoutComment.match(/^(![\w!/<>.-]*)\s*(.*)$/);
      if (tagMatch) {
        tokens.push({ type: 'tag', value: tagMatch[1] });
        if (tagMatch[2]) {
          tokens.push({ type: 'default', value: ' ' });
          tokens.push(...tokenizeValue(tagMatch[2]));
        }
        if (comment) {
          tokens.push({ type: 'default', value: ' ' });
          tokens.push({ type: 'comment', value: comment });
        }
        return tokens;
      }
    }

    // Block literal indicator (| or >) as a value
    if (/^[|>][+-]?\d*$/.test(valueWithoutComment)) {
      tokens.push({ type: 'literal', value: valueWithoutComment });
    }
    // Quoted string
    else if ((valueWithoutComment.startsWith('"') && valueWithoutComment.endsWith('"')) ||
        (valueWithoutComment.startsWith("'") && valueWithoutComment.endsWith("'"))) {
      tokens.push({ type: 'string', value: valueWithoutComment });
    }
    // Boolean
    else if (/^(true|false|yes|no|on|off)$/i.test(valueWithoutComment)) {
      tokens.push({ type: 'boolean', value: valueWithoutComment });
    }
    // Null
    else if (/^(null|~)$/i.test(valueWithoutComment)) {
      tokens.push({ type: 'null', value: valueWithoutComment });
    }
    // Number
    else if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(valueWithoutComment) ||
             /^0x[0-9a-fA-F]+$/.test(valueWithoutComment) ||
             /^0o[0-7]+$/.test(valueWithoutComment)) {
      tokens.push({ type: 'number', value: valueWithoutComment });
    }
    // Plain string or other
    else {
      tokens.push({ type: 'string', value: valueWithoutComment });
    }
  }

  // Add comment if present
  if (comment) {
    tokens.push({ type: 'default', value: ' ' });
    tokens.push({ type: 'comment', value: comment });
  }

  return tokens;
}

/**
 * Find the start of an inline comment (not inside quotes)
 */
function findCommentStart(text: string): number {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const prevChar = i > 0 ? text[i - 1] : '';

    if (char === '"' && !inSingleQuote && prevChar !== '\\') {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === "'" && !inDoubleQuote && prevChar !== '\\') {
      inSingleQuote = !inSingleQuote;
    } else if (char === '#' && !inSingleQuote && !inDoubleQuote) {
      // Make sure there's a space before # or it's at start
      if (i === 0 || /\s/.test(prevChar)) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * Get CSS class for token type
 */
function getTokenClass(type: TokenType): string {
  switch (type) {
    case 'key': return 'yaml-key';
    case 'string': return 'yaml-string';
    case 'number': return 'yaml-number';
    case 'boolean': return 'yaml-boolean';
    case 'null': return 'yaml-null';
    case 'comment': return 'yaml-comment';
    case 'anchor': return 'yaml-anchor';
    case 'alias': return 'yaml-alias';
    case 'tag': return 'yaml-tag';
    case 'literal': return 'yaml-literal';
    default: return '';
  }
}

function YamlViewer({
  bucket,
  fileKey,
  fileName,
  fileSize,
  onClose,
}: YamlViewerProps): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  // Load YAML file on mount
  useEffect(() => {
    let mounted = true;

    const loadYaml = async () => {
      setLoading(true);
      setError(null);

      try {
        // Check file size first
        if (fileSize > MAX_YAML_SIZE) {
          throw new Error(
            `File is too large to preview (${formatSize(fileSize)}). Maximum size is ${formatSize(MAX_YAML_SIZE)}.`
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
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load YAML file');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadYaml();

    return () => {
      mounted = false;
    };
  }, [bucket, fileKey, fileSize]);

  // Stats about the YAML content
  const yamlStats = useMemo(() => {
    if (!content) return { lines: 0, keys: 0 };

    const lines = content.split('\n');
    let keyCount = 0;

    for (const line of lines) {
      // Count lines that look like keys (word followed by colon)
      if (/^\s*[\w.-]+\s*:/.test(line)) {
        keyCount++;
      }
    }

    return { lines: lines.length, keys: keyCount };
  }, [content]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  // Render content with syntax highlighting and search highlighting
  const renderContent = useMemo(() => {
    if (!content) return null;

    const lines = content.split('\n');
    const searchLower = searchTerm.toLowerCase();

    return lines.map((line, lineIndex) => {
      const tokens = tokenizeLine(line);
      const lineMatches = searchTerm && line.toLowerCase().includes(searchLower);

      return (
        <div
          key={lineIndex}
          className={`yaml-line ${lineMatches ? 'yaml-line-match' : ''}`}
        >
          <span className="yaml-line-number">{lineIndex + 1}</span>
          <span className="yaml-line-content">
            {tokens.map((token, tokenIndex) => {
              const tokenClass = getTokenClass(token.type);

              // If searching and this token contains the search term, highlight it
              if (searchTerm && token.value.toLowerCase().includes(searchLower)) {
                const parts = token.value.split(new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
                return (
                  <span key={tokenIndex} className={tokenClass}>
                    {parts.map((part, partIndex) =>
                      part.toLowerCase() === searchLower ? (
                        <mark key={partIndex} className="yaml-search-match">{part}</mark>
                      ) : (
                        <span key={partIndex}>{part}</span>
                      )
                    )}
                  </span>
                );
              }

              return (
                <span key={tokenIndex} className={tokenClass}>
                  {token.value}
                </span>
              );
            })}
            {line === '' && '\u00A0'}
          </span>
        </div>
      );
    });
  }, [content, searchTerm]);

  // Count search matches
  const matchCount = useMemo(() => {
    if (!searchTerm || !content) return 0;
    const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return (content.match(regex) || []).length;
  }, [content, searchTerm]);

  return (
    <div className="yaml-viewer-overlay" onKeyDown={handleKeyDown}>
      <div className="yaml-viewer">
        {/* Header */}
        <div className="yaml-viewer-header">
          <div className="yaml-viewer-title">
            <span className="yaml-viewer-icon">YAML</span>
            <span className="yaml-viewer-filename" title={fileKey}>
              {fileName}
            </span>
          </div>
          <div className="yaml-viewer-meta">
            {content && (
              <>
                <span className="yaml-viewer-meta-item">
                  {yamlStats.lines} lines
                </span>
                <span className="yaml-viewer-meta-item">
                  {yamlStats.keys} keys
                </span>
              </>
            )}
            <span className="yaml-viewer-meta-item">{formatSize(fileSize)}</span>
          </div>
          <div className="yaml-viewer-actions">
            <button
              className="yaml-viewer-btn yaml-viewer-btn-close"
              onClick={onClose}
              title="Close (Escape)"
            >
              Close
            </button>
          </div>
        </div>

        {/* Search bar */}
        {content && (
          <div className="yaml-viewer-search">
            <input
              type="text"
              className="yaml-viewer-search-input"
              placeholder="Search in YAML..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <>
                <span className="yaml-viewer-search-count">
                  {matchCount} match{matchCount !== 1 ? 'es' : ''}
                </span>
                <button
                  className="yaml-viewer-search-clear"
                  onClick={() => setSearchTerm('')}
                  title="Clear search"
                >
                  &times;
                </button>
              </>
            )}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="yaml-viewer-error">
            <span className="error-icon">!</span>
            <span>{error}</span>
            <button
              className="yaml-viewer-error-dismiss"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Content */}
        <div className="yaml-viewer-content">
          {loading ? (
            <div className="yaml-viewer-loading">
              <span className="loading-spinner"></span>
              <span>Loading YAML file...</span>
            </div>
          ) : content ? (
            <div className="yaml-viewer-text">
              <pre className="yaml-viewer-pre">
                {renderContent}
              </pre>
            </div>
          ) : null}
        </div>

        {/* Footer status */}
        <div className="yaml-viewer-footer">
          <span className="yaml-viewer-path" title={`s3://${bucket}/${fileKey}`}>
            s3://{bucket}/{fileKey}
          </span>
          <span className="yaml-viewer-status">
            {content
              ? `${yamlStats.lines} lines, ${yamlStats.keys} keys`
              : 'Loading...'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default YamlViewer;
