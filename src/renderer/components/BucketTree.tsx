import React, { useEffect, useState, useCallback } from 'react';

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
      <ul className="bucket-list" role="tree">
        {treeNodes.map((node) => (
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
    </div>
  );
}

export default BucketTree;
