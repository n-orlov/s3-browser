import { describe, it, expect } from 'vitest';
import {
  LIST_BUCKETS_FALLBACK,
  buildObjectsRequest,
  errorMessageOf,
  resolveBucketsOutcome,
  type ListBucketsResponse,
} from '../renderer/utils/s3Listing';

describe('errorMessageOf', () => {
  it.each([
    ['an Error', new Error('boom'), 'boom'],
    ['a string', 'boom', 'fallback'],
    ['undefined', undefined, 'fallback'],
    ['a plain object', { message: 'boom' }, 'fallback'],
  ])('returns the right text for %s', (_name, input, expected) => {
    expect(errorMessageOf(input, 'fallback')).toBe(expected);
  });
});

describe('resolveBucketsOutcome', () => {
  const bucket = { name: 'b1' };
  it.each<[string, ListBucketsResponse, { buckets: unknown[]; error: string | null }]>([
    ['success with buckets', { success: true, buckets: [bucket] }, { buckets: [bucket], error: null }],
    ['success without buckets', { success: true }, { buckets: [], error: null }],
    ['failure with message', { success: false, error: 'denied' }, { buckets: [], error: 'denied' }],
    ['failure without message', { success: false }, { buckets: [], error: LIST_BUCKETS_FALLBACK }],
    ['failure ignores buckets', { success: false, buckets: [bucket] }, { buckets: [], error: LIST_BUCKETS_FALLBACK }],
  ])('%s', (_name, response, expected) => {
    expect(resolveBucketsOutcome(response)).toEqual(expected);
  });
});

describe('buildObjectsRequest', () => {
  it.each([
    ['reset drops the token', true, 'tok', undefined],
    ['pagination keeps the token', false, 'tok', 'tok'],
    ['pagination without a token', false, undefined, undefined],
  ])('%s', (_name, reset, token, expected) => {
    expect(buildObjectsRequest('bkt', 'a/', reset, token)).toEqual({
      bucket: 'bkt',
      prefix: 'a/',
      delimiter: '/',
      maxKeys: 100,
      continuationToken: expected,
    });
  });
});
