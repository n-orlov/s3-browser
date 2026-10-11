import { useCallback, useEffect, useState } from 'react';
import type { S3Object } from './FileList';
import type { ObjectListing } from './useObjectListing';

interface PendingFileSelectionOptions {
  listing: ObjectListing;
  pendingFileSelection: string | null | undefined;
  onSelectFile: (file: S3Object | null) => void;
  onPendingFileSelectionHandled?: () => void;
  /** Scroll the row with this key into view once it is selected. */
  scrollToFile: (key: string) => void;
}

export interface PendingFileSelection {
  /** More pages are being loaded to find the pending file. */
  isSearching: boolean;
  /** The pending file's key (empty when none). */
  targetKey: string;
  cancel: () => void;
}

/**
 * Selects `pendingFileSelection` once it is loaded, fetching further pages while it is missing.
 * The search overlay state is derived from the listing, so nothing is set inside the effect.
 */
export function usePendingFileSelection({
  listing,
  pendingFileSelection,
  onSelectFile,
  onPendingFileSelectionHandled,
  scrollToFile,
}: PendingFileSelectionOptions): PendingFileSelection {
  const { items, loaded, hasMore, error, fetchNextPage } = listing;
  const targetKey = pendingFileSelection ?? '';

  // Pending selection the user cancelled; forgotten once that selection is gone (adjusting
  // state during render, not in an effect).
  const [cancelledKey, setCancelledKey] = useState<string | null>(null);
  if (cancelledKey !== null && cancelledKey !== pendingFileSelection) {
    setCancelledKey(null);
  }
  const cancelled = targetKey !== '' && cancelledKey === targetKey;
  const found = targetKey !== '' && items.some((item) => item.key === targetKey);

  useEffect(() => {
    // Skip if no pending selection, the location's first page has not finished loading, or
    // the search was cancelled
    if (targetKey === '' || !loaded || cancelled) return;

    const fileToSelect = items.find((item) => item.key === targetKey);
    if (fileToSelect) {
      // File found! Select it and scroll to it after a brief delay to let the DOM update
      onSelectFile(fileToSelect);
      onPendingFileSelectionHandled?.();
      setTimeout(() => scrollToFile(fileToSelect.key), 100);
    } else if (hasMore && !error) {
      // Not found yet: fetch the next page and look again
      fetchNextPage();
    } else {
      // No more items to load (or listing failed), file not found
      onPendingFileSelectionHandled?.();
    }
  }, [
    targetKey,
    items,
    loaded,
    cancelled,
    hasMore,
    error,
    onSelectFile,
    onPendingFileSelectionHandled,
    fetchNextPage,
    scrollToFile,
  ]);

  const cancel = useCallback(() => {
    setCancelledKey(pendingFileSelection ?? null);
    onPendingFileSelectionHandled?.();
  }, [pendingFileSelection, onPendingFileSelectionHandled]);

  const isSearching = targetKey !== '' && loaded && !cancelled && hasMore && !error && !found;
  return { isSearching, targetKey, cancel };
}
