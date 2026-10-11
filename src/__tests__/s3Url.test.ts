import { describe, it, expect } from 'vitest';
import { parseS3Url } from '../main/services/s3Url';

describe('parseS3Url (pure module)', () => {
  it('parses s3:// URLs with and without keys', () => {
    expect(parseS3Url('s3://b/a/b.txt')).toEqual({ bucket: 'b', key: 'a/b.txt' });
    expect(parseS3Url('s3://b')).toEqual({ bucket: 'b', key: '' });
    expect(parseS3Url('s3://b/')).toEqual({ bucket: 'b', key: '' });
  });

  it('parses virtual-hosted style URLs with and without region', () => {
    expect(parseS3Url('https://b.s3.us-west-2.amazonaws.com/f.txt')).toEqual({
      bucket: 'b',
      key: 'f.txt',
    });
    expect(parseS3Url('http://b.s3.amazonaws.com/x/y')).toEqual({ bucket: 'b', key: 'x/y' });
    expect(parseS3Url('https://b.s3.amazonaws.com')).toEqual({ bucket: 'b', key: '' });
  });

  it('parses path style URLs with and without region', () => {
    expect(parseS3Url('https://s3.eu-west-1.amazonaws.com/b/x/y.txt')).toEqual({
      bucket: 'b',
      key: 'x/y.txt',
    });
    expect(parseS3Url('https://s3.amazonaws.com/b/')).toEqual({ bucket: 'b', key: '' });
  });

  it('returns null for non-S3 inputs', () => {
    expect(parseS3Url('https://example.com/f.txt')).toBeNull();
    expect(parseS3Url('ftp://b/f')).toBeNull();
    expect(parseS3Url('s3://')).toBeNull();
    expect(parseS3Url('')).toBeNull();
  });

  describe('anchoring and exact shapes', () => {
    it('rejects inputs with a prefix before the scheme', () => {
      expect(parseS3Url('xs3://b/k')).toBeNull();
      expect(parseS3Url(' s3://b/k')).toBeNull();
      expect(parseS3Url('xhttps://b.s3.amazonaws.com/k')).toBeNull();
      expect(parseS3Url('see https://s3.amazonaws.com/b/k')).toBeNull();
    });

    it('rejects inputs whose key contains a line break (the match must reach the end of the input)', () => {
      expect(parseS3Url('s3://b/k\nx')).toBeNull();
      expect(parseS3Url('https://b.s3.amazonaws.com/k\nx')).toBeNull();
      expect(parseS3Url('https://s3.amazonaws.com/b/k\nx')).toBeNull();
    });

    it('accepts plain http for path style URLs', () => {
      expect(parseS3Url('http://s3.amazonaws.com/b/k.txt')).toEqual({ bucket: 'b', key: 'k.txt' });
      expect(parseS3Url('http://s3.eu-west-1.amazonaws.com/b/k.txt')).toEqual({ bucket: 'b', key: 'k.txt' });
    });

    it('accepts a path style URL that names only the bucket, with no trailing slash', () => {
      expect(parseS3Url('https://s3.amazonaws.com/b')).toEqual({ bucket: 'b', key: '' });
      expect(parseS3Url('https://s3.us-east-1.amazonaws.com/b')).toEqual({ bucket: 'b', key: '' });
    });
  });
});
