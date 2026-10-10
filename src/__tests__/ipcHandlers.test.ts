import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import * as zlib from 'zlib';

type Handler = (event: unknown, ...args: any[]) => Promise<any>;

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
  loadAwsProfiles: vi.fn(),
  getProfile: vi.fn(),
  validateProfile: vi.fn(),
  getProfileTypeDescription: vi.fn(() => 'desc'),
}));

vi.mock('../main/services/appState', () => ({
  loadAppState: vi.fn(),
  saveAppState: vi.fn(),
}));

vi.mock('../main/services/s3Service', () => ({
  listBuckets: vi.fn(),
  listObjects: vi.fn(),
  listAllObjects: vi.fn(),
  parseS3Url: vi.fn(),
  getParentPrefix: vi.fn((k: string) => k.slice(0, k.lastIndexOf('/', k.length - 2) + 1)),
  getKeyName: vi.fn((k: string) => k.split('/').filter(Boolean).pop() ?? ''),
  clearS3Client: vi.fn(),
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
  uploadContent: vi.fn(),
  downloadContent: vi.fn(),
  downloadBinaryContent: vi.fn(),
  deleteFile: vi.fn(),
  deleteFiles: vi.fn(),
  deletePrefix: vi.fn(),
  renameFile: vi.fn(),
  copyFile: vi.fn(),
  getFileSize: vi.fn(),
  getObjectMetadata: vi.fn(),
  createEmptyFile: vi.fn(),
  createFolder: vi.fn(),
}));

import { app, dialog, shell } from 'electron';
import * as creds from '../main/services/awsCredentials';
import * as stateSvc from '../main/services/appState';
import * as s3 from '../main/services/s3Service';
import { registerCredentialsIpc, getCurrentProfileCredentials } from '../main/ipc/credentials';
import { registerS3Ipc } from '../main/ipc/s3';
import { registerAppStateIpc } from '../main/ipc/appState';

const m = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function call(channel: string, ...args: unknown[]): Promise<any> {
  const fn = h.handlers.get(channel) as Handler | undefined;
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn({}, ...args);
}

const profile = (over: Record<string, unknown> = {}) => ({
  name: 'dev',
  region: 'eu-west-1',
  hasCredentials: true,
  profileType: 'static',
  accessKeyId: 'AKIAABCDEFGH12345678',
  secretAccessKey: 'secret',
  sessionToken: 'tok',
  credentialProcess: 'proc',
  ...over,
});

beforeAll(() => {
  registerCredentialsIpc();
  registerS3Ipc();
  registerAppStateIpc();
});

describe('credentials IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m(creds.validateProfile).mockReturnValue({ valid: true });
  });

  it('aws:get-profiles maps profiles to ProfileInfo', async () => {
    m(creds.loadAwsProfiles).mockReturnValue({ profiles: [profile()], defaultRegion: 'us-east-1' });
    m(creds.validateProfile).mockReturnValue({ valid: false, reason: 'bad' });
    const res = await call('aws:get-profiles');
    expect(res.defaultRegion).toBe('us-east-1');
    expect(res.profiles).toEqual([
      expect.objectContaining({ name: 'dev', isValid: false, validationMessage: 'bad', profileTypeDescription: 'desc' }),
    ]);
  });

  it('aws:set-profile rejects unknown and invalid profiles', async () => {
    m(creds.getProfile).mockReturnValueOnce(undefined);
    expect(await call('aws:set-profile', 'nope')).toEqual({ success: false, error: "Profile 'nope' not found" });
    m(creds.getProfile).mockReturnValueOnce(profile());
    m(creds.validateProfile).mockReturnValueOnce({ valid: false, reason: 'no creds' });
    expect(await call('aws:set-profile', 'dev')).toEqual({ success: false, error: 'no creds' });
  });

  it('aws:set-profile selects a valid profile, visible through get-current-profile', async () => {
    m(creds.getProfile).mockReturnValue(profile());
    expect(await call('aws:set-profile', 'dev')).toEqual({ success: true });
    expect(await call('aws:get-current-profile')).toBe('dev');
    expect(getCurrentProfileCredentials()?.name).toBe('dev');
  });

  it('aws:get-profile-details masks credentials and returns null for unknown profiles', async () => {
    m(creds.getProfile).mockReturnValueOnce(undefined);
    expect(await call('aws:get-profile-details', 'nope')).toBeNull();
    m(creds.getProfile).mockReturnValueOnce(profile());
    const d = await call('aws:get-profile-details', 'dev');
    expect(d.accessKeyId).toBe('AKIA...5678');
    expect(d.secretAccessKey).toBe('********');
    expect(d.sessionToken).toBe('********');
    expect(d.credentialProcess).toBe('(configured)');
    m(creds.getProfile).mockReturnValueOnce(profile({ accessKeyId: 'SHORT', secretAccessKey: undefined, sessionToken: undefined, credentialProcess: undefined }));
    const s = await call('aws:get-profile-details', 'dev');
    expect(s.accessKeyId).toBe('****');
    expect(s.secretAccessKey).toBeUndefined();
    expect(s.credentialProcess).toBeUndefined();
  });

  it('aws:refresh-profiles clears a current profile that no longer exists', async () => {
    m(creds.getProfile).mockReturnValue(profile());
    await call('aws:set-profile', 'dev');
    m(creds.loadAwsProfiles).mockReturnValue({ profiles: [profile()], defaultRegion: undefined });
    expect((await call('aws:refresh-profiles')).currentProfile).toBe('dev');
    m(creds.loadAwsProfiles).mockReturnValue({ profiles: [], defaultRegion: undefined });
    expect((await call('aws:refresh-profiles')).currentProfile).toBeNull();
    expect(getCurrentProfileCredentials()).toBeNull();
  });
});

