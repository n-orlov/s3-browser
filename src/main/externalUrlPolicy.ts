/**
 * Schemes the main process may hand to the operating system through
 * `shell.openExternal`. Everything else (http, file, javascript, data,
 * custom protocol handlers, malformed input) is refused.
 */
const EXTERNAL_OPEN_PROTOCOLS: ReadonlySet<string> = new Set(['https:', 'mailto:']);

export function isExternalOpenAllowed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return EXTERNAL_OPEN_PROTOCOLS.has(parsed.protocol);
}
