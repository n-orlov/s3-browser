import React from 'react';

function App(): React.ReactElement {
  return (
    <div className="app">
      <header className="app-header">
        <h1>S3 Browser</h1>
        <p>Lightweight S3 File Manager</p>
      </header>
      <main className="app-main">
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>Buckets</h2>
          </div>
          <div className="tree-view">
            {/* Bucket tree will go here */}
            <p className="placeholder">Select a profile to view buckets</p>
          </div>
        </aside>
        <section className="content">
          <div className="content-header">
            <h2>Files</h2>
          </div>
          <div className="file-list">
            {/* File list will go here */}
            <p className="placeholder">Select a bucket to view files</p>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
