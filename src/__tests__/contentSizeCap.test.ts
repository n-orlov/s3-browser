import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { Readable } from 'stream';
import * as zlib from 'zlib';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      h.handlers.set(channel, fn);
    }),
  },
  app: { getPath: vi.fn(() => '/downloads') },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
}));

vi.mock('../main/services/awsCredentials', () => ({
  getProfile: vi.fn(() => ({
    name: 'p',
    hasCredentials: true,
    profileType: 'static',
    region: 'us-east-1',
    accessKeyId: 'AKIAMOCK',
    secretAccessKey: 'secret',
  })),
  validateProfile: vi.fn(() => ({ valid: true })),
  loadAwsProfiles: vi.fn(() => ({ profiles: [], defaultRegion: undefined })),
  getProfileTypeDescription: vi.fn(() => 'static'),
}));

import { registerCredentialsIpc } from '../main/ipc/credentials';
import { registerS3Ipc } from '../main/ipc/s3';
import { DEFAULT_MAX_CONTENT_BYTES, MAX_CONTENT_BYTES_ENV, getMaxContentBytes } from '../main/contentLimits';

const s3Mock = mockClient(S3Client);

type Handler = (event: unknown, ...args: unknown[]) => Promise<any>;
const call = (channel: string, ...args: unknown[]): Promise<any> =>
  (h.handlers.get(channel) as Handler)({}, ...args);

const body = (content: string | Buffer) => {
  const stream = new Readable();
  stream.push(content);
  stream.push(null);
  return sdkStreamMixin(stream);
};

const OVER = DEFAULT_MAX_CONTENT_BYTES + 1;

beforeAll(async () => {
  registerCredentialsIpc();
  registerS3Ipc();
  await call('aws:set-profile', 'p');
});

beforeEach(() => {
  s3Mock.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('content-read size cap (HEAD before GET)', () => {
  it('defaults to 50 MB', () => {
    expect(DEFAULT_MAX_CONTENT_BYTES).toBe(50 * 1024 * 1024);
    expect(getMaxContentBytes({})).toBe(50 * 1024 * 1024);
  });

  it.each([
    ['s3:download-content', 'big.txt'],
    ['s3:download-content', 'big.txt.gz'],
    ['s3:download-binary-content', 'big.parquet'],
    ['s3:download-binary-content', 'big.png'],
  ])('%s rejects an oversized %s without issuing GetObject', async (channel, key) => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: OVER });
    const res = await call(channel, 'bucket', key);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Maximum size is 50 MB');
    expect(res.error).toContain(String(DEFAULT_MAX_CONTENT_BYTES));
    expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(1);
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it('still downloads text, gzip and binary objects at the cap', async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: DEFAULT_MAX_CONTENT_BYTES });
    s3Mock.on(GetObjectCommand).callsFake(async (input: { Key: string }) => ({
      Body: body(input.Key.endsWith('.gz') ? zlib.gzipSync('zipped') : Buffer.from([1, 2, 3])),
    }));
    expect(await call('s3:download-content', 'bucket', 'a.txt')).toEqual({
      success: true,
      content: '\u0001\u0002\u0003',
    });
    expect(await call('s3:download-content', 'bucket', 'a.txt.gz')).toEqual({
      success: true,
      content: 'zipped',
    });
    const bin = await call('s3:download-binary-content', 'bucket', 'a.bin');
    expect(bin.success).toBe(true);
    expect(Array.from(bin.data as Uint8Array)).toEqual([1, 2, 3]);
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(3);
  });

  it('returns the HEAD failure without downloading', async () => {
    s3Mock.on(HeadObjectCommand).rejects(new Error('NotFound'));
    for (const channel of ['s3:download-content', 's3:download-binary-content']) {
      expect(await call(channel, 'bucket', 'missing')).toEqual({ success: false, error: 'NotFound' });
    }
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it('honours a valid S3_BROWSER_MAX_CONTENT_BYTES override and ignores invalid ones', async () => {
    vi.stubEnv(MAX_CONTENT_BYTES_ENV, '10');
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 11 });
    const res = await call('s3:download-binary-content', 'bucket', 'k');
    expect(res.success).toBe(false);
    expect(res.error).toContain('10 bytes');
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    for (const bad of ['0', '-5', 'abc', '1.5', '', '99999999999999999999']) {
      expect(getMaxContentBytes({ [MAX_CONTENT_BYTES_ENV]: bad })).toBe(DEFAULT_MAX_CONTENT_BYTES);
    }
  });

  it('s3:download-content resolves {success:false, error} for a gzip bomb under the cap', async () => {
    vi.stubEnv(MAX_CONTENT_BYTES_ENV, '1000');
    const bomb = zlib.gzipSync(Buffer.alloc(200_000, 'a'));
    expect(bomb.length).toBeLessThan(1000);
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: bomb.length });
    s3Mock.on(GetObjectCommand).callsFake(async () => ({ Body: body(bomb) }));
    const res = await call('s3:download-content', 'bucket', 'bomb.txt.gz');
    expect(res.success).toBe(false);
    expect(res.content).toBeUndefined();
    expect(res.error).toContain('1000 bytes');
  });
});
