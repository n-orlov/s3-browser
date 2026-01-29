import React from 'react';

export interface Operation {
  id: string;
  type: 'upload' | 'download';
  fileName: string;
  status: 'pending' | 'in-progress' | 'completed' | 'error';
  error?: string;
}

export interface OperationStatusProps {
  operations: Operation[];
  onDismiss: (id: string) => void;
}

function OperationStatus({ operations, onDismiss }: OperationStatusProps): React.ReactElement | null {
  if (operations.length === 0) {
    return null;
  }

  const getStatusIcon = (status: Operation['status']) => {
    switch (status) {
      case 'pending':
        return 'W';
      case 'in-progress':
        return 'L';
      case 'completed':
        return '!';
      case 'error':
        return 'X';
    }
  };

  const getStatusClass = (status: Operation['status']) => {
    switch (status) {
      case 'pending':
        return 'status-pending';
      case 'in-progress':
        return 'status-progress';
      case 'completed':
        return 'status-completed';
      case 'error':
        return 'status-error';
    }
  };

  return (
    <div className="operation-status-container">
      {operations.map((op) => (
        <div key={op.id} className={`operation-status-item ${getStatusClass(op.status)}`}>
          <span className="operation-icon">{getStatusIcon(op.status)}</span>
          <span className="operation-type">{op.type === 'upload' ? 'Upload' : 'Download'}</span>
          <span className="operation-filename" title={op.fileName}>
            {op.fileName}
          </span>
          {op.error && <span className="operation-error">{op.error}</span>}
          {(op.status === 'completed' || op.status === 'error') && (
            <button className="operation-dismiss" onClick={() => onDismiss(op.id)} title="Dismiss">
              x
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default OperationStatus;
