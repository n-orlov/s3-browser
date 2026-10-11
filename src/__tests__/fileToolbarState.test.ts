import { describe, it, expect } from 'vitest';
import {
  getBaseExtension,
  isParquetFile,
  isCsvFile,
  isJsonFile,
  isYamlFile,
  isImageFile,
  singleFileMatches,
  pickTitle,
  getDeleteTitle,
  getCopyTitle,
  getDeleteBadge,
  getToolbarState,
} from '../renderer/utils/fileToolbarState';

describe('getBaseExtension', () => {
  it.each([
    ['data.csv', 'csv'],
    ['data.CSV', 'csv'],
    ['data.json.gz', 'json'],
    ['data.JSON.GZ', 'json'],
    ['dir/a.b.yaml.gz', 'yaml'],
    ['archive.gz', 'archive'],
    ['noext', 'noext'],
    ['', ''],
  ])('%s -> %s', (key, expected) => {
    expect(getBaseExtension(key)).toBe(expected);
  });
});

describe.each([
  ['isParquetFile', isParquetFile, ['a.parquet', 'A.PARQUET'], ['a.parquet.gz', 'a.csv', 'parquet.txt']],
  ['isCsvFile', isCsvFile, ['a.csv', 'a.tsv', 'a.csv.gz', 'a.TSV.GZ'], ['a.json', 'a.csvx']],
  ['isJsonFile', isJsonFile, ['a.json', 'a.json.gz', 'A.JSON'], ['a.jsonl', 'a.yaml']],
  ['isYamlFile', isYamlFile, ['a.yaml', 'a.yml', 'a.yml.gz', 'a.YAML.GZ'], ['a.json', 'a.yamlx']],
  [
    'isImageFile',
    isImageFile,
    ['a.png', 'a.jpg', 'a.JPEG', 'a.gif', 'a.webp', 'a.svg', 'a.ico', 'a.bmp'],
    ['a.png.gz', 'a.txt', 'png'.concat('x')],
  ],
])('%s', (_name, fn, yes, no) => {
  it.each(yes)('accepts %s', (key) => {
    expect(fn(key)).toBe(true);
  });
  it.each(no)('rejects %s', (key) => {
    expect(fn(key)).toBe(false);
  });
});

describe('singleFileMatches', () => {
  const always = () => true;
  it.each([
    ['no selection', null, 0, false],
    ['folder selected', { key: 'a/', isPrefix: true }, 1, false],
    ['multiselect', { key: 'a.txt', isPrefix: false }, 2, false],
    ['single file', { key: 'a.txt', isPrefix: false }, 1, true],
  ])('%s -> %s', (_label, file, count, expected) => {
    expect(singleFileMatches(file, count, always)).toBe(expected);
  });

  it('defers to the predicate for a single file', () => {
    expect(singleFileMatches({ key: 'a.txt', isPrefix: false }, 1, () => false)).toBe(false);
  });
});

describe('titles and badge', () => {
  it.each([
    [true, 'yes'],
    [false, 'no'],
  ])('pickTitle(%s)', (enabled, expected) => {
    expect(pickTitle(enabled, 'yes', 'no')).toBe(expected);
  });

  it.each([
    [3, false, 'Delete 3 items'],
    [2, true, 'Delete 2 items'],
    [1, true, 'Delete selected folder'],
    [1, false, 'Delete selected file'],
    [0, false, 'Delete selected file'],
  ])('getDeleteTitle(%i, folder=%s) -> %s', (count, folder, expected) => {
    expect(getDeleteTitle(count, folder)).toBe(expected);
  });

  it.each([
    [true, true, 'Copy URL not available for multiple files'],
    [true, false, 'Copy URL not available for multiple files'],
    [false, true, 'Copy S3 URL to clipboard'],
    [false, false, 'Select a file to copy URL'],
  ])('getCopyTitle(multi=%s, selection=%s) -> %s', (multi, sel, expected) => {
    expect(getCopyTitle(multi, sel)).toBe(expected);
  });

  it.each([
    [0, undefined],
    [1, undefined],
    [2, '2'],
    [10, '10'],
  ])('getDeleteBadge(%i) -> %s', (count, expected) => {
    expect(getDeleteBadge(count)).toBe(expected);
  });
});

