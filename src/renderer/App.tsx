import React, { useState, useCallback, useEffect, useRef } from 'react';
import ProfileSelector from './components/ProfileSelector';
import BucketTree from './components/BucketTree';
import FileList, { type S3Object } from './components/FileList';
import FileToolbar from './components/FileToolbar';
import NavigationBar from './components/NavigationBar';
import RenameDialog from './components/RenameDialog';
import DeleteConfirmDialog from './components/DeleteConfirmDialog';
import OperationStatus from './components/OperationStatus';
import TextEditor from './components/TextEditor';
import ParquetViewer from './components/ParquetViewer';
import ImagePreview from './components/ImagePreview';
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
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isParquetViewerOpen, setIsParquetViewerOpen] = useState(false);
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);

  // Pending file selection (for URL navigation that points to a file)
  const [pendingFileSelection, setPendingFileSelection] = useState<string | null>(null);

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
    setPendingFileSelection(null);
  }, []);

  // Handler for URL-based navigation (from NavigationBar)
  const handleUrlNavigate = useCallback((bucket: string, prefix: string, selectKey?: string) => {
    setSelectedBucket(bucket);
    setCurrentPrefix(prefix);
    setSelectedFile(null);
    // If a specific file key was provided, set it as pending selection
    setPendingFileSelection(selectKey || null);
    // Trigger refresh to load the new location
    window.dispatchEvent(new Event('s3-refresh-files'));
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

  const handleEdit = useCallback(() => {
    if (!selectedFile || selectedFile.isPrefix) return;
    setIsEditorOpen(true);
  }, [selectedFile]);

  const handleEditorClose = useCallback(() => {
    setIsEditorOpen(false);
  }, []);

  const handleEditorSaved = useCallback(() => {
    // Optionally refresh file list to show updated modification time
    window.dispatchEvent(new Event('s3-refresh-files'));
  }, []);

  const handleViewParquet = useCallback(() => {
    if (!selectedFile || selectedFile.isPrefix) return;
    setIsParquetViewerOpen(true);
  }, [selectedFile]);

  const handleParquetViewerClose = useCallback(() => {
    setIsParquetViewerOpen(false);
  }, []);

  const handleViewImage = useCallback(() => {
    if (!selectedFile || selectedFile.isPrefix) return;
    setIsImagePreviewOpen(true);
  }, [selectedFile]);

  const handleImagePreviewClose = useCallback(() => {
    setIsImagePreviewOpen(false);
  }, []);

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

  const handlePendingFileSelectionHandled = useCallback(() => {
    setPendingFileSelection(null);
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
          <NavigationBar
            currentBucket={selectedBucket}
            currentPrefix={currentPrefix}
            onNavigate={handleUrlNavigate}
          />
          <FileToolbar
            selectedBucket={selectedBucket}
            currentPrefix={currentPrefix}
            selectedFile={selectedFile}
            onUpload={handleUpload}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onRename={handleRename}
            onEdit={handleEdit}
            onViewParquet={handleViewParquet}
            onViewImage={handleViewImage}
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
              pendingFileSelection={pendingFileSelection}
              onPendingFileSelectionHandled={handlePendingFileSelectionHandled}
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

      {/* Text Editor */}
      {isEditorOpen && selectedBucket && selectedFile && (
        <TextEditor
          bucket={selectedBucket}
          fileKey={selectedFile.key}
          fileName={selectedFile.key.split('/').pop() || selectedFile.key}
          onClose={handleEditorClose}
          onSaved={handleEditorSaved}
        />
      )}

      {/* Parquet Viewer */}
      {isParquetViewerOpen && selectedBucket && selectedFile && (
        <ParquetViewer
          bucket={selectedBucket}
          fileKey={selectedFile.key}
          fileName={selectedFile.key.split('/').pop() || selectedFile.key}
          fileSize={selectedFile.size}
          onClose={handleParquetViewerClose}
        />
      )}

      {/* Image Preview */}
      {isImagePreviewOpen && selectedBucket && selectedFile && (
        <ImagePreview
          bucket={selectedBucket}
          fileKey={selectedFile.key}
          fileName={selectedFile.key.split('/').pop() || selectedFile.key}
          fileSize={selectedFile.size}
          onClose={handleImagePreviewClose}
        />
      )}
    </div>
  );
}

export default App;