describe('app state IPC handlers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('app-state:load exposes only the public fields', async () => {
    m(stateSvc.loadAppState).mockReturnValue({ version: 1, lastProfile: 'p', lastBucket: 'b', lastPrefix: 'x/' });
    expect(await call('app-state:load')).toEqual({ lastProfile: 'p', lastBucket: 'b', lastPrefix: 'x/' });
  });

  it('app-state:save reports success, write failure and thrown errors', async () => {
    m(stateSvc.saveAppState).mockReturnValueOnce(true);
    expect(await call('app-state:save', { lastBucket: 'b' })).toEqual({ success: true });
    m(stateSvc.saveAppState).mockReturnValueOnce(false);
    expect(await call('app-state:save', {})).toEqual({ success: false, error: 'Failed to write state file' });
    m(stateSvc.saveAppState).mockImplementationOnce(() => { throw new Error('disk'); });
    expect(await call('app-state:save', {})).toEqual({ success: false, error: 'disk' });
    m(stateSvc.saveAppState).mockImplementationOnce(() => { throw 'x'; });
    expect(await call('app-state:save', {})).toEqual({ success: false, error: 'Unknown error saving state' });
  });
});

describe('S3 IPC handlers', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    m(creds.getProfile).mockReturnValue(profile());
    m(creds.validateProfile).mockReturnValue({ valid: true });
    await call('aws:set-profile', 'dev');
  });

  const NO_PROFILE = 'No AWS profile selected. Please select a profile first.';

  async function withoutProfile<T>(fn: () => Promise<T>): Promise<T> {
    m(creds.loadAwsProfiles).mockReturnValue({ profiles: [], defaultRegion: undefined });
    await call('aws:refresh-profiles');
    try {
      return await fn();
    } finally {
      await call('aws:set-profile', 'dev');
    }
  }

  it('returns the no-profile error from handlers that need credentials', async () => {
    const calls: Array<[string, unknown[]]> = [
      ['s3:list-buckets', []],
      ['s3:list-objects', [{ bucket: 'b' }]],
      ['s3:list-all-objects', [{ bucket: 'b' }, 'op']],
      ['s3:download-file', ['b', 'k', 'op']],
      ['s3:upload-file', ['b', '', '/a', 'op']],
      ['s3:upload-files', ['b', '', ['/a'], 'op']],
      ['s3:delete-file', ['b', 'k']],
      ['s3:delete-prefix', ['b', 'p/']],
      ['s3:rename-file', ['b', 'k', 'n']],
      ['s3:copy-file', ['b', 'k', 'b2', 'k2']],
      ['s3:upload-content', ['b', 'k', 'c']],
      ['s3:download-content', ['b', 'k']],
      ['s3:get-file-size', ['b', 'k']],
      ['s3:download-binary-content', ['b', 'k']],
      ['s3:get-object-metadata', ['b', 'k']],
      ['s3:create-file', ['b', 'k']],
      ['s3:create-folder', ['b', 'p/']],
    ];
    await withoutProfile(async () => {
      for (const [channel, args] of calls) {
        const res = await call(channel, ...args);
        expect(res, channel).toEqual(
          channel === 's3:upload-files'
            ? { success: false, results: [] }
            : channel === 's3:delete-prefix'
              ? { success: false, deletedCount: 0, failedCount: 1, error: NO_PROFILE }
              : { success: false, error: NO_PROFILE }
        );
      }
      expect(await call('s3:delete-files', 'b', ['a', 'b'])).toEqual({
        success: false, results: [], deletedCount: 0, failedCount: 2,
      });
    });
  });

  it('list handlers wrap results and errors', async () => {
    m(s3.listBuckets).mockResolvedValueOnce([{ name: 'b' }]);
    expect(await call('s3:list-buckets')).toEqual({ success: true, buckets: [{ name: 'b' }] });
    m(s3.listBuckets).mockRejectedValueOnce(new Error('denied'));
    expect(await call('s3:list-buckets')).toEqual({ success: false, error: 'denied' });
    m(s3.listBuckets).mockRejectedValueOnce('boom');
    expect(await call('s3:list-buckets')).toEqual({ success: false, error: 'Unknown error occurred' });

    m(s3.listObjects).mockResolvedValueOnce({ objects: [] });
    expect(await call('s3:list-objects', { bucket: 'b' })).toEqual({ success: true, result: { objects: [] } });
    expect(s3.listObjects).toHaveBeenCalledWith('dev', { bucket: 'b' });
    m(s3.listObjects).mockRejectedValueOnce(new Error('x'));
    expect(await call('s3:list-objects', { bucket: 'b' })).toEqual({ success: false, error: 'x' });

    m(s3.listAllObjects).mockResolvedValueOnce({ objects: [1] });
    expect(await call('s3:list-all-objects', { bucket: 'b' }, 'op1')).toEqual({ success: true, result: { objects: [1] } });
    m(s3.listAllObjects).mockRejectedValueOnce(new Error('y'));
    expect(await call('s3:list-all-objects', { bucket: 'b' }, 'op2')).toEqual({ success: false, error: 'y' });
  });

  it('s3:cancel-operation aborts a running operation and reports false for unknown ids', async () => {
    let signal: AbortSignal | undefined;
    let release!: () => void;
    m(s3.listAllObjects).mockImplementationOnce(
      (_p: string, _o: unknown, _cb: unknown, sig: AbortSignal) => {
        signal = sig;
        return new Promise(resolve => { release = () => resolve({ objects: [] }); });
      }
    );
    const pending = call('s3:list-all-objects', { bucket: 'b' }, 'cancel-me');
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(await call('s3:cancel-operation', 'cancel-me')).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(await call('s3:cancel-operation', 'cancel-me')).toBe(false);
    release();
    await pending;
    expect(await call('s3:cancel-operation', 'unknown')).toBe(false);
  });

  it('s3:parse-url, parent prefix, key name and clear-client delegate to the service', async () => {
    m(s3.parseS3Url).mockReturnValueOnce({ bucket: 'b', key: 'k' });
    expect(await call('s3:parse-url', 's3://b/k')).toEqual({ success: true, bucket: 'b', key: 'k' });
    m(s3.parseS3Url).mockReturnValueOnce(null);
    expect(await call('s3:parse-url', 'bad')).toEqual({ success: false, error: 'Invalid S3 URL format' });
    m(s3.parseS3Url).mockImplementationOnce(() => { throw new Error('parse'); });
    expect(await call('s3:parse-url', 'bad')).toEqual({ success: false, error: 'parse' });
    m(s3.parseS3Url).mockImplementationOnce(() => { throw 1; });
    expect(await call('s3:parse-url', 'bad')).toEqual({ success: false, error: 'Unknown error occurred' });
    expect(await call('s3:get-parent-prefix', 'a/b/c.txt')).toBe('a/b/');
    expect(await call('s3:get-key-name', 'a/b/c.txt')).toBe('c.txt');
    await call('s3:clear-client');
    expect(s3.clearS3Client).toHaveBeenCalledTimes(1);
  });

  it('s3:download-file uses the downloads folder and avoids name collisions', async () => {
    const fsMod = await import('fs');
    const access = vi.spyOn(fsMod.promises, 'access');
    access.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('ENOENT'));
    m(s3.downloadFile).mockResolvedValueOnce({ success: true });
    const res = await call('s3:download-file', 'b', 'dir/report.csv', 'op');
    expect(res).toEqual({ success: true, localPath: '/downloads/report (2).csv' });
    expect(s3.downloadFile).toHaveBeenCalledWith('dev', 'b', 'dir/report.csv', '/downloads/report (2).csv', undefined, expect.any(AbortSignal));

    access.mockRejectedValue(new Error('ENOENT'));
    m(s3.downloadFile).mockResolvedValueOnce({ success: false, error: 'nope' });
    expect(await call('s3:download-file', 'b', 'k', 'op')).toEqual({ success: false, error: 'nope' });
    access.mockRestore();
  });

  it('s3:upload-file builds the key from prefix and file name', async () => {
    m(s3.uploadFile).mockResolvedValue({ success: true });
    expect(await call('s3:upload-file', 'b', 'p/', '/tmp/a.txt', 'op')).toEqual({ success: true });
    expect(s3.uploadFile).toHaveBeenLastCalledWith('dev', 'b', 'p/a.txt', '/tmp/a.txt', undefined, expect.any(AbortSignal));
    await call('s3:upload-file', 'b', '', '/tmp/a.txt', 'op');
    expect(s3.uploadFile).toHaveBeenLastCalledWith('dev', 'b', 'a.txt', '/tmp/a.txt', undefined, expect.any(AbortSignal));
  });

  it('s3:upload-files aggregates per-file results and honours cancellation', async () => {
    m(s3.uploadFile).mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: 'bad' });
    const res = await call('s3:upload-files', 'b', 'p/', ['/x/a', '/x/b'], 'op');
    expect(res).toEqual({
      success: false,
      results: [{ path: '/x/a', success: true }, { path: '/x/b', success: false, error: 'bad' }],
    });

    m(s3.uploadFile).mockImplementationOnce(async () => {
      await call('s3:cancel-operation', 'op-cancel');
      return { success: true };
    });
    const cancelled = await call('s3:upload-files', 'b', '', ['/x/a', '/x/b'], 'op-cancel');
    expect(cancelled.results[1]).toEqual({ path: '/x/b', success: false, error: 'Operation cancelled' });
    expect(cancelled.success).toBe(false);
  });

  it('delete, rename, copy, create and metadata handlers delegate and wrap errors', async () => {
    m(s3.deleteFile).mockResolvedValueOnce({ success: true });
    expect(await call('s3:delete-file', 'b', 'k')).toEqual({ success: true });
    m(s3.deleteFiles).mockResolvedValueOnce({ success: true, results: [], deletedCount: 1, failedCount: 0 });
    expect((await call('s3:delete-files', 'b', ['k'])).deletedCount).toBe(1);
    m(s3.deleteFiles).mockRejectedValueOnce(new Error('x'));
    expect(await call('s3:delete-files', 'b', ['k'])).toEqual({ success: false, results: [], deletedCount: 0, failedCount: 1 });
    m(s3.deletePrefix).mockResolvedValueOnce({ success: true, deletedCount: 2, failedCount: 0 });
    expect((await call('s3:delete-prefix', 'b', 'p/')).deletedCount).toBe(2);

    m(s3.renameFile).mockResolvedValueOnce({ success: true });
    await call('s3:rename-file', 'b', 'a/b/old.txt', 'new.txt');
    expect(s3.renameFile).toHaveBeenCalledWith('dev', 'b', 'a/b/old.txt', 'a/b/new.txt');
    m(s3.copyFile).mockResolvedValueOnce({ success: true });
    await call('s3:copy-file', 'b', 'k', 'b2', 'k2');
    expect(s3.copyFile).toHaveBeenCalledWith('dev', 'b', 'k', 'b2', 'k2');

    m(s3.getFileSize).mockResolvedValueOnce({ success: true, size: 3 });
    expect(await call('s3:get-file-size', 'b', 'k')).toEqual({ success: true, size: 3 });
    m(s3.getObjectMetadata).mockResolvedValueOnce({ success: true, metadata: {} });
    expect(await call('s3:get-object-metadata', 'b', 'k')).toEqual({ success: true, metadata: {} });
    m(s3.createEmptyFile).mockResolvedValueOnce({ success: true });
    expect(await call('s3:create-file', 'b', 'k')).toEqual({ success: true });
    m(s3.createFolder).mockResolvedValueOnce({ success: true });
    expect(await call('s3:create-folder', 'b', 'p/')).toEqual({ success: true });

    for (const [svc, channel, args] of [
      [s3.deleteFile, 's3:delete-file', ['b', 'k']],
      [s3.renameFile, 's3:rename-file', ['b', 'a', 'n']],
      [s3.copyFile, 's3:copy-file', ['b', 'k', 'b', 'k2']],
      [s3.getFileSize, 's3:get-file-size', ['b', 'k']],
      [s3.getObjectMetadata, 's3:get-object-metadata', ['b', 'k']],
      [s3.createEmptyFile, 's3:create-file', ['b', 'k']],
      [s3.createFolder, 's3:create-folder', ['b', 'p/']],
      [s3.deletePrefix, 's3:delete-prefix', ['b', 'p/']],
    ] as Array<[unknown, string, unknown[]]>) {
      m(svc).mockRejectedValueOnce(new Error('svc failed'));
      const res = await call(channel, ...args);
      expect(res.success, channel).toBe(false);
      expect(res.error, channel).toBe('svc failed');
    }
  });

  it('s3:upload-content gzips .gz keys and reports compression failures', async () => {
    m(s3.uploadContent).mockResolvedValue({ success: true });
    await call('s3:upload-content', 'b', 'a.txt', 'hello');
    expect(s3.uploadContent).toHaveBeenLastCalledWith('dev', 'b', 'a.txt', 'hello');
    await call('s3:upload-content', 'b', 'a.txt.gz', 'hello');
    const sent = m(s3.uploadContent).mock.calls.at(-1)?.[3] as Buffer;
    expect(zlib.gunzipSync(sent).toString()).toBe('hello');
    m(s3.uploadContent).mockRejectedValueOnce(new Error('put failed'));
    expect(await call('s3:upload-content', 'b', 'a.gz', 'x')).toEqual({
      success: false, error: 'Gzip compression failed: put failed',
    });
  });

  it('s3:download-content gunzips .gz keys and wraps failures', async () => {
    m(s3.getFileSize).mockResolvedValue({ success: true, size: 10 });
    m(s3.downloadContent).mockResolvedValueOnce({ success: true, content: 'plain' });
    expect(await call('s3:download-content', 'b', 'a.txt')).toEqual({ success: true, content: 'plain' });

    m(s3.downloadBinaryContent).mockResolvedValueOnce({ success: true, data: zlib.gzipSync('zipped') });
    expect(await call('s3:download-content', 'b', 'a.gz')).toEqual({ success: true, content: 'zipped' });
    m(s3.downloadBinaryContent).mockResolvedValueOnce({ success: false, error: 'missing' });
    expect(await call('s3:download-content', 'b', 'a.gz')).toEqual({ success: false, error: 'missing' });
    m(s3.downloadBinaryContent).mockResolvedValueOnce({ success: false });
    expect(await call('s3:download-content', 'b', 'a.gz')).toEqual({ success: false, error: 'Failed to download file' });
    m(s3.downloadBinaryContent).mockResolvedValueOnce({ success: true, data: Buffer.from('not gzip') });
    const bad = await call('s3:download-content', 'b', 'a.gz');
    expect(bad.success).toBe(false);
  });

  it('s3:download-binary-content returns a Uint8Array or the service error', async () => {
    m(s3.getFileSize).mockResolvedValue({ success: true, size: 10 });
    m(s3.downloadBinaryContent).mockResolvedValueOnce({ success: true, data: Buffer.from([1, 2, 3]) });
    const ok = await call('s3:download-binary-content', 'b', 'k');
    expect(ok.success).toBe(true);
    expect(Array.from(ok.data as Uint8Array)).toEqual([1, 2, 3]);
    m(s3.downloadBinaryContent).mockResolvedValueOnce({ success: false, error: 'e' });
    expect(await call('s3:download-binary-content', 'b', 'k')).toEqual({ success: false, error: 'e' });
  });

  it('dialog and shell handlers use the electron APIs', async () => {
    m(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await call('s3:show-open-dialog')).toBeNull();
    m(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/a'] });
    expect(await call('s3:show-open-dialog')).toEqual(['/a']);
    await call('s3:open-downloads-folder');
    expect(app.getPath).toHaveBeenCalledWith('downloads');
    expect(shell.openPath).toHaveBeenCalledWith('/downloads');
    await call('s3:show-file-in-folder', '/downloads/a.txt');
    expect(shell.showItemInFolder).toHaveBeenCalledWith('/downloads/a.txt');
  });
});
