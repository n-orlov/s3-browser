import React, { useState, useCallback, useEffect } from 'react';
import ProfileSelector from './components/ProfileSelector';
import BucketTree from './components/BucketTree';
import FileList, { type S3Object } from './components/FileList';
import { useAwsProfiles } from './hooks/useAwsProfiles';

function App(): React.ReactElement {
  const { currentProfile } = useAwsProfiles();

  // Navigation state
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [currentPrefix, setCurrentPrefix] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<S3Object | null>(null);

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
          <div className="file-list">
            <FileList
              currentProfile={currentProfile}
              selectedBucket={selectedBucket}
              currentPrefix={currentPrefix}
              onNavigate={handleNavigate}
              onSelectFile={handleSelectFile}
              selectedFile={selectedFile}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
