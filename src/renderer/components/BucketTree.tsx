import React, { useEffect, useState, useCallback, useMemo } from 'react';

export interface S3Bucket {
  name: string;
  creationDate?: Date;
}

export interface BucketTreeProps {
  currentProfile: string | null;
  selectedBucket: string | null;
  onSelectBucket: (bucket: string) => void;
}

interface TreeNode {
  name: string;
  type: 'bucket';
  expanded: boolean;
}

function BucketTree({
  currentProfile,
  selectedBucket,
  onSelectBucket,
}: BucketTreeProps): React.ReactElement {
  const [buckets, setBuckets] = useState<S3Bucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [filterText, setFilterText] = useState('');

  const loadBuckets = useCallback(async () => {
    if (!currentProfile) {
      setBuckets([]);
      setTreeNodes([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = await window.electronAPI.s3.listBuckets();

      if (!result.success) {
        setError(result.error ?? 'Failed to list buckets');
        setBuckets([]);
        setTreeNodes([]);
        return;
      }

      const bucketList = result.buckets ?? [];
      setBuckets(bucketList);
      setTreeNodes(
        bucketList.map((b) => ({
          name: b.name,
          type: 'bucket' as const,
          expanded: false,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list buckets');
      setBuckets([]);
      setTreeNodes([]);
    } finally {
      setLoading(false);
    }
  }, [currentProfile]);

  useEffect(() => {
    loadBuckets();
  }, [loadBuckets]);

  const handleBucketClick = (bucketName: string) => {
    onSelectBucket(bucketName);
  };

  // Filter buckets using case-insensitive contains logic
  const filteredNodes = useMemo(() => {
    if (!filterText.trim()) {
      return treeNodes;
    }
    const lowerFilter = filterText.toLowerCase();
    return treeNodes.filter((node) => node.name.toLowerCase().includes(lowerFilter));
  }, [treeNodes, filterText]);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilterText(e.target.value);
  };

  const handleClearFilter = () => {
    setFilterText('');
  };

  if (!currentProfile) {
    return (
      <div className="bucket-tree">
        <p className="bucket-tree-placeholder">Select a profile to view buckets</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bucket-tree">
        <div className="bucket-tree-loading">
          <span className="loading-spinner"></span>
          <span>Loading buckets...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bucket-tree">
        <div className="bucket-tree-error">
          <span className="error-icon">!</span>
          <span>{error}</span>
          <button className="retry-btn" onClick={loadBuckets}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (buckets.length === 0) {
    return (
      <div className="bucket-tree">
        <p className="bucket-tree-placeholder">No buckets found</p>
      </div>
    );
  }

  return (
    <div className="bucket-tree">
      <div className="bucket-filter">
        <div className="bucket-filter-wrapper">
          <span className="bucket-filter-icon">🔍</span>
          <input
            type="text"
            className="bucket-filter-input"
            placeholder="Filter buckets (contains)..."
            value={filterText}
            onChange={handleFilterChange}
            aria-label="Filter buckets"
          />
          {filterText && (
            <button
              className="bucket-filter-clear"
              onClick={handleClearFilter}
              aria-label="Clear filter"
              title="Clear filter"
            >
              ×
            </button>
          )}
        </div>
        <div className="bucket-filter-hint">
          {filterText ? (
            <span>
              {filteredNodes.length} of {treeNodes.length} buckets
            </span>
          ) : (
            <span>{treeNodes.length} buckets</span>
          )}
        </div>
      </div>
      <ul className="bucket-list" role="tree">
        {filteredNodes.map((node) => (
          <li
            key={node.name}
            className={`bucket-item ${selectedBucket === node.name ? 'selected' : ''}`}
            role="treeitem"
            aria-selected={selectedBucket === node.name}
            onClick={() => handleBucketClick(node.name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleBucketClick(node.name);
              }
            }}
            tabIndex={0}
          >
            <span className="bucket-icon">📦</span>
            <span className="bucket-name" title={node.name}>
              {node.name}
            </span>
          </li>
        ))}
      </ul>
      {filteredNodes.length === 0 && filterText && (
        <p className="bucket-tree-placeholder">No matching buckets</p>
      )}
    </div>
  );
}

export default BucketTree;