describe('getToolbarState', () => {
  const file = (key: string) => ({ key, isPrefix: false });
  const folder = { key: 'dir/', isPrefix: true };

  type Case = {
    label: string;
    bucket: string | null;
    sel: { key: string; isPrefix: boolean } | null;
    count: number;
    disabled: boolean;
    enabled: string[];
  };
  const bucketButtons = ['newFile', 'newFolder', 'upload', 'refresh'];
  const cases: Case[] = [
    { label: 'nothing selected', bucket: 'b', sel: null, count: 0, disabled: false, enabled: bucketButtons },
    { label: 'no bucket', bucket: null, sel: null, count: 0, disabled: false, enabled: [] },
    { label: 'disabled flag', bucket: 'b', sel: file('a.csv'), count: 1, disabled: true, enabled: [] },
    {
      label: 'folder',
      bucket: 'b',
      sel: folder,
      count: 1,
      disabled: false,
      enabled: [...bucketButtons, 'delete', 'properties'],
    },
    {
      label: 'plain file',
      bucket: 'b',
      sel: file('a.txt'),
      count: 1,
      disabled: false,
      enabled: [...bucketButtons, 'download', 'edit', 'copy', 'rename', 'delete', 'properties'],
    },
    {
      label: 'parquet',
      bucket: 'b',
      sel: file('a.parquet'),
      count: 1,
      disabled: false,
      enabled: [...bucketButtons, 'download', 'edit', 'parquet', 'copy', 'rename', 'delete', 'properties'],
    },
    {
      label: 'csv.gz',
      bucket: 'b',
      sel: file('a.csv.gz'),
      count: 1,
      disabled: false,
      enabled: [...bucketButtons, 'download', 'edit', 'csv', 'copy', 'rename', 'delete', 'properties'],
    },
    {
      label: 'json',
      bucket: 'b',
      sel: file('a.json'),
      count: 1,
      disabled: false,
      enabled: [...bucketButtons, 'download', 'edit', 'json', 'copy', 'rename', 'delete', 'properties'],
    },
    {
      label: 'yml',
      bucket: 'b',
      sel: file('a.yml'),
      count: 1,
      disabled: false,
      enabled: [...bucketButtons, 'download', 'edit', 'yaml', 'copy', 'rename', 'delete', 'properties'],
    },
    {
      label: 'png',
      bucket: 'b',
      sel: file('a.png'),
      count: 1,
      disabled: false,
      enabled: [...bucketButtons, 'download', 'edit', 'image', 'copy', 'rename', 'delete', 'properties'],
    },
    {
      label: 'multiselect',
      bucket: 'b',
      sel: file('a.csv'),
      count: 3,
      disabled: false,
      enabled: [...bucketButtons, 'delete'],
    },
  ];

  const allButtons = [
    'newFile', 'newFolder', 'upload', 'download', 'edit', 'parquet', 'csv', 'json',
    'yaml', 'image', 'copy', 'rename', 'delete', 'properties', 'refresh',
  ] as const;

  it.each(cases)('enabled buttons: $label', ({ bucket, sel, count, disabled, enabled }) => {
    const state = getToolbarState(bucket, sel, count, disabled);
    const actuallyEnabled = allButtons.filter((name) => !state[name].disabled);
    // Bucket-less / disabled cases never enable anything; others keep order of allButtons.
    const expected = allButtons.filter((name) => enabled.includes(name));
    expect(actuallyEnabled).toEqual(expected);
  });

  it.each([
    ['download', 'Download selected file', 'Download not available for multiple files'],
    ['rename', 'Rename selected file', 'Rename not available for multiple files'],
    ['edit', 'Edit file as text', 'Select a file to edit'],
    ['parquet', 'View parquet file', 'Select a parquet file to view'],
    ['csv', 'View CSV file', 'Select a CSV file to view'],
    ['json', 'View JSON file', 'Select a JSON file to view'],
    ['yaml', 'View YAML file', 'Select a YAML file to view'],
    ['image', 'Preview image', 'Select an image file to preview'],
    ['properties', 'View properties', 'Select a file or folder to view properties'],
  ] as const)('%s title: enabled vs disabled wording', (name, enabledTitle, disabledTitle) => {
    const key: Record<string, string> = {
      download: 'a.txt', rename: 'a.txt', edit: 'a.txt', parquet: 'a.parquet',
      csv: 'a.csv', json: 'a.json', yaml: 'a.yaml', image: 'a.png', properties: 'a.txt',
    };
    expect(getToolbarState('b', file(key[name]), 1, false)[name].title).toBe(enabledTitle);
    const none = getToolbarState('b', null, 0, false)[name].title;
    const multi = getToolbarState('b', file(key[name]), 2, false)[name].title;
    if (name === 'download' || name === 'rename') {
      expect(multi).toBe(disabledTitle);
    } else {
      expect(none).toBe(disabledTitle);
    }
  });

  it.each([
    [0, null, 'Delete selected file', undefined],
    [1, folder, 'Delete selected folder', undefined],
    [1, file('a.txt'), 'Delete selected file', undefined],
    [4, file('a.txt'), 'Delete 4 items', '4'],
  ])('delete button for count=%i', (count, sel, title, badge) => {
    const state = getToolbarState('b', sel, count, false);
    expect(state.delete.title).toBe(title);
    expect(state.delete.badge).toBe(badge);
  });

  it('copy title follows selection state', () => {
    expect(getToolbarState('b', file('a.txt'), 1, false).copy.title).toBe('Copy S3 URL to clipboard');
    expect(getToolbarState('b', folder, 1, false).copy.title).toBe('Select a file to copy URL');
    expect(getToolbarState('b', file('a.txt'), 2, false).copy.title).toBe(
      'Copy URL not available for multiple files'
    );
  });
});
