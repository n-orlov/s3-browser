import { describe, it, expect } from 'vitest';
import {
  getBrackets,
  getChildName,
  getCollapsedHint,
  getIndentPx,
  getKeyClassName,
  getNodeEntries,
  isNameMatch,
  isToggleKey,
  shouldStartExpanded,
} from '../renderer/utils/jsonTree';

describe('isNameMatch', () => {
  it.each([
    ['userName', 'name', true],
    ['userName', 'NAME', true],
    ['userName', 'zzz', false],
    ['userName', '', false],
    ['', 'a', false],
  ])('isNameMatch(%j, %j) -> %s', (name, term, expected) => {
    expect(isNameMatch(name, term)).toBe(expected);
  });
});

describe('getKeyClassName', () => {
  it.each([
    [true, 'json-key json-match'],
    [false, 'json-key '],
  ])('getKeyClassName(%s) -> %j', (match, expected) => {
    expect(getKeyClassName(match)).toBe(expected);
  });
});

describe('getNodeEntries', () => {
  it.each([
    [[], []],
    [['a', 1], [['0', 'a'], ['1', 1]]],
    [{}, []],
    [{ x: 1, y: null }, [['x', 1], ['y', null]]],
  ])('getNodeEntries(%j) -> %j', (value, expected) => {
    expect(getNodeEntries(value as object)).toEqual(expected);
  });
});

describe('getBrackets', () => {
  it.each([
    [true, { open: '[', close: ']' }],
    [false, { open: '{', close: '}' }],
  ])('getBrackets(%s) -> %j', (isArray, expected) => {
    expect(getBrackets(isArray)).toEqual(expected);
  });
});

describe('getCollapsedHint', () => {
  it.each([
    [true, 3, '3 items'],
    [false, 3, '3 keys'],
    [true, 1, '1 items'],
    [false, 0, '0 keys'],
  ])('getCollapsedHint(%s, %i) -> %j', (isArray, count, expected) => {
    expect(getCollapsedHint(isArray, count)).toBe(expected);
  });
});

describe('getChildName', () => {
  it.each([
    ['0', true, '[0]'],
    ['name', false, 'name'],
    ['name', true, '[name]'],
  ])('getChildName(%j, %s) -> %j', (key, parentIsArray, expected) => {
    expect(getChildName(key, parentIsArray)).toBe(expected);
  });
});

describe('isToggleKey', () => {
  it.each([
    ['Enter', true],
    [' ', true],
    ['Escape', false],
    ['a', false],
    ['Tab', false],
  ])('isToggleKey(%j) -> %s', (key, expected) => {
    expect(isToggleKey(key)).toBe(expected);
  });
});

describe('getIndentPx', () => {
  it.each([
    [0, 0],
    [1, 16],
    [3, 48],
  ])('getIndentPx(%i) -> %i', (level, expected) => {
    expect(getIndentPx(level)).toBe(expected);
  });
});

describe('shouldStartExpanded', () => {
  it.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])('shouldStartExpanded(%s, %s) -> %s', (def, match, expected) => {
    expect(shouldStartExpanded(def, match)).toBe(expected);
  });
});
