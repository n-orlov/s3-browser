import { describe, it, expect, vi, beforeEach } from 'vitest';

const openExternal = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ shell: { openExternal } }));

import { isExternalOpenAllowed } from '../main/externalUrlPolicy';
import { secureWebContents, isSameAppOrigin } from '../main/windowSecurity';

describe('isExternalOpenAllowed', () => {
  it.each([
    ['https://example.com/a?b=1', true],
    ['mailto:someone@example.com', true],
    ['http://example.com', false],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['data:text/html,<script>alert(1)</script>', false],
    ['ms-msdt:/id PCWDiagnostic', false],
    ['myapp://do-something', false],
    ['not a url', false],
    ['', false],
  ])('%s -> %s', (url, expected) => {
    expect(isExternalOpenAllowed(url)).toBe(expected);
  });
});

describe('isSameAppOrigin', () => {
  it('compares http origins and file paths', () => {
    expect(isSameAppOrigin('http://localhost:5173/x#y', 'http://localhost:5173')).toBe(true);
    expect(isSameAppOrigin('http://localhost:5174/', 'http://localhost:5173')).toBe(false);
    expect(isSameAppOrigin('file:///app/index.html#/r', 'file:///app/index.html')).toBe(true);
    expect(isSameAppOrigin('file:///etc/passwd', 'file:///app/index.html')).toBe(false);
    expect(isSameAppOrigin('https://evil.example', 'file:///app/index.html')).toBe(false);
    expect(isSameAppOrigin('garbage', 'file:///app/index.html')).toBe(false);
  });
});

describe('isSameAppOrigin file: versus opaque and http origins', () => {
  it('never treats a file: target as the same origin as a non-file app page, even with an opaque origin', () => {
    expect(isSameAppOrigin('file:///x', 'data:text/html,hi')).toBe(false);
    expect(isSameAppOrigin('file:///x', 'http://localhost:5173')).toBe(false);
  });

  it('never treats a non-file target as the same origin as a file: app page, even with an opaque origin', () => {
    expect(isSameAppOrigin('data:text/html,hi', 'file:///x')).toBe(false);
    expect(isSameAppOrigin('http://localhost:5173/x', 'file:///x')).toBe(false);
  });

  it('requires matching protocols for a file: comparison even when the paths are identical', () => {
    expect(isSameAppOrigin('file:///app/index.html', 'http://localhost/app/index.html')).toBe(false);
    expect(isSameAppOrigin('http://localhost/app/index.html', 'file:///app/index.html')).toBe(false);
  });

  it('compares two non-file URLs by origin only, ignoring the path', () => {
    expect(isSameAppOrigin('https://a.example/p', 'https://a.example/q')).toBe(true);
    expect(isSameAppOrigin('https://a.example/p', 'http://a.example/p')).toBe(false);
  });
});

describe('secureWebContents', () => {
  const appUrl = 'file:///app/renderer/index.html';
  let handlers: Record<string, (event: { url: string; preventDefault: () => void }) => void>;
  let openHandler: (d: { url: string }) => { action: string };
  let webContents: Parameters<typeof secureWebContents>[0];

  beforeEach(() => {
    openExternal.mockReset();
    handlers = {};
    webContents = {
      on: vi.fn((name: string, fn: never) => {
        handlers[name] = fn;
      }),
      setWindowOpenHandler: vi.fn((fn: never) => {
        openHandler = fn;
      }),
    } as unknown as typeof webContents;
    secureWebContents(webContents, appUrl);
  });

  it.each(['will-navigate', 'will-redirect'])('%s to an external origin is prevented', (name) => {
    const preventDefault = vi.fn();
    handlers[name]({ url: 'https://evil.example/', preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it.each(['will-navigate', 'will-redirect'])('%s within the app origin is allowed', (name) => {
    const preventDefault = vi.fn();
    handlers[name]({ url: `${appUrl}#/bucket`, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('setWindowOpenHandler denies and opens an https URL externally', () => {
    expect(openHandler({ url: 'https://example.com/docs' })).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs');
  });

  it.each(['http://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'myapp://x', 'bad'])(
    'setWindowOpenHandler denies %s without calling shell.openExternal',
    (url) => {
      expect(openHandler({ url })).toEqual({ action: 'deny' });
      expect(openExternal).not.toHaveBeenCalled();
    },
  );
});
