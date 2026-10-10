import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const handlers = vi.hoisted(() => [] as string[]);

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string) => {
      handlers.push(channel);
    }),
  },
  app: { getPath: vi.fn(() => '/tmp') },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
}));

import { registerCredentialsIpc } from '../main/ipc/credentials';
import { registerS3Ipc } from '../main/ipc/s3';
import { registerAppStateIpc } from '../main/ipc/appState';

const root = path.join(__dirname, '../..');

/** Channels listed in the first column of the tables in SPEC.md section "2. IPC surface". */
export function specChannels(spec: string): string[] {
  const lines = spec.split('\n');
  const start = lines.findIndex(l => /^## 2\. IPC surface\s*$/.test(l));
  if (start < 0) throw new Error('SPEC.md has no "## 2. IPC surface" section');
  const channels: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    const m = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (m) channels.push(m[1]);
  }
  return channels;
}

/** Channels the preload script passes to ipcRenderer.invoke. */
export function preloadChannels(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/ipcRenderer\s*\.\s*invoke\(\s*['"`]([^'"`]+)['"`]/g)) {
    out.add(m[1]);
  }
  return [...out];
}

function diff(a: string[], b: string[]): string[] {
  const set = new Set(b);
  return a.filter(x => !set.has(x)).sort();
}

describe('IPC channel parity', () => {
  let registered: string[];

  beforeEach(() => {
    handlers.length = 0;
    registerCredentialsIpc();
    registerS3Ipc();
    registerAppStateIpc();
    registered = [...handlers];
  });

  it('registers each channel exactly once', () => {
    expect(registered.length).toBeGreaterThan(0);
    expect(new Set(registered).size).toBe(registered.length);
  });

  it('SPEC.md lists every registered channel and nothing else', () => {
    const spec = specChannels(fs.readFileSync(path.join(root, 'SPEC.md'), 'utf-8'));
    expect(new Set(spec).size, 'SPEC.md lists a channel twice').toBe(spec.length);
    expect(diff(registered, spec), 'registered but missing from SPEC.md').toEqual([]);
    expect(diff(spec, registered), 'listed in SPEC.md but not registered').toEqual([]);
  });

  it('the preload script invokes only registered channels', () => {
    const invoked = preloadChannels(
      fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf-8')
    );
    expect(invoked.length).toBeGreaterThan(0);
    expect(diff(invoked, registered), 'invoked by preload but not registered in main').toEqual([]);
  });

  it('every registered channel is reachable from the preload script', () => {
    const invoked = preloadChannels(
      fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf-8')
    );
    expect(diff(registered, invoked), 'registered but never invoked by preload').toEqual([]);
  });

  describe('channel extraction helpers', () => {
    it('detect a channel removed from or added to the SPEC table', () => {
      const spec = fs.readFileSync(path.join(root, 'SPEC.md'), 'utf-8');
      const without = spec
        .split('\n')
        .filter(l => !l.startsWith('| `s3:clear-client` |'))
        .join('\n');
      expect(diff(registered, specChannels(without))).toEqual(['s3:clear-client']);
      const withFake = spec.replace(
        '| `s3:clear-client` |',
        '| `s3:fake-channel` | none | `void` |\n| `s3:clear-client` |'
      );
      expect(diff(specChannels(withFake), registered)).toEqual(['s3:fake-channel']);
    });

    it('detect a preload invoke with no registered handler', () => {
      const invoked = preloadChannels(
        "ipcRenderer.invoke('get-app-version'); ipcRenderer.invoke('s3:list-buckets')"
      );
      expect(diff(invoked, registered)).toEqual(['get-app-version']);
    });
  });
});
