import React, { useEffect, useState } from 'react';

export interface ObjectMetadata {
  key: string;
  bucket: string;
  s3Url: string;
  httpUrl: string;
  contentLength?: number;
  contentType?: string;
  lastModified?: Date | string;
  etag?: string;
  storageClass?: string;
  versionId?: string;
  serverSideEncryption?: string;
  contentEncoding?: string;
  cacheControl?: string;
  expires?: Date | string;
  tags: Record<string, string>;
  customMetadata: Record<string, string>;
}

export interface PropertiesDialogProps {
  isOpen: boolean;
  bucket: string;
  fileKey: string;
  isFolder: boolean;
  onClose: () => void;
}

/**
 * Format bytes into human readable size
 */
function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return '-';
  if (bytes === 0) return '0 bytes';

  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  const base = 1024;
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(base)),
    units.length - 1
  );

  const value = bytes / Math.pow(base, exponent);
  const formatted = exponent === 0 ? value.toString() : value.toFixed(2);

  return `${formatted} ${units[exponent]}`;
}

/**
 * Format date to locale string
 */
function formatDate(date: Date | string | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString();
}

/**
 * Get the file/folder name from a key
 */
function getName(key: string): string {
  const normalized = key.endsWith('/') ? key.slice(0, -1) : key;
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? normalized : normalized.substring(lastSlash + 1);
}

function PropertiesDialog({
  isOpen,
  bucket,
  fileKey,
  isFolder,
  onClose,
}: PropertiesDialogProps): React.ReactElement | null {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<ObjectMetadata | null>(null);

  useEffect(() => {
    if (isOpen && !isFolder) {
      setLoading(true);
      setError(null);
      setMetadata(null);

      // Fetch metadata from main process
      window.electronAPI
        .getObjectMetadata(bucket, fileKey)
        .then((result: { success: boolean; metadata?: ObjectMetadata; error?: string }) => {
          if (result.success && result.metadata) {
            setMetadata(result.metadata);
          } else {
            setError(result.error || 'Failed to load metadata');
          }
        })
        .catch((err: Error) => {
          setError(err.message || 'Failed to load metadata');
        })
        .finally(() => {
          setLoading(false);
        });
    } else if (isOpen && isFolder) {
      // For folders, we don't fetch metadata, just show basic info
      setMetadata({
        key: fileKey,
        bucket,
        s3Url: `s3://${bucket}/${fileKey}`,
        httpUrl: `https://${bucket}.s3.amazonaws.com/${encodeURIComponent(fileKey)}`,
        tags: {},
        customMetadata: {},
      });
    }
  }, [isOpen, bucket, fileKey, isFolder]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard write failed
    }
  };

  if (!isOpen) {
    return null;
  }

  const name = getName(fileKey);

  return (
    <div className="dialog-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="dialog dialog-properties" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>{isFolder ? 'Folder' : 'File'} Properties</h3>
        </div>
        <div className="dialog-content properties-content">
          {loading && (
            <div className="properties-loading">
              <span>Loading metadata...</span>
            </div>
          )}
          {error && (
            <div className="properties-error">
              <span>Error: {error}</span>
            </div>
          )}
          {!loading && !error && metadata && (
            <div className="properties-grid">
              <div className="properties-section">
                <h4>General</h4>
                <div className="property-row">
                  <span className="property-label">Name:</span>
                  <span className="property-value">{name}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">Type:</span>
                  <span className="property-value">{isFolder ? 'Folder' : (metadata.contentType || 'Unknown')}</span>
                </div>
                {!isFolder && (
                  <div className="property-row">
                    <span className="property-label">Size:</span>
                    <span className="property-value">{formatSize(metadata.contentLength)}</span>
                  </div>
                )}
                <div className="property-row">
                  <span className="property-label">Bucket:</span>
                  <span className="property-value">{bucket}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">Key:</span>
                  <span className="property-value property-value-wrap">{fileKey}</span>
                </div>
              </div>

              <div className="properties-section">
                <h4>URLs</h4>
                <div className="property-row property-row-url">
                  <span className="property-label">S3 URI:</span>
                  <span className="property-value property-value-mono">{metadata.s3Url}</span>
                  <button
                    className="property-copy-btn"
                    onClick={() => handleCopyUrl(metadata.s3Url)}
                    title="Copy S3 URI"
                  >
                    Copy
                  </button>
                </div>
                <div className="property-row property-row-url">
                  <span className="property-label">HTTP URL:</span>
                  <span className="property-value property-value-mono property-value-wrap">{metadata.httpUrl}</span>
                  <button
                    className="property-copy-btn"
                    onClick={() => handleCopyUrl(metadata.httpUrl)}
                    title="Copy HTTP URL"
                  >
                    Copy
                  </button>
                </div>
              </div>

              {!isFolder && (
                <div className="properties-section">
                  <h4>Details</h4>
                  {metadata.lastModified && (
                    <div className="property-row">
                      <span className="property-label">Last Modified:</span>
                      <span className="property-value">{formatDate(metadata.lastModified)}</span>
                    </div>
                  )}
                  {metadata.etag && (
                    <div className="property-row">
                      <span className="property-label">ETag:</span>
                      <span className="property-value property-value-mono">{metadata.etag}</span>
                    </div>
                  )}
                  {metadata.storageClass && (
                    <div className="property-row">
                      <span className="property-label">Storage Class:</span>
                      <span className="property-value">{metadata.storageClass}</span>
                    </div>
                  )}
                  {metadata.versionId && (
                    <div className="property-row">
                      <span className="property-label">Version ID:</span>
                      <span className="property-value property-value-mono">{metadata.versionId}</span>
                    </div>
                  )}
                  {metadata.serverSideEncryption && (
                    <div className="property-row">
                      <span className="property-label">Encryption:</span>
                      <span className="property-value">{metadata.serverSideEncryption}</span>
                    </div>
                  )}
                  {metadata.contentEncoding && (
                    <div className="property-row">
                      <span className="property-label">Content Encoding:</span>
                      <span className="property-value">{metadata.contentEncoding}</span>
                    </div>
                  )}
                  {metadata.cacheControl && (
                    <div className="property-row">
                      <span className="property-label">Cache Control:</span>
                      <span className="property-value">{metadata.cacheControl}</span>
                    </div>
                  )}
                  {metadata.expires && (
                    <div className="property-row">
                      <span className="property-label">Expires:</span>
                      <span className="property-value">{formatDate(metadata.expires)}</span>
                    </div>
                  )}
                </div>
              )}

              {Object.keys(metadata.tags).length > 0 && (
                <div className="properties-section">
                  <h4>Tags</h4>
                  {Object.entries(metadata.tags).map(([key, value]) => (
                    <div key={key} className="property-row">
                      <span className="property-label">{key}:</span>
                      <span className="property-value">{value}</span>
                    </div>
                  ))}
                </div>
              )}

              {Object.keys(metadata.customMetadata).length > 0 && (
                <div className="properties-section">
                  <h4>Custom Metadata</h4>
                  {Object.entries(metadata.customMetadata).map(([key, value]) => (
                    <div key={key} className="property-row">
                      <span className="property-label">{key}:</span>
                      <span className="property-value">{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="dialog-btn dialog-btn-confirm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default PropertiesDialog;
