import { describe, it, expect } from 'vitest';
import {
  computeClickSelection,
  isCtrlOrCmdPressed,
  mergeSelections,
  sliceRange,
} from '../renderer/utils/fileSelection';
import type { S3Object } from '../renderer/components/FileList';

const obj = (key: string): S3Object => ({ key, size: 1, isPrefix: key.endsWith('/') });
const rows = ['a', 'b', 'c', 'd', 'e'].map(obj);
const keys = (list: S3Object[]) => list.map((f) => f.key);

describe('isCtrlOrCmdPressed', () => {
  it.each([
    [false, { shiftKey: false, ctrlKey: true, metaKey: false }, true],
    [false, { shiftKey: false, ctrlKey: false, metaKey: true }, false],
    [true, { shiftKey: false, ctrlKey: true, metaKey: false }, false],
    [true, { shiftKey: false, ctrlKey: false, metaKey: true }, true],
    [true, { shiftKey: true, ctrlKey: false, metaKey: false }, false],
  ])('mac=%s %j -> %s', (isMac, event, expected) => {
    expect(isCtrlOrCmdPressed(isMac, event)).toBe(expected);
  });
});

describe('sliceRange', () => {
  it.each([
    [1, 3, ['b', 'c', 'd']],
    [3, 1, ['b', 'c', 'd']],
    [2, 2, ['c']],
    [0, 4, ['a', 'b', 'c', 'd', 'e']],
  ])('%i..%i -> %j', (from, to, expected) => {
    expect(keys(sliceRange(rows, from, to))).toEqual(expected);
  });
});

describe('mergeSelections', () => {
  it.each([
    [[], ['a', 'b'], ['a', 'b']],
    [['a'], [], ['a']],
    [['c'], ['b', 'c', 'd'], ['c', 'b', 'd']],
    [['x', 'a'], ['a', 'b'], ['x', 'a', 'b']],
  ])('%j + %j -> %j', (existing, range, expected) => {
    const out = mergeSelections(existing.map(obj), range.map(obj));
    expect(keys(out)).toEqual(expected);
  });
});

describe('computeClickSelection', () => {
  type Over = { last?: number; selected?: string[]; shift?: boolean; ctrl?: boolean };
  type Row = [string, number, Over, string[], string | null, number | null];
  const run = (index: number, over: Over = {}) =>
    computeClickSelection({
      item: rows[index],
      index,
      lastClickedIndex: over.last ?? -1,
      displayedItems: rows,
      selectedFiles: (over.selected ?? []).map((k) => rows.find((r) => r.key === k) ?? obj(k)),
      isShift: over.shift ?? false,
      isCtrlOrCmd: over.ctrl ?? false,
    });

  const table: Row[] = [
    ['plain click selects only the row', 2, {}, ['c'], 'c', 2],
    ['plain click replaces a prior selection', 1, { selected: ['a', 'd'], last: 3 }, ['b'], 'b', 1],
    ['shift without an anchor acts as a plain click', 3, { shift: true }, ['d'], 'd', 3],
    ['shift without an anchor and ctrl toggles', 3, { shift: true, ctrl: true }, ['d'], 'd', 3],
    ['shift selects the range down from the anchor', 3, { shift: true, last: 1 }, ['b', 'c', 'd'], 'd', null],
    ['shift selects the range up from the anchor', 0, { shift: true, last: 2 }, ['a', 'b', 'c'], 'a', null],
    ['shift replaces the previous selection', 2, { shift: true, last: 2, selected: ['a', 'e'] }, ['c'], 'c', null],
    [
      'shift+ctrl adds the range to the selection',
      3,
      { shift: true, ctrl: true, last: 2, selected: ['a', 'c'] },
      ['a', 'c', 'd'],
      'd',
      null,
    ],
    ['ctrl adds an unselected row', 2, { ctrl: true, selected: ['a'], last: 0 }, ['a', 'c'], 'c', 2],
    ['ctrl removes a selected row; primary is the last remaining', 1, { ctrl: true, selected: ['a', 'b', 'c'] }, ['a', 'c'], 'c', 1],
    ['ctrl removing the only row leaves no primary', 1, { ctrl: true, selected: ['b'] }, [], null, 1],
  ];
  it.each(table)('%s', (_name, index, over, expectedKeys, primaryKey, anchor) => {
    const out = run(index, over);
    expect(keys(out.selectedFiles)).toEqual(expectedKeys);
    expect(out.primary?.key ?? null).toBe(primaryKey);
    expect(out.lastClickedIndex).toBe(anchor);
  });
});
