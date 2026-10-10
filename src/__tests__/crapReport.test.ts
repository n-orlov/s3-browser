import { describe, it, expect } from 'vitest';
import { functionCoverage, toMetrics, type FileCoverage } from '../../scripts/crap/crapReport';

// Source shape: outer() { a; b; inner() { c; d; } e; } -- inner is nested in outer.
const coverage = (counts: { a: number; b: number; c: number; d: number; e: number; outer: number; inner: number }): FileCoverage => ({
  fnMap: {
    '0': { loc: { start: { line: 1, column: 10 }, end: { line: 9, column: null } } },
    '1': { loc: { start: { line: 4, column: 12 }, end: { line: 7, column: null } } },
  },
  statementMap: {
    '0': { start: { line: 2, column: 2 }, end: { line: 2, column: null } },
    '1': { start: { line: 3, column: 2 }, end: { line: 3, column: null } },
    '2': { start: { line: 5, column: 4 }, end: { line: 5, column: null } },
    '3': { start: { line: 6, column: 4 }, end: { line: 6, column: null } },
    '4': { start: { line: 8, column: 2 }, end: { line: 8, column: null } },
  },
  s: { '0': counts.a, '1': counts.b, '2': counts.c, '3': counts.d, '4': counts.e },
  f: { '0': counts.outer, '1': counts.inner },
});

describe('functionCoverage', () => {
  it('is the fraction of the function’s own statements that ran, excluding nested functions', () => {
    const file = coverage({ a: 1, b: 0, c: 0, d: 0, e: 1, outer: 1, inner: 0 });
    expect(functionCoverage(file, 1, 10)).toBeCloseTo(2 / 3, 10);
    expect(functionCoverage(file, 4, 12)).toBe(0);
  });

  it('is 1 when every own statement ran and 0 when none did', () => {
    expect(functionCoverage(coverage({ a: 2, b: 1, c: 1, d: 1, e: 5, outer: 1, inner: 1 }), 1, 10)).toBe(1);
    expect(functionCoverage(coverage({ a: 0, b: 0, c: 1, d: 1, e: 0, outer: 0, inner: 1 }), 1, 10)).toBe(0);
  });

  it('is 0 for a file with no coverage entry and for a function v8 did not report', () => {
    expect(functionCoverage(undefined, 1, 10)).toBe(0);
    expect(functionCoverage(coverage({ a: 1, b: 1, c: 1, d: 1, e: 1, outer: 1, inner: 1 }), 99, 0)).toBe(0);
  });

  it('uses the call count for a function that has no statements', () => {
    const file: FileCoverage = {
      fnMap: { '0': { loc: { start: { line: 1, column: 5 }, end: { line: 1, column: 20 } } } },
      statementMap: {},
      s: {},
      f: { '0': 3 },
    };
    expect(functionCoverage(file, 1, 5)).toBe(1);
    expect(functionCoverage({ ...file, f: { '0': 0 } }, 1, 5)).toBe(0);
  });
});

describe('toMetrics', () => {
  it('suffixes repeated names in source order and keeps unique names bare', () => {
    const metrics = toMetrics(
      'src/a.ts',
      [
        { name: 'f', complexity: 2, bodyLine: 1, bodyColumn: 10 },
        { name: 'f', complexity: 3, bodyLine: 4, bodyColumn: 12 },
        { name: 'g', complexity: 1, bodyLine: 50, bodyColumn: 0 },
      ],
      coverage({ a: 1, b: 1, c: 1, d: 1, e: 1, outer: 1, inner: 1 }),
    );
    expect(metrics.map((m) => m.id)).toEqual(['src/a.ts:f', 'src/a.ts:f#2', 'src/a.ts:g']);
    expect(metrics.map((m) => m.coverage)).toEqual([1, 1, 0]);
    expect(metrics.map((m) => m.complexity)).toEqual([2, 3, 1]);
  });
});
