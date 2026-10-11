import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useS3, type ListObjectsResult, type S3Object } from '../renderer/hooks/useS3';

const s3 = () => window.electronAPI.s3 as unknown as {
  listBuckets: ReturnType<typeof vi.fn>;
  listObjects: ReturnType<typeof vi.fn>;
};

const obj = (key: string): S3Object => ({ key, size: 1, isPrefix: false });
const folder = (key: string): S3Object => ({ key, size: 0, isPrefix: true });

function page(overrides: Partial<ListObjectsResult> = {}): { success: true; result: ListObjectsResult } {
  return {
    success: true,
    result: {
      objects: [],
      prefixes: [],
      continuationToken: undefined,
      isTruncated: false,
      prefix: '',
      keyCount: 0,
      ...overrides,
    },
  };
}

describe('useS3', () => {
  beforeEach(() => {
    s3().listBuckets.mockReset();
    s3().listObjects.mockReset();
  });

  describe('loadBuckets', () => {
    it('reports an error and does not call the API without a profile', async () => {
      const { result } = renderHook(() => useS3(null));
      await act(() => result.current.loadBuckets());
      expect(result.current.bucketsError).toBe('No profile selected');
      expect(s3().listBuckets).not.toHaveBeenCalled();
    });

    it('stores the buckets and clears loading on success', async () => {
      s3().listBuckets.mockResolvedValue({ success: true, buckets: [{ name: 'a' }, { name: 'b' }] });
      const { result } = renderHook(() => useS3('dev'));
      await act(() => result.current.loadBuckets());
      expect(result.current.buckets).toEqual([{ name: 'a' }, { name: 'b' }]);
      expect(result.current.bucketsError).toBeNull();
      expect(result.current.bucketsLoading).toBe(false);
    });

    it('is loading while the request is pending', async () => {
      let resolve: (v: unknown) => void = () => {};
      s3().listBuckets.mockReturnValue(new Promise((r) => (resolve = r)));
      const { result } = renderHook(() => useS3('dev'));
      let pending: Promise<void> = Promise.resolve();
      act(() => {
        pending = result.current.loadBuckets();
      });
      expect(result.current.bucketsLoading).toBe(true);
      await act(async () => {
        resolve({ success: true, buckets: [] });
        await pending;
      });
      expect(result.current.bucketsLoading).toBe(false);
    });

    it.each([
      ['the error from the response', { success: false, error: 'denied' }, 'denied'],
      ['a fallback when the response has no error', { success: false }, 'Failed to list buckets'],
    ])('shows %s and empties the list', async (_name, response, expected) => {
      s3().listBuckets.mockResolvedValueOnce({ success: true, buckets: [{ name: 'old' }] });
      const { result } = renderHook(() => useS3('dev'));
      await act(() => result.current.loadBuckets());
      s3().listBuckets.mockResolvedValueOnce(response);
      await act(() => result.current.loadBuckets());
      expect(result.current.bucketsError).toBe(expected);
      expect(result.current.buckets).toEqual([]);
      expect(result.current.bucketsLoading).toBe(false);
    });

    it.each([
      ['an Error message', new Error('network down'), 'network down'],
      ['a fallback for a non-Error rejection', 'weird', 'Failed to list buckets'],
    ])('shows %s when the call rejects', async (_name, rejection, expected) => {
      s3().listBuckets.mockRejectedValue(rejection);
      const { result } = renderHook(() => useS3('dev'));
      await act(() => result.current.loadBuckets());
      expect(result.current.bucketsError).toBe(expected);
      expect(result.current.buckets).toEqual([]);
      expect(result.current.bucketsLoading).toBe(false);
    });
  });

  describe('loadObjects', () => {
    it('reports an error and does not call the API without a profile', async () => {
      const { result } = renderHook(() => useS3(null));
      await act(() => result.current.loadObjects('b', ''));
      expect(result.current.objectsError).toBe('No profile selected');
      expect(s3().listObjects).not.toHaveBeenCalled();
    });

    it('requests the first page and stores objects, prefixes and hasMore', async () => {
      s3().listObjects.mockResolvedValue(
        page({ objects: [obj('a/1')], prefixes: [folder('a/sub/')], isTruncated: true, continuationToken: 't1' })
      );
      const { result } = renderHook(() => useS3('dev'));
      await act(() => result.current.loadObjects('bkt', 'a/'));
      expect(s3().listObjects).toHaveBeenCalledWith({
        bucket: 'bkt',
        prefix: 'a/',
        delimiter: '/',
        maxKeys: 100,
        continuationToken: undefined,
      });
      expect(result.current.objects).toEqual([obj('a/1')]);
      expect(result.current.prefixes).toEqual([folder('a/sub/')]);
      expect(result.current.hasMore).toBe(true);
      expect(result.current.objectsError).toBeNull();
      expect(result.current.objectsLoading).toBe(false);
    });

    it('loadMoreObjects appends the next page using the continuation token', async () => {
      s3().listObjects
        .mockResolvedValueOnce(
          page({ objects: [obj('1')], prefixes: [folder('p/')], isTruncated: true, continuationToken: 't1' })
        )
        .mockResolvedValueOnce(page({ objects: [obj('2')], isTruncated: false }));
      const { result } = renderHook(() => useS3('dev'));
      await act(() => result.current.loadObjects('bkt', ''));
      await act(() => result.current.loadMoreObjects());
      expect(s3().listObjects).toHaveBeenLastCalledWith({
        bucket: 'bkt',
        prefix: '',
        delimiter: '/',
        maxKeys: 100,
        continuationToken: 't1',
      });
      expect(result.current.objects).toEqual([obj('1'), obj('2')]);
      expect(result.current.prefixes).toEqual([folder('p/')]);
      expect(result.current.hasMore).toBe(false);
    });

    it('loadMoreObjects does nothing when there are no more pages', async () => {
      s3().listObjects.mockResolvedValue(page({ objects: [obj('1')] }));
      const { result } = renderHook(() => useS3('dev'));
      await act(() => result.current.loadObjects('bkt', ''));
      await act(() => result.current.loadMoreObjects());
      expect(s3().listObjects).toHaveBeenCalledTimes(1);
    });

    it('a reset load replaces earlier results and drops the old token', async () => {
      s3().listObjects
        .mockResolvedValueOnce(page({ objects: [obj('old')], isTruncated: true, continuationToken: 't1' }))
        .mockResolvedValueOnce(page({ objects: [obj('new')] }));
      const { result } = renderHook(() => useS3('dev'));
      await act(() => result.current.loadObjects('b1', ''));
      await act(() => result.current.loadObjects('b2', 'x/'));
      expect(s3().listObjects).toHaveBeenLastCalledWith(
        expect.objectContaining({ bucket: 'b2', prefix: 'x/', continuationToken: undefined })
      );
      expect(result.current.objects).toEqual([obj('new')]);
      expect(result.current.hasMore).toBe(false);
    });

    it('a failed reset load clears previous results and shows the error', async () => {
      s3().listObjects
        .mockResolvedValueOnce(page({ objects: [obj('old')], prefixes: [folder('p/')] }))
        .mockResolvedValueOnce({ success: false, error: 'no access' });
      const { result } = renderHook(() => useS3('dev'));
      await act(() => result.current.loadObjects('b', ''));
      await act(() => result.current.loadObjects('b', 'q/'));
      expect(result.current.objectsError).toBe('no access');
      expect(result.current.objects).toEqual([]);
      expect(result.current.prefixes).toEqual([]);
      expect(result.current.objectsLoading).toBe(false);
    });

    it('falls back to a generic message when the failure has no error text', async () => {
      s3().listObjects.mockResolvedValue({ success: false });
      const { result } = renderHook(() => useS3('dev'));
      await act(() => result.current.loadObjects('b', ''));
      expect(result.current.objectsError).toBe('Failed to list objects');
    });

    it.each([
      ['an Error message', new Error('timeout'), 'timeout'],
      ['a fallback for a non-Error rejection', 42, 'Failed to list objects'],
    ])('shows %s when the call rejects', async (_name, rejection, expected) => {
      s3().listObjects.mockRejectedValue(rejection);
      const { result } = renderHook(() => useS3('dev'));
      await act(() => result.current.loadObjects('b', ''));
      expect(result.current.objectsError).toBe(expected);
      expect(result.current.objectsLoading).toBe(false);
    });

    it('is loading while the request is pending and ignores loadMoreObjects meanwhile', async () => {
      let resolve: (v: unknown) => void = () => {};
      s3().listObjects.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      const { result } = renderHook(() => useS3('dev'));
      let pending: Promise<void> = Promise.resolve();
      act(() => {
        pending = result.current.loadObjects('b', '');
      });
      expect(result.current.objectsLoading).toBe(true);
      await act(() => result.current.loadMoreObjects());
      expect(s3().listObjects).toHaveBeenCalledTimes(1);
      await act(async () => {
        resolve(page());
        await pending;
      });
      expect(result.current.objectsLoading).toBe(false);
    });
  });
});
