import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  buildNewItemKey,
  getDeleteDisplayName,
  getDisplayPath,
  getFileNameOrKey,
  getLastSegment,
  getNewItemSelectionKey,
  getRenameName,
} from '../renderer/utils/appView';
import { FileViewers, SelectedFileInfo, type OpenViewers } from '../renderer/components/AppParts';
import type { S3Object } from '../renderer/components/FileList';

const file = (key: string, isPrefix = false): S3Object => ({ key, size: 7, lastModified: undefined, isPrefix }) as S3Object;

describe('getDisplayPath', () => {
  it.each([
    [null, '', 'Files'],
    [null, 'a/b/', 'Files'],
    ['bkt', '', 'bkt'],
    ['bkt', 'a/b/', 'bkt/a/b/'],
  ])('bucket=%j prefix=%j -> %j', (bucket, prefix, expected) => {
    expect(getDisplayPath(bucket, prefix)).toBe(expected);
  });
});

describe('getLastSegment / getFileNameOrKey', () => {
  it.each([
    ['dir/sub/file.txt', 'file.txt', 'file.txt'],
    ['file.txt', 'file.txt', 'file.txt'],
    ['dir/sub/', '', 'dir/sub/'],
    ['', '', ''],
  ])('key=%j -> last %j, name-or-key %j', (key, last, nameOrKey) => {
    expect(getLastSegment(key)).toBe(last);
    expect(getFileNameOrKey(key)).toBe(nameOrKey);
  });
});

describe('getRenameName', () => {
  it.each([
    [null, ''],
    [file('dir/a.txt'), 'a.txt'],
    [file('a.txt'), 'a.txt'],
  ])('%j -> %j', (selected, expected) => {
    expect(getRenameName(selected)).toBe(expected);
  });
});

describe('getDeleteDisplayName', () => {
  it.each([
    ['dir/a.txt', false, 'a.txt'],
    ['a.txt', false, 'a.txt'],
    ['dir/sub/', true, 'sub/'],
    ['top/', true, 'top/'],
    ['', false, ''],
  ])('key=%j isPrefix=%j -> %j', (key, isPrefix, expected) => {
    expect(getDeleteDisplayName({ key, isPrefix })).toBe(expected);
  });
});

describe('buildNewItemKey', () => {
  it.each([
    ['', 'new.txt', 'new.txt'],
    ['dir/', 'new.txt', 'dir/new.txt'],
  ])('prefix=%j name=%j -> %j', (prefix, name, expected) => {
    expect(buildNewItemKey(prefix, name)).toBe(expected);
  });
});

describe('getNewItemSelectionKey', () => {
  it.each([
    ['dir/new.txt', 'file', 'dir/new.txt'],
    ['dir/new/', 'file', 'dir/new/'],
    ['dir/new', 'folder', 'dir/new/'],
    ['dir/new/', 'folder', 'dir/new/'],
  ] as const)('key=%j type=%j -> %j', (key, type, expected) => {
    expect(getNewItemSelectionKey(key, type)).toBe(expected);
  });
});

describe('SelectedFileInfo', () => {
  it.each([
    [null, 0, null],
    [null, 1, null],
    [file('dir/a.txt'), 1, 'a.txt'],
    [file('dir/a.txt'), 0, 'a.txt'],
    [file('dir/a.txt'), 3, '3 files'],
    [null, 2, '2 files'],
  ])('selectedFile=%j count=%j -> text %j', (selected, count, text) => {
    const { container } = render(<SelectedFileInfo selectedFile={selected} selectedCount={count} />);
    if (text === null) {
      expect(container).toBeEmptyDOMElement();
    } else {
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.getByText('Selected:')).toBeInTheDocument();
    }
  });
});

vi.mock('../renderer/components/TextEditor', () => ({ default: (p: any) => <div data-testid="editor">{p.fileName}</div> }));
vi.mock('../renderer/components/ParquetViewer', () => ({ default: (p: any) => <div data-testid="parquet">{p.fileSize}</div> }));
vi.mock('../renderer/components/CsvViewer', () => ({ default: () => <div data-testid="csv" /> }));
vi.mock('../renderer/components/JsonViewer', () => ({ default: () => <div data-testid="json" /> }));
vi.mock('../renderer/components/YamlViewer', () => ({ default: () => <div data-testid="yaml" /> }));
vi.mock('../renderer/components/ImagePreview', () => ({ default: () => <div data-testid="image" /> }));

describe('FileViewers', () => {
  const none: OpenViewers = { editor: false, parquet: false, csv: false, json: false, yaml: false, image: false };
  const noop = () => {};
  const handlers = {
    onCloseEditor: noop, onEditorSaved: noop, onCloseParquet: noop,
    onCloseCsv: noop, onCloseJson: noop, onCloseYaml: noop, onCloseImage: noop,
  };
  const ids = ['editor', 'parquet', 'csv', 'json', 'yaml', 'image'] as const;

  it.each(ids)('opens only the %s viewer when its flag is set', id => {
    render(<FileViewers bucket="b" file={file('d/f.txt')} open={{ ...none, [id]: true }} {...handlers} />);
    for (const other of ids) {
      if (other === id) expect(screen.getByTestId(other)).toBeInTheDocument();
      else expect(screen.queryByTestId(other)).not.toBeInTheDocument();
    }
  });

  it.each([
    ['no bucket', null, file('d/f.txt')],
    ['no file', 'b', null],
    ['neither', null, null],
  ])('renders nothing with %s even when every viewer is flagged open', (_label, bucket, selected) => {
    const all: OpenViewers = { editor: true, parquet: true, csv: true, json: true, yaml: true, image: true };
    const { container } = render(<FileViewers bucket={bucket} file={selected} open={all} {...handlers} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('passes the file name and size to the viewers', () => {
    render(<FileViewers bucket="b" file={file('d/f.txt')} open={{ ...none, editor: true, parquet: true }} {...handlers} />);
    expect(screen.getByTestId('editor')).toHaveTextContent('f.txt');
    expect(screen.getByTestId('parquet')).toHaveTextContent('7');
  });
});
