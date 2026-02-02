import React from 'react';

export interface DeleteConfirmDialogProps {
  isOpen: boolean;
  /** Single filename or array of filenames for batch delete */
  fileNames: string[];
  /** Whether any of the selected items are folders */
  hasFolders?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirmDialog({
  isOpen,
  fileNames,
  hasFolders = false,
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
  const itemLabel = hasFolders ? 'Item' : 'File';
  const itemsLabel = hasFolders ? 'items' : 'files';

  return (
    <div className="dialog-overlay" onClick={onCancel} onKeyDown={handleKeyDown}>
      <div className="dialog dialog-danger" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>{isBatchDelete ? `Delete ${fileNames.length} ${itemsLabel}` : `Delete ${itemLabel}`}</h3>
        </div>
        <div className="dialog-content">
          <p>Are you sure you want to delete{isBatchDelete ? ` these ${itemsLabel}` : ''}:</p>
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
          {hasFolders && (
            <p className="dialog-warning-folder">Folders and all their contents will be deleted!</p>
          )}
          <p className="dialog-warning">This action cannot be undone.</p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="dialog-btn dialog-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="dialog-btn dialog-btn-danger" onClick={onConfirm}>
            Delete{isBatchDelete ? ` ${fileNames.length} ${itemsLabel}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DeleteConfirmDialog;
