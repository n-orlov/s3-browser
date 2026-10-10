import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const h = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>() }));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      h.handlers.set(channel, fn);
    }),
  },
  app: { getPath: vi.fn(() => '/downloads') },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
}));

vi.mock('../main/services/awsCredentials', () => ({
  loadAwsProfiles: vi.fn(() => ({ profiles: [], defaultRegion: undefined })),
  getProfile: vi.fn(() => ({ name: 'dev', hasCredentials: true, profileType: 'static' })),
  validateProfile: vi.fn(() => ({ valid: true })),
  getProfileTypeDescription: vi.fn(() => 'desc'),
}));

vi.mock('../main/services/appState', () => ({
  loadAppState: vi.fn(() => ({ lastProfile: null, lastBucket: null, lastPrefix: '' })),
  saveAppState: vi.fn(() => true),
}));

vi.mock('../main/services/s3Service', () => ({
  listBuckets: vi.fn(),
  listObjects: vi.fn(),
  listAllObjects: vi.fn(),
  parseS3Url: vi.fn(),
  getParentPrefix: vi.fn(() => ''),
  getKeyName: vi.fn(() => ''),
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
import { registerCredentialsIpc } from '../main/ipc/credentials';
import { registerS3Ipc } from '../main/ipc/s3';
import { registerAppStateIpc } from '../main/ipc/appState';

const INVALID = expect.stringContaining('Invalid argument');
const errorResult = { success: false, error: INVALID };

interface Row {
  /** Arguments the renderer legitimately sends. */
  valid: unknown[];
  /** Result an invalid argument list resolves to. */
  invalid?: unknown;
  /** The channel takes no arguments: extra arguments are ignored. */
  noArgs?: true;
  /** Argument positions where the empty string is legitimate. */
  emptyOk?: number[];
  /** Further invalid argument lists specific to the channel. */
  extra?: unknown[][];
}

const listOptions = { bucket: 'b', prefix: 'p/' };

/** One row per registered channel; the first test fails when a channel has none. */
const TABLE: Record<string, Row> = {
  'aws:get-profiles': { valid: [], noArgs: true },
  'aws:set-profile': { valid: ['dev'], invalid: errorResult },
  'aws:get-current-profile': { valid: [], noArgs: true },
  'aws:get-profile-details': { valid: ['dev'], invalid: null },
  'aws:refresh-profiles': { valid: [], noArgs: true },
  'app-state:load': { valid: [], noArgs: true },
  'app-state:save': {
    valid: [{ lastBucket: 'b', lastPrefix: 'a/' }],
    invalid: errorResult,
    extra: [[{ lastPrefix: 5 }], [{ lastBucket: 7 }], [{ unknown: 'x' }], [['x']], [Object.create({ lastPrefix: 'x' })]],
  },
  's3:list-buckets': { valid: [], noArgs: true },
  's3:list-objects': {
    valid: [listOptions],
    invalid: errorResult,
    extra: [[{}], [{ bucket: '' }], [{ bucket: 'b', prefix: 3 }], [{ bucket: 'b', maxKeys: 'many' }], [{ bucket: 'b', maxKeys: -1 }], [{ bucket: 'b/x' }]],
  },
  's3:list-all-objects': {
    valid: [listOptions, 'op1'],
    invalid: errorResult,
    extra: [[{ bucket: 'b', continuationToken: 't' }, 'op1'], [{ bucket: 'b', prefix: {} }, 'op1']],
  },
  's3:cancel-operation': { valid: ['op1'], invalid: false },
  's3:parse-url': { valid: ['s3://b/k'], invalid: errorResult },
  's3:get-parent-prefix': { valid: ['a/b'], invalid: '', emptyOk: [0] },
  's3:get-key-name': { valid: ['a/b'], invalid: '', emptyOk: [0] },
  's3:clear-client': { valid: [], noArgs: true },
  's3:download-file': { valid: ['b', 'k', 'op1'], invalid: errorResult },
  's3:upload-file': { valid: ['b', 'p/', '/tmp/f', 'op1'], invalid: errorResult, emptyOk: [1] },
  's3:upload-files': {
    valid: ['b', 'p/', ['/tmp/f'], 'op1'],
    invalid: { success: false, results: [] },
    emptyOk: [1],
    extra: [['b', 'p/', [42], 'op1'], ['b', 'p/', [''], 'op1'], ['b', 'p/', 'not-an-array', 'op1']],
  },
  's3:delete-file': { valid: ['b', 'k'], invalid: errorResult },
  's3:delete-files': {
    valid: ['b', ['k1', 'k2']],
    invalid: { success: false, results: [], deletedCount: 0, failedCount: 0 },
    extra: [['b', [42]], ['b', ['']], ['b', 'k1'], ['b', [null]]],
  },
  's3:delete-prefix': {
    valid: ['b', 'p/'],
    invalid: { success: false, deletedCount: 0, failedCount: 0, error: INVALID },
  },
  's3:rename-file': { valid: ['b', 'a/k', 'new'], invalid: errorResult },
  's3:copy-file': { valid: ['b', 'k', 'b2', 'k2'], invalid: errorResult },
  's3:upload-content': { valid: ['b', 'k', 'text'], invalid: errorResult, emptyOk: [2] },
  's3:download-content': { valid: ['b', 'k'], invalid: errorResult },
  's3:get-file-size': { valid: ['b', 'k'], invalid: errorResult },
  's3:download-binary-content': { valid: ['b', 'k'], invalid: errorResult },
  's3:show-open-dialog': { valid: [], noArgs: true },
  's3:open-downloads-folder': { valid: [], noArgs: true },
  's3:show-file-in-folder': { valid: ['/tmp/f'], invalid: undefined },
  's3:get-object-metadata': { valid: ['b', 'k'], invalid: errorResult },
  's3:create-file': { valid: ['b', 'k'], invalid: errorResult },
  's3:create-folder': { valid: ['b', 'p/'], invalid: errorResult },
};

/** Wrong-typed argument lists derived from a row's valid list, plus its extras. */
function invalidCalls(row: Row): unknown[][] {
  const calls: unknown[][] = [];
  if (row.valid.length > 0) calls.push([]);
  row.valid.forEach((v, i) => {
    const wrong: unknown[] = [42, null];
    if (typeof v === 'string' && !row.emptyOk?.includes(i)) wrong.push('');
    if (Array.isArray(v)) wrong.push('x');
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) wrong.push(['x']);
    for (const w of wrong) calls.push(row.valid.map((a, j) => (j === i ? w : a)));
  });
  calls.push(...(row.extra ?? []));
  return calls;
}

function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = h.handlers.get(channel) as Handler | undefined;
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn({}, ...args);
}

const serviceMocks = (): ReturnType<typeof vi.fn>[] =>
  [
    ...Object.values(s3),
    stateSvc.saveAppState,
    creds.getProfile,
    app.getPath,
    dialog.showOpenDialog,
    shell.openPath,
    shell.showItemInFolder,
  ] as unknown as ReturnType<typeof vi.fn>[];

const isDeepEqual = (a: unknown, b: unknown): boolean => {
  try {
    expect(a).toEqual(b);
    return true;
  } catch {
    return false;
  }
};

describe('IPC argument validation at the ipcMain.handle boundary', () => {
  beforeAll(async () => {
    registerCredentialsIpc();
    registerS3Ipc();
    registerAppStateIpc();
    // A profile is selected, so only validation can explain an error result.
    await call('aws:set-profile', 'dev');
  });

  beforeEach(() => {
    for (const fn of serviceMocks()) fn.mockClear();
  });

  it('has a table row for every registered channel and no stale rows', () => {
    const registered = [...h.handlers.keys()].sort();
    expect(registered.length).toBeGreaterThan(0);
    const missing = registered.filter(c => !(c in TABLE));
    const stale = Object.keys(TABLE).filter(c => !h.handlers.has(c));
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });

  const withArgs = Object.entries(TABLE).filter(([, row]) => !row.noArgs);
  const noArgs = Object.entries(TABLE).filter(([, row]) => row.noArgs);

  describe.each(withArgs)('%s', (channel, row) => {
    it.each(invalidCalls(row).map(args => [JSON.stringify(args) ?? 'undefined', args] as const))(
      'resolves to the invalid-input result for %s',
      async (_label, args) => {
        await expect(call(channel, ...args)).resolves.toEqual(row.invalid);
        for (const fn of serviceMocks()) expect(fn).not.toHaveBeenCalled();
      }
    );

    it('lets valid arguments through to the handler', async () => {
      const result = await call(channel, ...row.valid);
      const reached = serviceMocks().some(fn => fn.mock.calls.length > 0);
      // A channel whose invalid result is also a plausible real result is told
      // apart by whether the underlying service was called.
      expect(reached || !isDeepEqual(result, row.invalid) || channel === 's3:cancel-operation').toBe(true);
    });
  });

  it('s3:cancel-operation aborts a running operation for a valid id', async () => {
    let release: (v: unknown) => void = () => undefined;
    (s3.listAllObjects as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_p: string, _o: unknown, _cb: unknown, signal: AbortSignal) =>
        new Promise(resolve => {
          release = resolve;
          signal.addEventListener('abort', () => resolve({ objects: [] }));
        })
    );
    const running = call('s3:list-all-objects', listOptions, 'op-cancel');
    await expect(call('s3:cancel-operation', 'op-cancel')).resolves.toBe(true);
    await running;
    release(undefined);
    await expect(call('s3:cancel-operation', 'op-cancel')).resolves.toBe(false);
  });

  describe.each(noArgs)('%s', (channel, row) => {
    it('ignores unexpected arguments', async () => {
      const baseline = await call(channel, ...row.valid);
      await expect(call(channel, 42, { x: 1 }, null)).resolves.toEqual(baseline);
    });
  });
});
