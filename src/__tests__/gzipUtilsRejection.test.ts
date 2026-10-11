import * as util from 'util';

// gunzip is promisified when gzipUtils loads, so the stand-in must carry util.promisify.custom
// to make that promise reject with a value that is not an Error.
vi.mock('zlib', async importOriginal => {
  const actual = await importOriginal<typeof import('zlib')>();
  const gunzip = Object.assign(actual.gunzip.bind(actual), {
    [util.promisify.custom]: () => Promise.reject(undefined),
  });
  return { ...actual, gunzip, default: { ...actual, gunzip } };
});

import { decompressGzip, tryDecompressGzip } from '../main/services/gzipUtils';

describe('gzipUtils with a gunzip that rejects with a non-Error value', () => {
  it('rethrows the original rejection instead of failing while inspecting its code', async () => {
    await expect(decompressGzip(Buffer.from('anything'))).rejects.toBeUndefined();
  });

  it('tryDecompressGzip falls back to the raw text for that rejection', async () => {
    expect(await tryDecompressGzip(Buffer.from('raw text'))).toBe('raw text');
  });
});
