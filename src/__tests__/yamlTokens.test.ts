import { describe, it, expect } from 'vitest';
import {
  findCommentStart,
  splitInlineComment,
  commentTokens,
  classifyScalar,
  tokenizePrefixed,
  type Token,
} from '../renderer/utils/yamlTokens';

describe('findCommentStart', () => {
  it.each([
    ['plain', -1],
    ['a # c', 2],
    ['# c', 0],
    ['a#b', -1],
    ['"a # b"', -1],
    ["'a # b'", -1],
    ['"a" # c', 4],
    ['\\" # c', 3],
  ])('%j -> %i', (text, expected) => {
    expect(findCommentStart(text)).toBe(expected);
  });
});

describe('splitInlineComment', () => {
  it.each([
    ['value', 'value', ''],
    ['value # note', 'value', '# note'],
    ['# only', '', '# only'],
    ['"a # b" # c', '"a # b"', '# c'],
  ])('%j', (input, content, comment) => {
    expect(splitInlineComment(input)).toEqual({ content, comment });
  });
});

describe('commentTokens', () => {
  it.each([
    ['', []],
    ['# hi', [{ type: 'default', value: ' ' }, { type: 'comment', value: '# hi' }]],
  ] as [string, Token[]][])('%j', (comment, expected) => {
    expect(commentTokens(comment)).toEqual(expected);
  });
});

describe('classifyScalar', () => {
  it.each([
    ['|', 'literal'], ['>-', 'literal'], ['|+2', 'literal'],
    ['"q"', 'string'], ["'q'", 'string'], ['"open', 'string'], ['plain text', 'string'],
    ['true', 'boolean'], ['False', 'boolean'], ['yes', 'boolean'], ['NO', 'boolean'], ['on', 'boolean'], ['off', 'boolean'],
    ['null', 'null'], ['~', 'null'], ['NULL', 'null'],
    ['0', 'number'], ['-12', 'number'], ['3.14', 'number'], ['1e5', 'number'], ['2.5E-3', 'number'],
    ['0xFF', 'number'], ['0o17', 'number'],
    ['007', 'string'], ['0o8', 'string'], ['1.', 'string'], ['truex', 'string'],
  ])('%j -> %s', (value, type) => {
    expect(classifyScalar(value)).toBe(type);
  });
});

describe('tokenizePrefixed', () => {
  const recurse = (rest: string): Token[] => [{ type: 'string', value: `<${rest}>` }];

  it.each([
    ['plain', '', null],
    ['&', '', null],
    ['*', '', null],
    ['&anchor', '', [{ type: 'anchor', value: '&anchor' }]],
    ['&anchor rest', '', [{ type: 'anchor', value: '&anchor' }, { type: 'string', value: '< rest>' }]],
    ['*alias', '# c', [
      { type: 'alias', value: '*alias' },
      { type: 'default', value: ' ' },
      { type: 'comment', value: '# c' },
    ]],
    ['*alias x', '', [{ type: 'alias', value: '*alias' }, { type: 'string', value: '< x>' }]],
    ['!!str', '', [{ type: 'tag', value: '!!str' }]],
    ['!!str hello', '', [
      { type: 'tag', value: '!!str' },
      { type: 'default', value: ' ' },
      { type: 'string', value: '<hello>' },
    ]],
    ['!tag', '# c', [
      { type: 'tag', value: '!tag' },
      { type: 'default', value: ' ' },
      { type: 'comment', value: '# c' },
    ]],
  ] as [string, string, Token[] | null][])('%j with comment %j', (content, comment, expected) => {
    expect(tokenizePrefixed(content, comment, recurse)).toEqual(expected);
  });
});
