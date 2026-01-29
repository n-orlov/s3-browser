import React, { useState, useEffect, useRef } from 'react';

export interface RenameDialogProps {
  isOpen: boolean;
  currentName: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}

function RenameDialog({
  isOpen,
  currentName,
  onConfirm,
  onCancel,
}: RenameDialogProps): React.ReactElement | null {
  const [newName, setNewName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNewName(currentName);
      // Focus and select the name (without extension)
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const dotIndex = currentName.lastIndexOf('.');
          if (dotIndex > 0) {
            inputRef.current.setSelectionRange(0, dotIndex);
          } else {
            inputRef.current.select();
          }
        }
      }, 0);
    }
  }, [isOpen, currentName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newName.trim() && newName !== currentName) {
      onConfirm(newName.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Rename File</h3>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="dialog-content">
            <label htmlFor="rename-input">New name:</label>
            <input
              ref={inputRef}
              id="rename-input"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="dialog-input"
            />
          </div>
          <div className="dialog-actions">
            <button type="button" className="dialog-btn dialog-btn-cancel" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="dialog-btn dialog-btn-confirm"
              disabled={!newName.trim() || newName === currentName}
            >
              Rename
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default RenameDialog;
