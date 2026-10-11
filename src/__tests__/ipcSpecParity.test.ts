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

/** The "IPC input" bullet of SPEC.md section 3, or null. */
export function specIpcInputBullet(spec: string): string | null {
  const line = spec.split('\n').find(l => l.startsWith('- **IPC input.**'));
  return line ?? null;
}

/** Lines of SPEC.md that state or imply that handlers do not validate arguments at runtime. */
export function negatedValidationClaims(spec: string): string[] {
  const patterns = [
    /\b(?:do|does|did)\s+not\s+validate\b/i,
    /\b(?:not|never)\s+(?:checked|validated|verified)\b[^.]*\bat runtime\b/i,
    /\bunvalidated\b/i,
    /\bwithout\s+(?:runtime\s+)?validation\b/i,
    /\bwith TypeScript only\b/i,
    /\bTypeScript\s+(?:types\s+)?only\b/i,
  ];
  return spec.split('\n').filter(l => patterns.some(p => p.test(l)));
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

  describe('SPEC.md on runtime argument validation', () => {
    const spec = fs.readFileSync(path.join(root, 'SPEC.md'), 'utf-8');

    it('section 3 "IPC input" states that handlers validate through validate.ts', () => {
      const bullet = specIpcInputBullet(spec);
      expect(bullet, 'section 3 has no "IPC input" bullet').not.toBeNull();
      expect(bullet).toContain('src/main/ipc/validate.ts');
      expect(bullet).toMatch(/validates/);
      expect(bullet).toMatch(/at runtime/);
      expect(bullet).toMatch(/before doing any work/);
    });

    it('no passage says or implies that handlers skip runtime validation', () => {
      expect(negatedValidationClaims(spec)).toEqual([]);
    });

    it('the detector flags contradicting wordings and accepts the real ones', () => {
      expect(negatedValidationClaims('Handlers do not validate the shape of arguments.')).toHaveLength(1);
      expect(negatedValidationClaims('Arguments are not checked at runtime.')).toHaveLength(1);
      expect(negatedValidationClaims('Handlers type parameters with TypeScript only.')).toHaveLength(1);
      expect(negatedValidationClaims('Inputs are unvalidated.')).toHaveLength(1);
      expect(negatedValidationClaims('Every handler validates its arguments at runtime.')).toEqual([]);
      expect(negatedValidationClaims('Invalid arguments never reach these paths.')).toEqual([]);
    });
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
