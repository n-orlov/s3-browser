import React, { useState, useCallback, useEffect } from 'react';
import ProfileSelector from './components/ProfileSelector';
import BucketTree from './components/BucketTree';
import FileList, { type S3Object } from './components/FileList';
import FileToolbar from './components/FileToolbar';
import RenameDialog from './components/RenameDialog';
import DeleteConfirmDialog from './components/DeleteConfirmDialog';
import OperationStatus from './components/OperationStatus';
import { useAwsProfiles } from './hooks/useAwsProfiles';
import { useFileOperations } from './hooks/useFileOperations';

function App(): React.ReactElement {
  const { currentProfile } = useAwsProfiles();
  const {
    operations,
    isLoading,
    downloadFile,
    uploadFiles,
    deleteFile,
    renameFile,
    dismissOperation,
  } = useFileOperations();

  // Navigation state
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [currentPrefix, setCurrentPrefix] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<S3Object | null>(null);

  // Dialog state
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // Reset navigation when profile changes
  useEffect(() => {
    setSelectedBucket(null);
    setCurrentPrefix('');
    setSelectedFile(null);
  }, [currentProfile]);

  const handleSelectBucket = useCallback((bucket: string) => {
    setSelectedBucket(bucket);
    setCurrentPrefix('');
    setSelectedFile(null);
  }, []);

  const handleNavigate = useCallback((prefix: string) => {
    setCurrentPrefix(prefix);
    setSelectedFile(null);
  }, []);

  const handleSelectFile = useCallback((file: S3Object | null) => {
    setSelectedFile(file);
  }, []);

  // File operation handlers
  const handleUpload = useCallback(() => {
    if (!selectedBucket) return;
    uploadFiles(selectedBucket, currentPrefix);
  }, [selectedBucket, currentPrefix, uploadFiles]);

  const handleDownload = useCallback(() => {
    if (!selectedBucket || !selectedFile || selectedFile.isPrefix) return;
    downloadFile(selectedBucket, selectedFile.key);
  }, [selectedBucket, selectedFile, downloadFile]);

  const handleDelete = useCallback(() => {
    if (!selectedFile || selectedFile.isPrefix) return;
    setIsDeleteOpen(true);
  }, [selectedFile]);

  const handleConfirmDelete = useCallback(async () => {
    if (!selectedBucket || !selectedFile) return;
    setIsDeleteOpen(false);

    const success = await deleteFile(selectedBucket, selectedFile.key);
    if (success) {
      setSelectedFile(null);
      // Trigger refresh
      window.dispatchEvent(new Event('s3-refresh-files'));
    }
  }, [selectedBucket, selectedFile, deleteFile]);

  const handleRename = useCallback(() => {
    if (!selectedFile || selectedFile.isPrefix) return;
    setIsRenameOpen(true);
  }, [selectedFile]);

  const handleConfirmRename = useCallback(
    async (newName: string) => {
      if (!selectedBucket || !selectedFile) return;
      setIsRenameOpen(false);

      const success = await renameFile(selectedBucket, selectedFile.key, newName);
      if (success) {
        setSelectedFile(null);
        // Trigger refresh
        window.dispatchEvent(new Event('s3-refresh-files'));
      }
    },
    [selectedBucket, selectedFile, renameFile]
  );

  const handleRefresh = useCallback(() => {
    window.dispatchEvent(new Event('s3-refresh-files'));
  }, []);

  const handleFilesDropped = useCallback(
    (filePaths: string[]) => {
      if (!selectedBucket) return;
      uploadFiles(selectedBucket, currentPrefix, filePaths).then(() => {
        // Trigger refresh after upload completes
        window.dispatchEvent(new Event('s3-refresh-files'));
      });
    },
    [selectedBucket, currentPrefix, uploadFiles]
  );

  // Build display path for header
  const getDisplayPath = (): string => {
    if (!selectedBucket) return 'Files';
    if (!currentPrefix) return selectedBucket;
    return `${selectedBucket}/${currentPrefix}`;
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <h1>S3 Browser</h1>
        </div>
        <ProfileSelector />
      </header>
      <main className="app-main">
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>Buckets</h2>
          </div>
          <div className="tree-view">
            <BucketTree
              currentProfile={currentProfile}
              selectedBucket={selectedBucket}
              onSelectBucket={handleSelectBucket}
            />
          </div>
        </aside>
        <section className="content">
          <div className="content-header">
            <h2 title={getDisplayPath()}>{getDisplayPath()}</h2>
            {selectedFile && (
              <div className="selected-file-info">
                <span className="selected-label">Selected:</span>
                <span className="selected-name" title={selectedFile.key}>
                  {selectedFile.key.split('/').pop()}
                </span>
              </div>
            )}
          </div>
          <FileToolbar
            selectedBucket={selectedBucket}
            currentPrefix={currentPrefix}
            selectedFile={selectedFile}
            onUpload={handleUpload}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onRename={handleRename}
            onRefresh={handleRefresh}
            disabled={isLoading}
          />
          <div className="file-list">
            <FileList
              currentProfile={currentProfile}
              selectedBucket={selectedBucket}
              currentPrefix={currentPrefix}
              onNavigate={handleNavigate}
              onSelectFile={handleSelectFile}
              selectedFile={selectedFile}
              onFilesDropped={handleFilesDropped}
            />
          </div>
        </section>
      </main>

      {/* Operation status */}
      <OperationStatus operations={operations} onDismiss={dismissOperation} />

      {/* Dialogs */}
      <RenameDialog
        isOpen={isRenameOpen}
        currentName={selectedFile?.key.split('/').pop() || ''}
        onConfirm={handleConfirmRename}
        onCancel={() => setIsRenameOpen(false)}
      />
      <DeleteConfirmDialog
        isOpen={isDeleteOpen}
        fileName={selectedFile?.key.split('/').pop() || ''}
        onConfirm={handleConfirmDelete}
        onCancel={() => setIsDeleteOpen(false)}
      />
    </div>
  );
}

export default App;
