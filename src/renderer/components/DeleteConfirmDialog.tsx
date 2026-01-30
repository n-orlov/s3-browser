import React from 'react';

export interface DeleteConfirmDialogProps {
  isOpen: boolean;
  /** Single filename or array of filenames for batch delete */
  fileNames: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirmDialog({
  isOpen,
  fileNames,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps): React.ReactElement | null {
  if (!isOpen) {
    return null;
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    } else if (e.key === 'Enter') {
      onConfirm();
    }
  };

  const isBatchDelete = fileNames.length > 1;
  const displayedNames = fileNames.slice(0, 5); // Show max 5 names
  const remainingCount = fileNames.length - displayedNames.length;

  return (
    <div className="dialog-overlay" onClick={onCancel} onKeyDown={handleKeyDown}>
      <div className="dialog dialog-danger" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>{isBatchDelete ? `Delete ${fileNames.length} Files` : 'Delete File'}</h3>
        </div>
        <div className="dialog-content">
          <p>Are you sure you want to delete{isBatchDelete ? ' these files' : ''}:</p>
          {isBatchDelete ? (
            <div className="dialog-filename-list">
              {displayedNames.map((name, index) => (
                <p key={index} className="dialog-filename dialog-filename-item">{name}</p>
              ))}
              {remainingCount > 0 && (
                <p className="dialog-filename-more">...and {remainingCount} more</p>
              )}
            </div>
          ) : (
            <p className="dialog-filename">{fileNames[0] || ''}</p>
          )}
          <p className="dialog-warning">This action cannot be undone.</p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="dialog-btn dialog-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="dialog-btn dialog-btn-danger" onClick={onConfirm}>
            Delete{isBatchDelete ? ` ${fileNames.length} Files` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DeleteConfirmDialog;
