import React, { useState, useEffect, useCallback, useRef } from 'react';

export interface ImagePreviewProps {
  bucket: string;
  fileKey: string;
  fileName: string;
  fileSize?: number;
  onClose: () => void;
}

/**
 * Format file size for display
 */
function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Get MIME type from file extension
 */
function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    tif: 'image/tiff',
  };
  return mimeTypes[ext] || 'image/png';
}

function ImagePreview({
  bucket,
  fileKey,
  fileName,
  fileSize,
  onClose,
}: ImagePreviewProps): React.ReactElement {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(100);
  const containerRef = useRef<HTMLDivElement>(null);

  // Max file size for preview (50MB)
  const MAX_FILE_SIZE = 50 * 1024 * 1024;

  // Load image content
  useEffect(() => {
    let mounted = true;
    let objectUrl: string | null = null;

    const loadImage = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Check file size
        if (fileSize && fileSize > MAX_FILE_SIZE) {
          throw new Error(`Image file is too large to preview (${formatFileSize(fileSize)}). Maximum size is ${formatFileSize(MAX_FILE_SIZE)}.`);
        }

        // Download image content
        const result = await window.electronAPI.s3.downloadBinaryContent(bucket, fileKey);

        if (!mounted) return;

        if (!result.success || !result.data) {
          throw new Error(result.error || 'Failed to download image');
        }

        // Create blob URL for the image
        const mimeType = getMimeType(fileName);
        const blob = new Blob([result.data], { type: mimeType });
        objectUrl = URL.createObjectURL(blob);

        setImageUrl(objectUrl);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load image');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      mounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [bucket, fileKey, fileName, fileSize]);

  // Handle image load to get dimensions
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDimensions({
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        setZoom(prev => Math.min(prev + 25, 500));
      } else if (e.key === '-') {
        setZoom(prev => Math.max(prev - 25, 25));
      } else if (e.key === '0') {
        setZoom(100);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Handle overlay click (close when clicking outside image)
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev + 25, 500));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev - 25, 25));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(100);
  }, []);

  return (
    <div className="image-preview-overlay" onClick={handleOverlayClick}>
      <div className="image-preview" role="dialog" aria-label={`Image preview: ${fileName}`}>
        {/* Header */}
        <div className="image-preview-header">
          <div className="image-preview-title">
            <span className="image-preview-icon">P</span>
            <span className="image-preview-filename" title={fileName}>{fileName}</span>
          </div>
          <div className="image-preview-meta">
            {imageDimensions && (
              <span className="image-preview-meta-item">
                {imageDimensions.width} x {imageDimensions.height}
              </span>
            )}
            {fileSize !== undefined && (
              <span className="image-preview-meta-item">{formatFileSize(fileSize)}</span>
            )}
          </div>
          <div className="image-preview-zoom-controls">
            <button
              className="image-preview-zoom-btn"
              onClick={handleZoomOut}
              disabled={zoom <= 25}
              title="Zoom out (-)"
            >
              -
            </button>
            <button
              className="image-preview-zoom-value"
              onClick={handleZoomReset}
              title="Reset zoom (0)"
            >
              {zoom}%
            </button>
            <button
              className="image-preview-zoom-btn"
              onClick={handleZoomIn}
              disabled={zoom >= 500}
              title="Zoom in (+)"
            >
              +
            </button>
          </div>
          <div className="image-preview-actions">
            <button className="image-preview-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="image-preview-error">
            <span>Error: {error}</span>
            <button className="image-preview-error-dismiss" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        {/* Content */}
        <div className="image-preview-content" ref={containerRef}>
          {isLoading ? (
            <div className="image-preview-loading">
              <div className="loading-spinner" />
              <span>Loading image...</span>
            </div>
          ) : imageUrl ? (
            <div className="image-preview-image-container">
              <img
                src={imageUrl}
                alt={fileName}
                onLoad={handleImageLoad}
                style={{
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: 'center center',
                }}
                className="image-preview-image"
              />
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="image-preview-footer">
          <span className="image-preview-path" title={`s3://${bucket}/${fileKey}`}>
            s3://{bucket}/{fileKey}
          </span>
          <span className="image-preview-status">
            Press Esc to close | +/- to zoom | 0 to reset
          </span>
        </div>
      </div>
    </div>
  );
}

export default ImagePreview;
