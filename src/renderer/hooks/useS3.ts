import { useState, useCallback, useRef } from 'react';

export interface S3Bucket {
  name: string;
  creationDate?: Date;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified?: Date;
  etag?: string;
  storageClass?: string;
  isPrefix: boolean;
}

export interface ListObjectsResult {
  objects: S3Object[];
  prefixes: S3Object[];
  continuationToken?: string;
  isTruncated: boolean;
  prefix: string;
  keyCount: number;
}

export interface UseS3Result {
  buckets: S3Bucket[];
  bucketsLoading: boolean;
  bucketsError: string | null;
  loadBuckets: () => Promise<void>;
  objects: S3Object[];
  prefixes: S3Object[];
  objectsLoading: boolean;
  objectsError: string | null;
  hasMore: boolean;
  loadObjects: (bucket: string, prefix: string, reset?: boolean) => Promise<void>;
  loadMoreObjects: () => Promise<void>;
}

export function useS3(currentProfile: string | null): UseS3Result {
  const [buckets, setBuckets] = useState<S3Bucket[]>([]);
  const [bucketsLoading, setBucketsLoading] = useState(false);
  const [bucketsError, setBucketsError] = useState<string | null>(null);

  const [objects, setObjects] = useState<S3Object[]>([]);
  const [prefixes, setPrefixes] = useState<S3Object[]>([]);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Track current list context for pagination
  const currentBucketRef = useRef<string>('');
  const currentPrefixRef = useRef<string>('');
  const continuationTokenRef = useRef<string | undefined>(undefined);

  const loadBuckets = useCallback(async () => {
    if (!currentProfile) {
      setBucketsError('No profile selected');
      return;
    }

    try {
      setBucketsLoading(true);
      setBucketsError(null);
      const result = await window.electronAPI.s3.listBuckets();

      if (!result.success) {
        setBucketsError(result.error ?? 'Failed to list buckets');
        setBuckets([]);
        return;
      }

      setBuckets(result.buckets ?? []);
    } catch (err) {
      setBucketsError(err instanceof Error ? err.message : 'Failed to list buckets');
      setBuckets([]);
    } finally {
      setBucketsLoading(false);
    }
  }, [currentProfile]);

  const loadObjects = useCallback(
    async (bucket: string, prefix: string, reset = true) => {
      if (!currentProfile) {
        setObjectsError('No profile selected');
        return;
      }

      try {
        setObjectsLoading(true);
        setObjectsError(null);

        if (reset) {
          setObjects([]);
          setPrefixes([]);
          continuationTokenRef.current = undefined;
        }

        currentBucketRef.current = bucket;
        currentPrefixRef.current = prefix;

        const result = await window.electronAPI.s3.listObjects({
          bucket,
          prefix,
          delimiter: '/',
          maxKeys: 100,
          continuationToken: reset ? undefined : continuationTokenRef.current,
        });

        if (!result.success) {
          setObjectsError(result.error ?? 'Failed to list objects');
          return;
        }

        const data = result.result!;
        continuationTokenRef.current = data.continuationToken;
        setHasMore(data.isTruncated);

        if (reset) {
          setPrefixes(data.prefixes);
          setObjects(data.objects);
        } else {
          // Append for pagination - prefixes typically come in first page only
          setObjects((prev) => [...prev, ...data.objects]);
        }
      } catch (err) {
        setObjectsError(err instanceof Error ? err.message : 'Failed to list objects');
      } finally {
        setObjectsLoading(false);
      }
    },
    [currentProfile]
  );

  const loadMoreObjects = useCallback(async () => {
    if (!hasMore || objectsLoading) return;
    await loadObjects(currentBucketRef.current, currentPrefixRef.current, false);
  }, [hasMore, objectsLoading, loadObjects]);

  return {
    buckets,
    bucketsLoading,
    bucketsError,
    loadBuckets,
    objects,
    prefixes,
    objectsLoading,
    objectsError,
    hasMore,
    loadObjects,
    loadMoreObjects,
  };
}
