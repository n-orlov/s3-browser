import { shell } from 'electron';
import type { WebContents } from 'electron';
import { isExternalOpenAllowed } from './externalUrlPolicy';

/**
 * True when `target` belongs to the same origin as the application page.
 * `file:` URLs have an opaque origin, so they compare by exact path.
 */
export function isSameAppOrigin(target: string, appUrl: string): boolean {
  let t: URL;
  let a: URL;
  try {
    t = new URL(target);
    a = new URL(appUrl);
  } catch {
    return false;
  }
  if (t.protocol === 'file:' || a.protocol === 'file:') {
    return t.protocol === a.protocol && t.pathname === a.pathname;
  }
  return t.origin === a.origin;
}

interface NavigationEvent {
  url: string;
  preventDefault: () => void;
}

/**
 * Locks a window's web contents down: top-level navigation and redirects away
 * from the application origin are cancelled, and new windows are always denied
 * (an https or mailto URL is handed to the system browser, nothing else is).
 */
export function secureWebContents(
  webContents: Pick<WebContents, 'on' | 'setWindowOpenHandler'>,
  appUrl: string,
): void {
  const blockOffOrigin = (event: NavigationEvent): void => {
    if (!isSameAppOrigin(event.url, appUrl)) {
      event.preventDefault();
    }
  };
  webContents.on('will-navigate', blockOffOrigin);
  webContents.on('will-redirect', blockOffOrigin);

  webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalOpenAllowed(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}
