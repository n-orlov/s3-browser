import { describe, it, expect } from 'vitest';
import { crapScore, judgeCrap, scoreFunctions, DEFAULT_CRAP_MAX } from '../../scripts/crap/crapScore';

describe('crapScore', () => {
  it.each([
    [1, 1, 1],
    [10, 0, 110],
    [5, 0.5, 8.125],
    [0, 0, 0],
    [20, 1, 20],
  ])('c=%d cov=%d -> %d', (c, cov, expected) => {
    expect(crapScore(c, cov)).toBeCloseTo(expected, 10);
  });

  it('rejects out-of-range inputs', () => {
    expect(() => crapScore(-1, 0.5)).toThrow(RangeError);
    expect(() => crapScore(3, 1.5)).toThrow(RangeError);
    expect(() => crapScore(3, -0.1)).toThrow(RangeError);
    expect(() => crapScore(NaN, 0.5)).toThrow(RangeError);
    expect(() => crapScore(3, NaN)).toThrow(RangeError);
  });

  it('scores each function and keeps its metrics', () => {
    expect(scoreFunctions([{ id: 'a', complexity: 5, coverage: 0.5 }])).toEqual([
      { id: 'a', complexity: 5, coverage: 0.5, crap: 8.125 },
    ]);
  });
});

describe('judgeCrap', () => {
  // c=10 cov=0 -> 110 (over the default limit); c=5 cov=0.5 -> 8.125 (under it)
  const over = { id: 'src/main/a.ts:over', complexity: 10, coverage: 0 };
  const fine = { id: 'src/main/a.ts:fine', complexity: 5, coverage: 0.5 };

  it('defaults the limit to 30', () => {
    expect(DEFAULT_CRAP_MAX).toBe(30);
    expect(judgeCrap([fine]).ok).toBe(true);
    expect(judgeCrap([over]).ok).toBe(false);
  });

  it('fails a non-baselined function over the limit', () => {
    const verdict = judgeCrap([over, fine], { max: 30, baseline: {} });
    expect(verdict.ok).toBe(false);
    expect(verdict.violations).toEqual([{ id: over.id, crap: 110, reason: 'over-limit', limit: 30 }]);
  });

  it('fails a function absent from a non-empty baseline when it is over the limit', () => {
    const verdict = judgeCrap([over], { max: 30, baseline: { 'src/main/other.ts:x': 200 } });
    expect(verdict.ok).toBe(false);
    expect(verdict.violations[0]).toMatchObject({ id: over.id, reason: 'over-limit' });
  });

  it('passes a baselined function at its baseline', () => {
    expect(judgeCrap([over], { max: 30, baseline: { [over.id]: 110 } }).ok).toBe(true);
  });

  it('passes a baselined function below its baseline', () => {
    expect(judgeCrap([over], { max: 30, baseline: { [over.id]: 150 } }).ok).toBe(true);
  });

  it('fails a baselined function worse than its baseline', () => {
    const verdict = judgeCrap([over], { max: 30, baseline: { [over.id]: 100 } });
    expect(verdict.ok).toBe(false);
    expect(verdict.violations).toEqual([{ id: over.id, crap: 110, reason: 'worse-than-baseline', limit: 100 }]);
  });

  it('fails a baselined function worse than its baseline even when it is under the limit', () => {
    expect(judgeCrap([fine], { max: 30, baseline: { [fine.id]: 5 } }).ok).toBe(false);
  });

  it('applies a custom limit to non-baselined functions', () => {
    expect(judgeCrap([fine], { max: 8 }).ok).toBe(false);
    expect(judgeCrap([fine], { max: 8.125 }).ok).toBe(true);
  });

  it('ignores baseline entries for functions that no longer exist', () => {
    expect(judgeCrap([fine], { baseline: { 'gone:fn': 500 } }).ok).toBe(true);
  });

  it('does not treat inherited object keys as baseline entries', () => {
    expect(judgeCrap([{ id: 'toString', complexity: 10, coverage: 0 }], { baseline: {} }).ok).toBe(false);
  });
});
