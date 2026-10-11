import type { ListObjectsResult, S3Bucket } from '../hooks/useS3';

export const LIST_BUCKETS_FALLBACK = 'Failed to list buckets';
export const LIST_OBJECTS_FALLBACK = 'Failed to list objects';
export const OBJECTS_PAGE_SIZE = 100;

export interface ListBucketsResponse {
  success: boolean;
  buckets?: S3Bucket[];
  error?: string;
}

export interface ListObjectsResponse {
  success: boolean;
  result?: ListObjectsResult;
  error?: string;
}

export interface BucketsOutcome {
  buckets: S3Bucket[];
  error: string | null;
}

export interface ObjectsRequest {
  bucket: string;
  prefix: string;
  delimiter: string;
  maxKeys: number;
  continuationToken: string | undefined;
}

/** Message of a thrown value, or the fallback when it is not an Error. */
export function errorMessageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Turns a listBuckets response into the buckets and error state to display. */
export function resolveBucketsOutcome(response: ListBucketsResponse): BucketsOutcome {
  if (!response.success) {
    return { buckets: [], error: response.error ?? LIST_BUCKETS_FALLBACK };
  }
  return { buckets: response.buckets ?? [], error: null };
}

/** Builds the listObjects request; a reset starts from the first page. */
export function buildObjectsRequest(
  bucket: string,
  prefix: string,
  reset: boolean,
  continuationToken: string | undefined
): ObjectsRequest {
  return {
    bucket,
    prefix,
    delimiter: '/',
    maxKeys: OBJECTS_PAGE_SIZE,
    continuationToken: reset ? undefined : continuationToken,
  };
}
