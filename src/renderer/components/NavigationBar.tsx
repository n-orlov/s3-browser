import React, { useState, useCallback, useRef, useEffect } from 'react';

export interface NavigationBarProps {
  currentBucket: string | null;
  currentPrefix: string;
  onNavigate: (bucket: string, prefix: string, selectKey?: string) => void;
}

/**
 * NavigationBar component for S3 URL input and navigation.
 * Supports multiple S3 URL formats:
 * - s3://bucket/key
 * - https://bucket.s3.region.amazonaws.com/key
 * - https://s3.region.amazonaws.com/bucket/key
 */
function NavigationBar({
  currentBucket,
  currentPrefix,
  onNavigate,
}: NavigationBarProps): React.ReactElement {
  const [inputValue, setInputValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build display path from current bucket/prefix
  const getDisplayPath = useCallback((): string => {
    if (!currentBucket) return '';
    if (!currentPrefix) return `s3://${currentBucket}/`;
    return `s3://${currentBucket}/${currentPrefix}`;
  }, [currentBucket, currentPrefix]);

  // Update display when navigation changes
  useEffect(() => {
    if (!isEditing) {
      setInputValue(getDisplayPath());
    }
  }, [currentBucket, currentPrefix, isEditing, getDisplayPath]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setError(null);
  }, []);

  const handleInputFocus = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleInputBlur = useCallback(() => {
    // Delay to allow navigation to complete before resetting
    setTimeout(() => {
      setIsEditing(false);
      setInputValue(getDisplayPath());
      setError(null);
    }, 150);
  }, [getDisplayPath]);

  const handleNavigate = useCallback(async () => {
    const trimmedValue = inputValue.trim();

    if (!trimmedValue) {
      setError(null);
      return;
    }

    try {
      const result = await window.electronAPI.s3.parseUrl(trimmedValue);

      if (!result.success || !result.bucket) {
        setError('Invalid S3 URL format. Try: s3://bucket/path or https://bucket.s3.amazonaws.com/path');
        return;
      }

      const { bucket, key } = result;

      // Determine if key is a file or prefix
      // If it doesn't end with '/' and has content, it might be a file
      const isLikelyFile = key && !key.endsWith('/') && key.length > 0;

      if (isLikelyFile) {
        // Navigate to the parent prefix and select the file
        const lastSlash = key.lastIndexOf('/');
        const prefix = lastSlash >= 0 ? key.substring(0, lastSlash + 1) : '';
        onNavigate(bucket, prefix, key);
      } else {
        // Navigate to the prefix (folder)
        onNavigate(bucket, key || '');
      }

      setError(null);
      setIsEditing(false);
    } catch (err) {
      setError('Failed to parse S3 URL');
    }
  }, [inputValue, onNavigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleNavigate();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsEditing(false);
        setInputValue(getDisplayPath());
        setError(null);
        inputRef.current?.blur();
      }
    },
    [handleNavigate, getDisplayPath]
  );

  const handleGoClick = useCallback(() => {
    handleNavigate();
  }, [handleNavigate]);

  return (
    <div className="navigation-bar">
      <div className="navigation-bar-input-wrapper">
        <span className="navigation-bar-icon">S3</span>
        <input
          ref={inputRef}
          type="text"
          className={`navigation-bar-input ${error ? 'has-error' : ''}`}
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          placeholder="Enter S3 URL (s3://bucket/path or https://...)"
          spellCheck={false}
          autoComplete="off"
          aria-label="S3 URL"
        />
        <button
          className="navigation-bar-go-btn"
          onClick={handleGoClick}
          disabled={!inputValue.trim()}
          title="Navigate to URL"
          aria-label="Go"
        >
          Go
        </button>
      </div>
      {error && (
        <div className="navigation-bar-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export default NavigationBar;
