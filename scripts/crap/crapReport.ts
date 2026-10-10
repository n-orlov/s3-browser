// Joins per-function ESLint complexity with v8 (istanbul-shaped) coverage into scored functions.
import type { FunctionMetrics } from './crapScore.ts';

export interface Position {
  line: number;
  column: number | null;
}

export interface FileCoverage {
  fnMap: Record<string, { loc: { start: Position; end: Position } }>;
  statementMap: Record<string, { start: Position; end: Position }>;
  s: Record<string, number>;
  f: Record<string, number>;
}

export interface FunctionComplexity {
  /** Qualified name within the file. */
  name: string;
  complexity: number;
  /** 1-based line / 0-based column of the function body start. */
  bodyLine: number;
  bodyColumn: number;
}

function before(a: Position, b: Position): boolean {
  return a.line < b.line || (a.line === b.line && (a.column ?? Infinity) < (b.column ?? Infinity));
}

function contains(outer: { start: Position; end: Position }, inner: Position): boolean {
  return !before(inner, outer.start) && (inner.line < outer.end.line || (inner.line === outer.end.line && (outer.end.column === null || (inner.column ?? 0) <= outer.end.column)));
}

/**
 * Fraction of a function's own statements that ran. Statements of nested functions belong to the
 * nested function. A function without statements counts as covered when it was called.
 */
export function functionCoverage(file: FileCoverage | undefined, bodyLine: number, bodyColumn: number): number {
  if (!file) return 0;
  const entries = Object.entries(file.fnMap);
  const own = entries.find(([, fn]) => fn.loc.start.line === bodyLine && fn.loc.start.column === bodyColumn);
  if (!own) return 0;
  const [ownId, ownFn] = own;
  const nested = entries.filter(([id, fn]) => id !== ownId && contains(ownFn.loc, fn.loc.start));
  let total = 0;
  let covered = 0;
  for (const [id, statement] of Object.entries(file.statementMap)) {
    if (!contains(ownFn.loc, statement.start)) continue;
    if (nested.some(([, fn]) => contains(fn.loc, statement.start))) continue;
    total += 1;
    if ((file.s[id] ?? 0) > 0) covered += 1;
  }
  if (total === 0) return (file.f[ownId] ?? 0) > 0 ? 1 : 0;
  return covered / total;
}

/** Ids are `<file>:<qualified name>`; repeated names in one file get `#2`, `#3`, ... in source order. */
export function toMetrics(
  file: string,
  functions: readonly FunctionComplexity[],
  coverage: FileCoverage | undefined,
): FunctionMetrics[] {
  const seen = new Map<string, number>();
  return functions.map((fn) => {
    const base = `${file}:${fn.name}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return {
      id: count === 1 ? base : `${base}#${count}`,
      complexity: fn.complexity,
      coverage: functionCoverage(coverage, fn.bodyLine, fn.bodyColumn),
    };
  });
}
