import React, { useEffect } from 'react';
import { useResettingState } from './useResettingState';
import {
  buildFolderMetadata,
  formatSize,
  getDetailRows,
  getErrorMessage,
  getName,
  getTypeLabel,
} from '../utils/propertiesFormat';

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

function PropertyRow({
  label,
  children,
  valueClass = 'property-value',
}: {
  label: string;
  children: React.ReactNode;
  valueClass?: string;
}): React.ReactElement {
  return (
    <div className="property-row">
      <span className="property-label">{label}:</span>
      <span className={valueClass}>{children}</span>
    </div>
  );
}

function GeneralSection({
  metadata,
  bucket,
  fileKey,
  isFolder,
}: {
  metadata: ObjectMetadata;
  bucket: string;
  fileKey: string;
  isFolder: boolean;
}): React.ReactElement {
  return (
    <div className="properties-section">
      <h4>General</h4>
      <PropertyRow label="Name">{getName(fileKey)}</PropertyRow>
      <PropertyRow label="Type">{getTypeLabel(isFolder, metadata.contentType)}</PropertyRow>
      {!isFolder && <PropertyRow label="Size">{formatSize(metadata.contentLength)}</PropertyRow>}
      <PropertyRow label="Bucket">{bucket}</PropertyRow>
      <PropertyRow label="Key" valueClass="property-value property-value-wrap">
        {fileKey}
      </PropertyRow>
    </div>
  );
}

function UrlRow({
  label,
  url,
  title,
  valueClass,
  onCopy,
}: {
  label: string;
  url: string;
  title: string;
  valueClass: string;
  onCopy: (url: string) => void;
}): React.ReactElement {
  return (
    <div className="property-row property-row-url">
      <span className="property-label">{label}:</span>
      <span className={valueClass}>{url}</span>
      <button className="property-copy-btn" onClick={() => onCopy(url)} title={title}>
        Copy
      </button>
    </div>
  );
}

function UrlsSection({
  metadata,
  onCopy,
}: {
  metadata: ObjectMetadata;
  onCopy: (url: string) => void;
}): React.ReactElement {
  return (
    <div className="properties-section">
      <h4>URLs</h4>
      <UrlRow
        label="S3 URI"
        url={metadata.s3Url}
        title="Copy S3 URI"
        valueClass="property-value property-value-mono"
        onCopy={onCopy}
      />
      <UrlRow
        label="HTTP URL"
        url={metadata.httpUrl}
        title="Copy HTTP URL"
        valueClass="property-value property-value-mono property-value-wrap"
        onCopy={onCopy}
      />
    </div>
  );
}

function DetailsSection({ metadata }: { metadata: ObjectMetadata }): React.ReactElement {
  return (
    <div className="properties-section">
      <h4>Details</h4>
      {getDetailRows(metadata).map(({ label, value, mono }) => (
        <PropertyRow
          key={label}
          label={label}
          valueClass={mono ? 'property-value property-value-mono' : 'property-value'}
        >
          {value}
        </PropertyRow>
      ))}
    </div>
  );
}

function KeyValueSection({
  title,
  entries,
}: {
  title: string;
  entries: Record<string, string>;
}): React.ReactElement | null {
  const pairs = Object.entries(entries);
  if (pairs.length === 0) return null;
  return (
    <div className="properties-section">
      <h4>{title}</h4>
      {pairs.map(([key, value]) => (
        <PropertyRow key={key} label={key}>
          {value}
        </PropertyRow>
      ))}
    </div>
  );
}

function PropertiesBody({
  metadata,
  bucket,
  fileKey,
  isFolder,
  onCopy,
}: {
  metadata: ObjectMetadata;
  bucket: string;
  fileKey: string;
  isFolder: boolean;
  onCopy: (url: string) => void;
}): React.ReactElement {
  return (
    <div className="properties-grid">
      <GeneralSection metadata={metadata} bucket={bucket} fileKey={fileKey} isFolder={isFolder} />
      <UrlsSection metadata={metadata} onCopy={onCopy} />
      {!isFolder && <DetailsSection metadata={metadata} />}
      <KeyValueSection title="Tags" entries={metadata.tags} />
      <KeyValueSection title="Custom Metadata" entries={metadata.customMetadata} />
    </div>
  );
}

interface FetchResult {
  metadata: ObjectMetadata | null;
  error: string | null;
}

const NO_RESULT: FetchResult | null = null;

/**
 * Loads the properties shown by the dialog. Files fetch metadata from the main process; the
 * fetched result is state that returns to "nothing yet" whenever the dialog closes or points at
 * another object (adjusted during render, no effect), and is only set after the awaited fetch
 * resolves, so a stale response for a previous object is never shown.
 */
function useObjectProperties(
  isOpen: boolean,
  bucket: string,
  fileKey: string,
  isFolder: boolean
): { loading: boolean; error: string | null; metadata: ObjectMetadata | null } {
  const fetching = isOpen && !isFolder;
  const resetKey = fetching ? `open:${bucket}\u0000${fileKey}` : 'idle';
  const [result, setResult] = useResettingState<FetchResult | null>(NO_RESULT, resetKey);

  useEffect(() => {
    if (!fetching) return;
    let cancelled = false;
    // Fetch metadata from main process
    window.electronAPI
      .getObjectMetadata(bucket, fileKey)
      .then((res: { success: boolean; metadata?: ObjectMetadata; error?: string }) => {
        if (cancelled) return;
        if (res.success && res.metadata) {
          setResult({ metadata: res.metadata, error: null });
        } else {
          setResult({ metadata: null, error: getErrorMessage(res.error) });
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setResult({ metadata: null, error: getErrorMessage(err.message) });
      });
    return () => {
      cancelled = true;
    };
  }, [fetching, bucket, fileKey, setResult]);

  const folderMetadata = React.useMemo(
    () => (isOpen && isFolder ? buildFolderMetadata(bucket, fileKey) : null),
    [isOpen, isFolder, bucket, fileKey]
  );

  if (isFolder) return { loading: false, error: null, metadata: folderMetadata };
  return {
    loading: fetching && result === null,
    error: result?.error ?? null,
    metadata: result?.metadata ?? null,
  };
}

function PropertiesDialog({
  isOpen,
  bucket,
  fileKey,
  isFolder,
  onClose,
}: PropertiesDialogProps): React.ReactElement | null {
  const { loading, error, metadata } = useObjectProperties(isOpen, bucket, fileKey, isFolder);

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
            <PropertiesBody
              metadata={metadata}
              bucket={bucket}
              fileKey={fileKey}
              isFolder={isFolder}
              onCopy={handleCopyUrl}
            />
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
