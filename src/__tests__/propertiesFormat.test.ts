import { describe, it, expect } from 'vitest';
import {
  buildFolderMetadata,
  formatDate,
  formatSize,
  getDetailRows,
  getErrorMessage,
  getName,
  getTypeLabel,
} from '../renderer/utils/propertiesFormat';
import type { ObjectMetadata } from '../renderer/components/PropertiesDialog';

const base: ObjectMetadata = {
  key: 'k',
  bucket: 'b',
  s3Url: 's3://b/k',
  httpUrl: 'https://b.s3.amazonaws.com/k',
  tags: {},
  customMetadata: {},
};

describe('formatSize', () => {
  it.each([
    [undefined, '-'],
    [0, '0 bytes'],
    [1, '1 bytes'],
    [1023, '1023 bytes'],
    [1024, '1.00 KB'],
    [1536, '1.50 KB'],
    [1234567, '1.18 MB'],
    [1024 ** 3, '1.00 GB'],
    [1024 ** 4, '1.00 TB'],
    [1024 ** 5, '1024.00 TB'],
  ])('formatSize(%s) = %s', (input, expected) => {
    expect(formatSize(input as number | undefined)).toBe(expected);
  });

  it('treats null as missing', () => {
    expect(formatSize(null as unknown as undefined)).toBe('-');
  });
});

describe('formatDate', () => {
  const d = new Date('2024-01-15T10:30:00Z');
  it.each([
    [undefined, '-'],
    ['', '-'],
    [d, d.toLocaleString()],
    ['2024-01-15T10:30:00Z', d.toLocaleString()],
  ])('formatDate(%s) = %s', (input, expected) => {
    expect(formatDate(input as Date | string | undefined)).toBe(expected);
  });
});

describe('getName', () => {
  it.each([
    ['file.txt', 'file.txt'],
    ['a/b/file.txt', 'file.txt'],
    ['a/b/', 'b'],
    ['folder/', 'folder'],
    ['a/', 'a'],
    ['', ''],
  ])('getName(%j) = %j', (key, expected) => {
    expect(getName(key)).toBe(expected);
  });
});

describe('buildFolderMetadata', () => {
  it.each([
    ['bkt', 'dir/', 's3://bkt/dir/', 'https://bkt.s3.amazonaws.com/dir%2F'],
    ['b2', 'a b/c/', 's3://b2/a b/c/', 'https://b2.s3.amazonaws.com/a%20b%2Fc%2F'],
  ])('builds URLs for %s / %s', (bucket, key, s3Url, httpUrl) => {
    expect(buildFolderMetadata(bucket, key)).toEqual({
      key,
      bucket,
      s3Url,
      httpUrl,
      tags: {},
      customMetadata: {},
    });
  });
});

describe('getErrorMessage', () => {
  it.each([
    ['Access denied', 'Access denied'],
    ['', 'Failed to load metadata'],
    [undefined, 'Failed to load metadata'],
  ])('getErrorMessage(%j) = %j', (input, expected) => {
    expect(getErrorMessage(input)).toBe(expected);
  });
});

describe('getTypeLabel', () => {
  it.each([
    [true, 'text/plain', 'Folder'],
    [true, undefined, 'Folder'],
    [false, 'text/plain', 'text/plain'],
    [false, undefined, 'Unknown'],
    [false, '', 'Unknown'],
  ])('getTypeLabel(%s, %j) = %s', (isFolder, contentType, expected) => {
    expect(getTypeLabel(isFolder, contentType)).toBe(expected);
  });
});

describe('getDetailRows', () => {
  const when = new Date('2024-01-15T10:30:00Z');
  const cases: Array<[string, Partial<ObjectMetadata>, Array<[string, string, boolean]>]> = [
    ['no optional fields', {}, []],
    ['lastModified', { lastModified: when }, [['Last Modified', when.toLocaleString(), false]]],
    ['etag is mono', { etag: 'abc' }, [['ETag', 'abc', true]]],
    ['storageClass', { storageClass: 'STANDARD' }, [['Storage Class', 'STANDARD', false]]],
    ['versionId is mono', { versionId: 'v1' }, [['Version ID', 'v1', true]]],
    ['encryption', { serverSideEncryption: 'AES256' }, [['Encryption', 'AES256', false]]],
    ['contentEncoding', { contentEncoding: 'gzip' }, [['Content Encoding', 'gzip', false]]],
    ['cacheControl', { cacheControl: 'no-cache' }, [['Cache Control', 'no-cache', false]]],
    ['expires', { expires: when }, [['Expires', when.toLocaleString(), false]]],
    ['empty strings omitted', { etag: '', storageClass: '', versionId: '' }, []],
    [
      'display order',
      { expires: when, cacheControl: 'c', etag: 'e', storageClass: 's' },
      [
        ['ETag', 'e', true],
        ['Storage Class', 's', false],
        ['Cache Control', 'c', false],
        ['Expires', when.toLocaleString(), false],
      ],
    ],
  ];
  it.each(cases)('%s', (_name, extra, expected) => {
    const rows = getDetailRows({ ...base, ...extra });
    expect(rows.map((r) => [r.label, r.value, r.mono])).toEqual(expected);
  });
});
