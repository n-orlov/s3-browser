import { describe, it, expect } from 'vitest';
import {
  isNearBottom,
  shouldLoadMore,
  nextRowBatch,
  ROWS_PER_BATCH,
  type LoadMoreInput,
} from '../renderer/utils/lazyRows';

describe('isNearBottom', () => {
  it.each([
    { scrollTop: 0, scrollHeight: 1000, clientHeight: 400, expected: false },
    { scrollTop: 399, scrollHeight: 1000, clientHeight: 400, expected: false },
    { scrollTop: 400, scrollHeight: 1000, clientHeight: 400, expected: false }, // exactly 200 away
    { scrollTop: 401, scrollHeight: 1000, clientHeight: 400, expected: true },
    { scrollTop: 600, scrollHeight: 1000, clientHeight: 400, expected: true },
  ])(
    'scrollTop $scrollTop of $scrollHeight/$clientHeight -> $expected',
    ({ expected, ...metrics }) => {
      expect(isNearBottom(metrics)).toBe(expected);
    }
  );

  it('honours a custom threshold', () => {
    const metrics = { scrollTop: 0, scrollHeight: 500, clientHeight: 400 };
    expect(isNearBottom(metrics, 50)).toBe(false);
    expect(isNearBottom(metrics, 101)).toBe(true);
  });
});

describe('shouldLoadMore', () => {
  const nearBottom = { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 };
  const base: LoadMoreInput = {
    metrics: nearBottom,
    loadingMore: false,
    hasData: true,
    displayedCount: 100,
    totalCount: 250,
  };

  it.each<[string, Partial<LoadMoreInput>, boolean]>([
    ['near the bottom with rows remaining', {}, true],
    ['container not mounted', { metrics: null }, false],
    ['a batch is already loading', { loadingMore: true }, false],
    ['no data parsed yet', { hasData: false }, false],
    ['far from the bottom', { metrics: { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 } }, false],
    ['all rows already displayed', { displayedCount: 250 }, false],
    ['more displayed than total', { displayedCount: 300 }, false],
    ['one row remaining', { displayedCount: 249 }, true],
  ])('%s', (_name, override, expected) => {
    expect(shouldLoadMore({ ...base, ...override })).toBe(expected);
  });
});

describe('nextRowBatch', () => {
  const rows = Array.from({ length: 250 }, (_, i) => i);

  it.each([
    { displayed: 0, size: undefined, first: 0, length: ROWS_PER_BATCH },
    { displayed: 100, size: undefined, first: 100, length: ROWS_PER_BATCH },
    { displayed: 200, size: undefined, first: 200, length: 50 },
    { displayed: 250, size: undefined, first: undefined, length: 0 },
    { displayed: 10, size: 5, first: 10, length: 5 },
  ])('displayed $displayed, batch $size -> $length rows', ({ displayed, size, first, length }) => {
    const batch = nextRowBatch(rows, displayed, size);
    expect(batch).toHaveLength(length);
    expect(batch[0]).toBe(first);
  });

  it('does not mutate the source rows', () => {
    const source = [1, 2, 3];
    nextRowBatch(source, 1, 1);
    expect(source).toEqual([1, 2, 3]);
  });
});
