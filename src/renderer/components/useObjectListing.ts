import { useCallback, useEffect, useRef, useState } from 'react';
import type { S3Object } from './FileList';

/** One loaded listing, tagged with the location it belongs to so stale results are never shown. */
interface Listing {
  location: string;
  items: S3Object[];
  hasMore: boolean;
  error: string | null;
  token: string | undefined;
}

type PageResult =
  | { ok: true; items: S3Object[]; token: string | undefined; hasMore: boolean }
  | { ok: false; error: string };

const NO_ITEMS: S3Object[] = [];

/** Fetch one page of objects; never throws and never touches component state. */
async function fetchObjectsPage(
  bucket: string,
  prefix: string,
  continuationToken: string | undefined
): Promise<PageResult> {
  try {
    const result = await window.electronAPI.s3.listObjects({
      bucket,
      prefix,
      delimiter: '/',
      maxKeys: 100,
      continuationToken,
    });
    if (!result.success) {
      return { ok: false, error: result.error ?? 'Failed to list objects' };
    }
    const data = result.result!;
    // Prefixes first. S3 paginates over the underlying key space, so CommonPrefixes
    // (folders) can appear on any page.
    return {
      ok: true,
      items: [...data.prefixes, ...data.objects],
      token: data.continuationToken,
      hasMore: data.isTruncated,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to list objects' };
  }
}

function firstPageListing(location: string, page: PageResult): Listing {
  return page.ok
    ? { location, items: page.items, hasMore: page.hasMore, error: null, token: page.token }
    : { location, items: [], hasMore: false, error: page.error, token: undefined };
}

/** Append a page to a listing, deduplicating (a prefix group can span pages). */
function appendPage(listing: Listing, page: PageResult): Listing {
  if (!page.ok) return { ...listing, error: page.error };
  const existingKeys = new Set(listing.items.map((item) => item.key));
  const newItems = page.items.filter((item) => !existingKeys.has(item.key));
  return {
    ...listing,
    items: [...listing.items, ...newItems],
    hasMore: page.hasMore,
    error: null,
    token: page.token,
  };
}

export interface ObjectListing {
  items: S3Object[];
  /** First page of the current location has not arrived yet. */
  loading: boolean;
  /** First page of the current location has arrived (successfully or not). */
  loaded: boolean;
  error: string | null;
  hasMore: boolean;
  /** A page requested by scrolling is in flight. */
  loadingMore: boolean;
  /** Load the next page on user request (sets loadingMore). */
  loadMore: () => void;
  /** Load the next page without touching loadingMore (safe to call from an effect). */
  fetchNextPage: () => Promise<void>;
  /** Discard the listing and fetch the current location again. */
  reload: () => void;
}

/**
 * Paginated object listing for profile/bucket/prefix. The listing is only valid for the location
 * it was fetched for, so loading, items, error and hasMore are derived from it and navigating
 * needs no synchronous state reset; state is only set after a fetch resolves.
 */
export function useObjectListing(
  profile: string | null,
  bucket: string | null,
  prefix: string
): ObjectListing {
  // Bumped to force a reload of the current location (refresh event, Retry).
  const [reloadToken, setReloadToken] = useState(0);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const inFlightRef = useRef<string | null>(null);

  const location = profile && bucket ? `${profile}|${bucket}|${prefix}|${reloadToken}` : null;
  const current = listing !== null && listing.location === location ? listing : null;

  useEffect(() => {
    if (location === null || !bucket) return;
    let stale = false;
    fetchObjectsPage(bucket, prefix, undefined).then((page) => {
      if (!stale) setListing(firstPageListing(location, page));
    });
    return () => {
      stale = true;
    };
  }, [location, bucket, prefix]);

  const fetchNextPage = useCallback(async () => {
    if (current === null || !bucket || !current.hasMore) return;
    const loc = current.location;
    if (inFlightRef.current === loc) return;
    inFlightRef.current = loc;
    const page = await fetchObjectsPage(bucket, prefix, current.token);
    if (inFlightRef.current === loc) inFlightRef.current = null;
    setListing((prev) => (prev !== null && prev.location === loc ? appendPage(prev, page) : prev));
  }, [current, bucket, prefix]);

  const loadMore = useCallback(() => {
    if (loadingMore) return;
    setLoadingMore(true);
    fetchNextPage().finally(() => setLoadingMore(false));
  }, [loadingMore, fetchNextPage]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return {
    items: current?.items ?? NO_ITEMS,
    loading: location !== null && current === null,
    loaded: current !== null,
    error: current?.error ?? null,
    hasMore: current?.hasMore ?? false,
    loadingMore,
    loadMore,
    fetchNextPage,
    reload,
  };
}
