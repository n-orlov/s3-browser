import React, { useState, useEffect, useRef } from 'react';

export type NewItemType = 'file' | 'folder';

export interface NewItemDialogProps {
  isOpen: boolean;
  itemType: NewItemType;
  currentPrefix: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

function NewItemDialog({
  isOpen,
  itemType,
  currentPrefix,
  onConfirm,
  onCancel,
}: NewItemDialogProps): React.ReactElement | null {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const defaultFileName = 'new-file.txt';
  const defaultFolderName = 'new-folder';

  useEffect(() => {
    if (isOpen) {
      const defaultName = itemType === 'file' ? defaultFileName : defaultFolderName;
      setName(defaultName);
      // Focus and select the name
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          if (itemType === 'file') {
            // Select name without extension
            const dotIndex = defaultName.lastIndexOf('.');
            if (dotIndex > 0) {
              inputRef.current.setSelectionRange(0, dotIndex);
            } else {
              inputRef.current.select();
            }
          } else {
            inputRef.current.select();
          }
        }
      }, 0);
    }
  }, [isOpen, itemType]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName) {
      onConfirm(trimmedName);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  const isValidName = (): boolean => {
    const trimmedName = name.trim();
    if (!trimmedName) return false;
    // Basic validation - no path separators allowed in name
    if (trimmedName.includes('/') || trimmedName.includes('\\')) return false;
    return true;
  };

  if (!isOpen) {
    return null;
  }

  const title = itemType === 'file' ? 'New File' : 'New Folder';
  const placeholder = itemType === 'file' ? 'Enter file name...' : 'Enter folder name...';
  const previewPath = currentPrefix
    ? `${currentPrefix}${name.trim()}${itemType === 'folder' ? '/' : ''}`
    : `${name.trim()}${itemType === 'folder' ? '/' : ''}`;

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>{title}</h3>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="dialog-content">
            <label htmlFor="new-item-input">Name:</label>
            <input
              ref={inputRef}
              id="new-item-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="dialog-input"
              placeholder={placeholder}
            />
            {name.trim() && (
              <div className="new-item-preview">
                <span className="preview-label">Will create:</span>
                <span className="preview-path" title={previewPath}>{previewPath}</span>
              </div>
            )}
          </div>
          <div className="dialog-actions">
            <button type="button" className="dialog-btn dialog-btn-cancel" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="dialog-btn dialog-btn-confirm"
              disabled={!isValidName()}
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NewItemDialog;
