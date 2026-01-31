import React, { useState, useCallback, useRef, useEffect } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

export interface TextEditorProps {
  bucket: string;
  fileKey: string;
  fileName: string;
  onClose: () => void;
  onSaved?: () => void;
}

/**
 * Get the base extension of a file, looking past .gz if present
 * e.g., 'data.json.gz' -> 'json', 'data.csv' -> 'csv'
 */
function getBaseExtension(key: string): string {
  const lowerKey = key.toLowerCase();

  // If it ends with .gz, get the extension before .gz
  if (lowerKey.endsWith('.gz')) {
    const withoutGz = key.slice(0, -3);
    return withoutGz.split('.').pop()?.toLowerCase() ?? '';
  }

  // Otherwise just get the last extension
  return key.split('.').pop()?.toLowerCase() ?? '';
}

/**
 * Determine Monaco language from file extension
 * Handles .gz files by looking at the extension before .gz
 */
function getLanguageFromKey(key: string): string {
  const ext = getBaseExtension(key);
  const languageMap: Record<string, string> = {
    // JSON
    json: 'json',
    // YAML
    yaml: 'yaml',
    yml: 'yaml',
    // Plain text
    txt: 'plaintext',
    log: 'plaintext',
    // CSV - use plaintext (no native CSV highlighting)
    csv: 'plaintext',
    // Code files
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'cpp',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    ps1: 'powershell',
    sql: 'sql',
    // Markup/Config
    md: 'markdown',
    markdown: 'markdown',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    xml: 'xml',
    svg: 'xml',
    toml: 'ini',
    ini: 'ini',
    conf: 'ini',
    cfg: 'ini',
    properties: 'ini',
    env: 'ini',
    dockerfile: 'dockerfile',
    // Data
    graphql: 'graphql',
    gql: 'graphql',
  };

  return languageMap[ext] || 'plaintext';
}

/**
 * Maximum file size for editing (5MB)
 */
const MAX_EDIT_SIZE = 5 * 1024 * 1024;

function TextEditor({
  bucket,
  fileKey,
  fileName,
  onClose,
  onSaved,
}: TextEditorProps): React.ReactElement {
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const language = getLanguageFromKey(fileKey);

  // Load file content on mount
  useEffect(() => {
    let mounted = true;

    const loadContent = async () => {
      setLoading(true);
      setError(null);

      try {
        // First check file size
        const sizeResult = await window.electronAPI.s3.getFileSize(bucket, fileKey);
        if (!sizeResult.success) {
          throw new Error(sizeResult.error || 'Failed to get file size');
        }

        if (sizeResult.size && sizeResult.size > MAX_EDIT_SIZE) {
          throw new Error(
            `File is too large to edit (${formatSize(sizeResult.size)}). Maximum size is ${formatSize(MAX_EDIT_SIZE)}.`
          );
        }

        // Download content
        const result = await window.electronAPI.s3.downloadContent(bucket, fileKey);
        if (!result.success) {
          throw new Error(result.error || 'Failed to load file content');
        }

        if (mounted) {
          setContent(result.content || '');
          setOriginalContent(result.content || '');
          setHasChanges(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load file');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadContent();

    return () => {
      mounted = false;
    };
  }, [bucket, fileKey]);

  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    // Focus the editor
    editor.focus();
  }, []);

  const handleEditorChange: OnChange = useCallback(
    (value) => {
      const newContent = value || '';
      setContent(newContent);
      setHasChanges(newContent !== originalContent);
    },
    [originalContent]
  );

  const handleSave = useCallback(async () => {
    if (!hasChanges || saving) return;

    setSaving(true);
    setError(null);

    try {
      const result = await window.electronAPI.s3.uploadContent(bucket, fileKey, content);
      if (!result.success) {
        throw new Error(result.error || 'Failed to save file');
      }

      setOriginalContent(content);
      setHasChanges(false);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setSaving(false);
    }
  }, [bucket, fileKey, content, hasChanges, saving, onSaved]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl/Cmd + S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      // Escape to close (if no changes)
      if (e.key === 'Escape' && !hasChanges) {
        onClose();
      }
    },
    [handleSave, hasChanges, onClose]
  );

  const handleClose = useCallback(() => {
    if (hasChanges) {
      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to close?'
      );
      if (!confirmed) return;
    }
    onClose();
  }, [hasChanges, onClose]);

  return (
    <div className="text-editor-overlay" onKeyDown={handleKeyDown}>
      <div className="text-editor">
        {/* Header */}
        <div className="text-editor-header">
          <div className="text-editor-title">
            <span className="text-editor-icon">📝</span>
            <span className="text-editor-filename" title={fileKey}>
              {fileName}
            </span>
            {hasChanges && <span className="text-editor-modified">*</span>}
          </div>
          <div className="text-editor-language">{language}</div>
          <div className="text-editor-actions">
            <button
              className="text-editor-btn text-editor-btn-save"
              onClick={handleSave}
              disabled={!hasChanges || saving}
              title="Save (Ctrl+S)"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              className="text-editor-btn text-editor-btn-close"
              onClick={handleClose}
              title={hasChanges ? 'Close (unsaved changes)' : 'Close (Escape)'}
            >
              Close
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="text-editor-error">
            <span className="error-icon">!</span>
            <span>{error}</span>
            <button
              className="text-editor-error-dismiss"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Editor content */}
        <div className="text-editor-content">
          {loading ? (
            <div className="text-editor-loading">
              <span className="loading-spinner"></span>
              <span>Loading file...</span>
            </div>
          ) : (
            <Editor
              height="100%"
              language={language}
              value={content}
              theme="vs-dark"
              onMount={handleEditorMount}
              onChange={handleEditorChange}
              loading={
                <div className="text-editor-loading">
                  <span className="loading-spinner"></span>
                  <span>Loading editor...</span>
                </div>
              }
              options={{
                minimap: { enabled: true },
                fontSize: 13,
                fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Consolas', monospace",
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                wrappingIndent: 'indent',
                automaticLayout: true,
                tabSize: 2,
                insertSpaces: true,
                renderWhitespace: 'selection',
                bracketPairColorization: { enabled: true },
                guides: {
                  bracketPairs: true,
                  indentation: true,
                },
              }}
            />
          )}
        </div>

        {/* Footer status */}
        <div className="text-editor-footer">
          <span className="text-editor-path" title={`s3://${bucket}/${fileKey}`}>
            s3://{bucket}/{fileKey}
          </span>
          <span className="text-editor-status">
            {hasChanges ? 'Modified' : 'Saved'}
          </span>
        </div>
      </div>
    </div>
  );
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

export default TextEditor;
