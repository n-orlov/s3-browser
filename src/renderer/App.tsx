import React, { useState, useCallback, useEffect, useRef } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import NetworkStatusBanner from './components/NetworkStatusBanner';
import ProfileSelector from './components/ProfileSelector';
import BucketTree from './components/BucketTree';
import FileList, { type S3Object } from './components/FileList';
import FileToolbar from './components/FileToolbar';
import NavigationBar from './components/NavigationBar';
import RenameDialog from './components/RenameDialog';
import DeleteConfirmDialog from './components/DeleteConfirmDialog';
import PropertiesDialog from './components/PropertiesDialog';
import NewItemDialog, { type NewItemType } from './components/NewItemDialog';
import OperationStatus from './components/OperationStatus';
import TextEditor from './components/TextEditor';
import ParquetViewer from './components/ParquetViewer';
import CsvViewer from './components/CsvViewer';
import JsonViewer from './components/JsonViewer';
import YamlViewer from './components/YamlViewer';
import ImagePreview from './components/ImagePreview';
import StatusBar from './components/StatusBar';
import { ToastContainer, useToasts } from './components/Toast';
import { useAwsProfiles } from './context/AwsProfileContext';
import { useFileOperations } from './hooks/useFileOperations';

function App(): React.ReactElement {
  const { currentProfile, profileRestored } = useAwsProfiles();
  const { toasts, addToast, removeToast } = useToasts();

  // Callback for when download completes - shows toast with action to reveal file
  const handleDownloadComplete = useCallback(
    ({ fileName, localPath }: { fileName: string; localPath: string }) => {
      addToast({
        type: 'success',
        title: 'Download Complete',
        message: fileName,
        duration: 8000, // Longer duration for user to click the action
        action: {
          label: 'Show in folder',
          onClick: () => {
            window.electronAPI.s3.showFileInFolder(localPath);
          },
        },
      });
    },
    [addToast]
  );

  const {
    operations,
    isLoading,
    downloadFile,
    uploadFiles,
    deleteFile,
    deleteFiles,
    deletePrefix,
    renameFile,
    dismissOperation,
  } = useFileOperations({ onDownloadComplete: handleDownloadComplete });

  // Navigation state
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [currentPrefix, setCurrentPrefix] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<S3Object | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<S3Object[]>([]);

  // Dialog state
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isParquetViewerOpen, setIsParquetViewerOpen] = useState(false);
  const [isCsvViewerOpen, setIsCsvViewerOpen] = useState(false);
  const [isJsonViewerOpen, setIsJsonViewerOpen] = useState(false);
  const [isYamlViewerOpen, setIsYamlViewerOpen] = useState(false);
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [isPropertiesOpen, setIsPropertiesOpen] = useState(false);
  const [isNewItemOpen, setIsNewItemOpen] = useState(false);
  const [newItemType, setNewItemType] = useState<NewItemType>('file');

  // Pending file selection (for URL navigation that points to a file)
  const [pendingFileSelection, setPendingFileSelection] = useState<string | null>(null);

  // Status bar state
  const [itemCount, setItemCount] = useState(0);
  const [allItemsLoaded, setAllItemsLoaded] = useState(false);
  const [isLoadingItems, setIsLoadingItems] = useState(false);

  // Track if initial state has been restored
  const initialStateRestored = useRef(false);
  const previousProfile = useRef<string | null>(null);

  // Restore saved bucket/prefix when profile is restored
  useEffect(() => {
    if (profileRestored && currentProfile && !initialStateRestored.current) {
      initialStateRestored.current = true;
      // Load saved bucket/prefix for this profile
      window.electronAPI.appState.load().then(savedState => {
        // Only restore if the saved profile matches the current profile
        if (savedState.lastProfile === currentProfile && savedState.lastBucket) {
          setSelectedBucket(savedState.lastBucket);
          setCurrentPrefix(savedState.lastPrefix || '');
        }
      }).catch(err => {
        console.warn('Failed to restore navigation state:', err);
      });
    }
  }, [profileRestored, currentProfile]);

  // Reset navigation when profile changes (but not on initial restore)
  useEffect(() => {
    // Skip reset if this is the first profile set (during restoration)
    if (previousProfile.current === null && currentProfile !== null) {
      previousProfile.current = currentProfile;
      return;
    }
    // Reset only when profile actually changes after initial load
    if (previousProfile.current !== currentProfile) {
      previousProfile.current = currentProfile;
      setSelectedBucket(null);
      setCurrentPrefix('');
      setSelectedFile(null);
    }
  }, [currentProfile]);

  // Save state when profile/bucket/prefix changes (debounced)
  useEffect(() => {
    // Don't save until initial state is restored
    if (!profileRestored) return;

    const saveTimeout = setTimeout(() => {
      window.electronAPI.appState.save({
        lastProfile: currentProfile,
        lastBucket: selectedBucket,
        lastPrefix: currentPrefix,
      }).catch(err => {
        console.warn('Failed to save app state:', err);
      });
    }, 500); // Debounce 500ms to avoid too many writes

    return () => clearTimeout(saveTimeout);
  }, [profileRestored, currentProfile, selectedBucket, currentPrefix]);

  const handleSelectBucket = useCallback((bucket: string) => {
    setSelectedBucket(bucket);
    setCurrentPrefix('');
    setSelectedFile(null);
    setSelectedFiles([]);
  }, []);

  const handleNavigate = useCallback((prefix: string) => {
    setCurrentPrefix(prefix);
    setSelectedFile(null);
    setSelectedFiles([]);
    setPendingFileSelection(null);
  }, []);

  // Handler for URL-based navigation (from NavigationBar)
  const handleUrlNavigate = useCallback((bucket: string, prefix: string, selectKey?: string) => {
    setSelectedBucket(bucket);
    setCurrentPrefix(prefix);
    setSelectedFile(null);
    setSelectedFiles([]);
    // If a specific file key was provided, set it as pending selection
    setPendingFileSelection(selectKey || null);
    // Trigger refresh to load the new location
    window.dispatchEvent(new Event('s3-refresh-files'));
  }, []);

  const handleSelectFile = useCallback((file: S3Object | null) => {
    setSelectedFile(file);
  }, []);

  const handleSelectFiles = useCallback((files: S3Object[]) => {
    setSelectedFiles(files);
  }, []);

  // File operation handlers
  const handleUpload = useCallback(() => {
    if (!selectedBucket) return;
    uploadFiles(selectedBucket, currentPrefix).then(() => {
      // Trigger refresh after upload completes
      window.dispatchEvent(new Event('s3-refresh-files'));
    });
  }, [selectedBucket, currentPrefix, uploadFiles]);

  const handleDownload = useCallback(() => {
    if (!selectedBucket || !selectedFile || selectedFile.isPrefix) return;
    downloadFile(selectedBucket, selectedFile.key);
  }, [selectedBucket, selectedFile, downloadFile]);

  // Handler for double-click download from FileList
  const handleDownloadFile = useCallback((file: S3Object) => {
    if (!selectedBucket || file.isPrefix) return;
    downloadFile(selectedBucket, file.key);
  }, [selectedBucket, downloadFile]);

  const handleDelete = useCallback(() => {
    // Allow delete if there are selected items (files or folders)
    if (selectedFiles.length === 0) return;
    setIsDeleteOpen(true);
  }, [selectedFiles]);

  const handleConfirmDelete = useCallback(async () => {
    if (!selectedBucket || selectedFiles.length === 0) return;
    setIsDeleteOpen(false);

    // Separate folders and files
    const folders = selectedFiles.filter(f => f.isPrefix);
    const files = selectedFiles.filter(f => !f.isPrefix);

    let totalDeleted = 0;
    let totalFailed = 0;

    // Delete folders first (they contain nested objects)
    for (const folder of folders) {
      const result = await deletePrefix(selectedBucket, folder.key);
      totalDeleted += result.deletedCount;
      totalFailed += result.failedCount;
    }

    // Delete files
    if (files.length === 1) {
      const success = await deleteFile(selectedBucket, files[0].key);
      if (success) {
        totalDeleted++;
      } else {
        totalFailed++;
      }
    } else if (files.length > 1) {
      const keys = files.map(f => f.key);
      const result = await deleteFiles(selectedBucket, keys);
      totalDeleted += result.deletedCount;
      totalFailed += result.failedCount;
    }

    // Clear selection and refresh
    if (totalDeleted > 0) {
      setSelectedFile(null);
      setSelectedFiles([]);
      window.dispatchEvent(new Event('s3-refresh-files'));
    }

    // Show toast with results
    if (totalFailed > 0) {
      addToast({
        type: 'warning',
        title: 'Partial Delete',
        message: `Deleted ${totalDeleted} item(s), ${totalFailed} failed`,
        duration: 5000,
      });
    } else if (totalDeleted > 0) {
      addToast({
        type: 'success',
        title: 'Delete Complete',
        message: `Deleted ${totalDeleted} item(s)`,
        duration: 3000,
      });
    }
  }, [selectedBucket, selectedFiles, deleteFile, deleteFiles, deletePrefix, addToast]);

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

  const handleViewCsv = useCallback(() => {
    if (!selectedFile || selectedFile.isPrefix) return;
    setIsCsvViewerOpen(true);
  }, [selectedFile]);

  const handleCsvViewerClose = useCallback(() => {
    setIsCsvViewerOpen(false);
  }, []);

  const handleViewJson = useCallback(() => {
    if (!selectedFile || selectedFile.isPrefix) return;
    setIsJsonViewerOpen(true);
  }, [selectedFile]);

  const handleJsonViewerClose = useCallback(() => {
    setIsJsonViewerOpen(false);
  }, []);

  const handleViewYaml = useCallback(() => {
    if (!selectedFile || selectedFile.isPrefix) return;
    setIsYamlViewerOpen(true);
  }, [selectedFile]);

  const handleYamlViewerClose = useCallback(() => {
    setIsYamlViewerOpen(false);
  }, []);

  const handleViewImage = useCallback(() => {
    if (!selectedFile || selectedFile.isPrefix) return;
    setIsImagePreviewOpen(true);
  }, [selectedFile]);

  const handleImagePreviewClose = useCallback(() => {
    setIsImagePreviewOpen(false);
  }, []);

  const handleProperties = useCallback(() => {
    if (!selectedFile) return;
    setIsPropertiesOpen(true);
  }, [selectedFile]);

  const handlePropertiesClose = useCallback(() => {
    setIsPropertiesOpen(false);
  }, []);

  const handleCopyUrl = useCallback(async () => {
    if (!selectedBucket || !selectedFile || selectedFile.isPrefix) return;

    const s3Url = `s3://${selectedBucket}/${selectedFile.key}`;
    try {
      await navigator.clipboard.writeText(s3Url);
      addToast({
        type: 'success',
        title: 'URL Copied',
        message: s3Url,
        duration: 3000,
      });
    } catch (err) {
      console.error('Failed to copy URL to clipboard:', err);
      addToast({
        type: 'error',
        title: 'Copy Failed',
        message: 'Failed to copy URL to clipboard',
        duration: 5000,
      });
    }
  }, [selectedBucket, selectedFile, addToast]);

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

  const handleNewFile = useCallback(() => {
    setNewItemType('file');
    setIsNewItemOpen(true);
  }, []);

  const handleNewFolder = useCallback(() => {
    setNewItemType('folder');
    setIsNewItemOpen(true);
  }, []);

  const handleConfirmNewItem = useCallback(
    async (name: string) => {
      if (!selectedBucket) return;
      setIsNewItemOpen(false);

      const key = currentPrefix ? `${currentPrefix}${name}` : name;

      let result;
      if (newItemType === 'file') {
        result = await window.electronAPI.s3.createFile(selectedBucket, key);
      } else {
        result = await window.electronAPI.s3.createFolder(selectedBucket, key);
      }

      if (result.success) {
        addToast({
          type: 'success',
          title: newItemType === 'file' ? 'File Created' : 'Folder Created',
          message: name,
          duration: 3000,
        });
        // Refresh the file list
        window.dispatchEvent(new Event('s3-refresh-files'));
        // Set pending selection to auto-select the new item
        const newKey = newItemType === 'folder' ? (key.endsWith('/') ? key : `${key}/`) : key;
        setPendingFileSelection(newKey);
      } else {
        addToast({
          type: 'error',
          title: 'Creation Failed',
          message: result.error || 'Unknown error',
          duration: 5000,
        });
      }
    },
    [selectedBucket, currentPrefix, newItemType, addToast]
  );

  const handlePendingFileSelectionHandled = useCallback(() => {
    setPendingFileSelection(null);
  }, []);

  const handleItemCountChange = useCallback(
    (count: number, allLoaded: boolean, loading: boolean) => {
      setItemCount(count);
      setAllItemsLoaded(allLoaded);
      setIsLoadingItems(loading);
    },
    []
  );

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
    <ErrorBoundary>
      <div className="app">
        <NetworkStatusBanner />
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
            {selectedFiles.length > 1 ? (
              <div className="selected-file-info">
                <span className="selected-label">Selected:</span>
                <span className="selected-name selected-count">
                  {selectedFiles.length} files
                </span>
              </div>
            ) : selectedFile && (
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
            selectedCount={selectedFiles.length}
            onUpload={handleUpload}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onRename={handleRename}
            onEdit={handleEdit}
            onViewParquet={handleViewParquet}
            onViewCsv={handleViewCsv}
            onViewJson={handleViewJson}
            onViewYaml={handleViewYaml}
            onViewImage={handleViewImage}
            onCopyUrl={handleCopyUrl}
            onRefresh={handleRefresh}
            onProperties={handleProperties}
            onNewFile={handleNewFile}
            onNewFolder={handleNewFolder}
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
              selectedFiles={selectedFiles}
              onSelectFiles={handleSelectFiles}
              onFilesDropped={handleFilesDropped}
              pendingFileSelection={pendingFileSelection}
              onPendingFileSelectionHandled={handlePendingFileSelectionHandled}
              onItemCountChange={handleItemCountChange}
              onDownloadFile={handleDownloadFile}
            />
          </div>
          <StatusBar
            loadedCount={itemCount}
            allLoaded={allItemsLoaded}
            selectedFiles={selectedFiles}
            loading={isLoadingItems}
          />
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
        fileNames={selectedFiles.map(f => {
          const name = f.key.split('/').filter(Boolean).pop() || '';
          return f.isPrefix ? `${name}/` : name;
        })}
        hasFolders={selectedFiles.some(f => f.isPrefix)}
        onConfirm={handleConfirmDelete}
        onCancel={() => setIsDeleteOpen(false)}
      />
      <NewItemDialog
        isOpen={isNewItemOpen}
        itemType={newItemType}
        currentPrefix={currentPrefix}
        onConfirm={handleConfirmNewItem}
        onCancel={() => setIsNewItemOpen(false)}
      />
      {selectedBucket && selectedFile && (
        <PropertiesDialog
          isOpen={isPropertiesOpen}
          bucket={selectedBucket}
          fileKey={selectedFile.key}
          isFolder={selectedFile.isPrefix}
          onClose={handlePropertiesClose}
        />
      )}

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

      {/* CSV Viewer */}
      {isCsvViewerOpen && selectedBucket && selectedFile && (
        <CsvViewer
          bucket={selectedBucket}
          fileKey={selectedFile.key}
          fileName={selectedFile.key.split('/').pop() || selectedFile.key}
          fileSize={selectedFile.size}
          onClose={handleCsvViewerClose}
        />
      )}

      {/* JSON Viewer */}
      {isJsonViewerOpen && selectedBucket && selectedFile && (
        <JsonViewer
          bucket={selectedBucket}
          fileKey={selectedFile.key}
          fileName={selectedFile.key.split('/').pop() || selectedFile.key}
          fileSize={selectedFile.size}
          onClose={handleJsonViewerClose}
        />
      )}

      {/* YAML Viewer */}
      {isYamlViewerOpen && selectedBucket && selectedFile && (
        <YamlViewer
          bucket={selectedBucket}
          fileKey={selectedFile.key}
          fileName={selectedFile.key.split('/').pop() || selectedFile.key}
          fileSize={selectedFile.size}
          onClose={handleYamlViewerClose}
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

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
      </div>
    </ErrorBoundary>
  );
}

export default App;
