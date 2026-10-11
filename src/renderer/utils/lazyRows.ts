/** Number of rows appended each time the user scrolls near the bottom of a table viewer. */
export const ROWS_PER_BATCH = 100;

/** Distance from the bottom (px) at which the next batch of rows is requested. */
export const LOAD_MORE_THRESHOLD_PX = 200;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** True when the scroll position is within the threshold of the bottom edge. */
export function isNearBottom(
  { scrollTop, scrollHeight, clientHeight }: ScrollMetrics,
  threshold: number = LOAD_MORE_THRESHOLD_PX
): boolean {
  return scrollHeight - scrollTop - clientHeight < threshold;
}

export interface LoadMoreInput {
  /** Scroll metrics of the table container, or null when it is not mounted. */
  metrics: ScrollMetrics | null;
  loadingMore: boolean;
  hasData: boolean;
  displayedCount: number;
  totalCount: number;
}

/** Decides whether a scroll event should append another batch of rows. */
export function shouldLoadMore(input: LoadMoreInput): boolean {
  const { metrics, loadingMore, hasData, displayedCount, totalCount } = input;
  if (!metrics || loadingMore || !hasData) return false;
  if (!isNearBottom(metrics)) return false;
  return displayedCount < totalCount;
}

/** The slice of rows that follows the already displayed ones. */
export function nextRowBatch<T>(
  allRows: readonly T[],
  displayedCount: number,
  batchSize: number = ROWS_PER_BATCH
): T[] {
  return allRows.slice(displayedCount, displayedCount + batchSize);
}
