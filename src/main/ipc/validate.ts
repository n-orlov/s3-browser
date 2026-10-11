import type { IpcMainInvokeEvent } from 'electron';

/**
 * Argument validation for `ipcMain.handle` boundaries. The renderer is not
 * trusted: every positional argument is checked here before a handler touches
 * the filesystem, the OS shell or S3. A handler wrapped with `validated`
 * resolves to the channel's documented invalid-input result (and never runs)
 * when an argument has the wrong shape.
 */

/** S3 limits object keys (and therefore prefixes) to 1024 bytes of UTF-8. */
export const MAX_KEY_BYTES = 1024;
/** Longest accepted bucket name (S3 allows 63; some S3-compatible stores allow more). */
export const MAX_BUCKET_LENGTH = 255;
/** Longest accepted opaque identifier (profile names, operation ids, file paths). */
export const MAX_IDENTIFIER_LENGTH = 4096;

export interface ArgSpec {
  /** Parameter name, used in the error message. */
  name: string;
  /** What a valid value looks like, used in the error message. */
  expected: string;
  check: (value: unknown) => boolean;
}

const hasNul = (s: string): boolean => s.includes('\0');
const byteLength = (s: string): number => new TextEncoder().encode(s).length;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isBucketName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BUCKET_LENGTH &&
    !value.includes('/') &&
    !hasNul(value)
  );
}

/** A possibly empty key prefix. */
export function isKeyPrefix(value: unknown): value is string {
  return typeof value === 'string' && byteLength(value) <= MAX_KEY_BYTES && !hasNul(value);
}

export function isObjectKey(value: unknown): value is string {
  return isKeyPrefix(value) && value.length > 0;
}

export function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH && !hasNul(value);
}

const isOptional = (check: (v: unknown) => boolean) => (v: unknown) => v === undefined || check(v);

function isListObjectsOptions(value: unknown, allowToken: boolean): boolean {
  if (!isPlainObject(value)) return false;
  const allowed = ['bucket', 'prefix', 'delimiter', 'maxKeys', ...(allowToken ? ['continuationToken'] : [])];
  if (Object.keys(value).some(k => !allowed.includes(k))) return false;
  return (
    isBucketName(value.bucket) &&
    isOptional(isKeyPrefix)(value.prefix) &&
    isOptional(isKeyPrefix)(value.delimiter) &&
    isOptional(v => Number.isInteger(v) && (v as number) > 0)(value.maxKeys) &&
    isOptional(isIdentifier)(value.continuationToken)
  );
}

function isAppStateData(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const text = (v: unknown) => typeof v === 'string' && v.length <= MAX_IDENTIFIER_LENGTH && !hasNul(v);
  const nullableString = (v: unknown) => v === undefined || v === null || text(v);
  const stringOnly = (v: unknown) => v === undefined || text(v);
  return (
    Object.keys(value).every(k => k === 'lastProfile' || k === 'lastBucket' || k === 'lastPrefix') &&
    nullableString(value.lastProfile) &&
    nullableString(value.lastBucket) &&
    stringOnly(value.lastPrefix)
  );
}

/** Argument specs, one per positional parameter. */
export const arg = {
  /** Non-empty string (profile names, operation ids, paths, URLs). */
  identifier: (name: string): ArgSpec => ({
    name,
    expected: 'a non-empty string',
    check: isIdentifier,
  }),
  /** Any string, including the empty one. */
  text: (name: string): ArgSpec => ({
    name,
    expected: 'a string',
    check: v => typeof v === 'string' && !hasNul(v),
  }),
  bucket: (name: string): ArgSpec => ({
    name,
    expected: "a non-empty bucket name without '/'",
    check: isBucketName,
  }),
  key: (name: string): ArgSpec => ({
    name,
    expected: 'a non-empty object key of at most 1024 bytes',
    check: isObjectKey,
  }),
  /** Key prefix, possibly empty. */
  prefix: (name: string): ArgSpec => ({
    name,
    expected: 'a key prefix string of at most 1024 bytes',
    check: isKeyPrefix,
  }),
  /** Key prefix that must name a folder (non-empty). */
  nonEmptyPrefix: (name: string): ArgSpec => ({
    name,
    expected: 'a non-empty key prefix of at most 1024 bytes',
    check: isObjectKey,
  }),
  keys: (name: string): ArgSpec => ({
    name,
    expected: 'an array of object keys',
    check: v => Array.isArray(v) && v.every(isObjectKey),
  }),
  paths: (name: string): ArgSpec => ({
    name,
    expected: 'an array of non-empty strings',
    check: v => Array.isArray(v) && v.every(isIdentifier),
  }),
  listOptions: (name: string): ArgSpec => ({
    name,
    expected: 'an object { bucket, prefix?, delimiter?, maxKeys?, continuationToken? }',
    check: v => isListObjectsOptions(v, true),
  }),
  listAllOptions: (name: string): ArgSpec => ({
    name,
    expected: 'an object { bucket, prefix?, delimiter?, maxKeys? }',
    check: v => isListObjectsOptions(v, false),
  }),
  appStateData: (name: string): ArgSpec => ({
    name,
    expected: 'an object with only lastProfile, lastBucket (string or null) and lastPrefix (string)',
    check: isAppStateData,
  }),
};

/** Returns a message naming the first invalid argument, or null when all are valid. */
export function describeInvalidArgs(specs: readonly ArgSpec[], args: readonly unknown[]): string | null {
  for (let i = 0; i < specs.length; i++) {
    if (!specs[i].check(args[i])) {
      return `Invalid argument '${specs[i].name}': expected ${specs[i].expected}`;
    }
  }
  return null;
}

/**
 * Wraps an `ipcMain.handle` listener so that it validates its positional
 * arguments first. On failure the listener resolves to `onInvalid(message)`
 * and `handler` is not called; it never rejects because of bad input.
 */
export function validated<A extends unknown[], R>(
  specs: readonly ArgSpec[],
  onInvalid: (message: string) => NoInfer<R>,
  handler: (event: IpcMainInvokeEvent, ...args: A) => Promise<R> | R
): (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<R> {
  return async (event, ...args) => {
    const message = describeInvalidArgs(specs, args);
    if (message !== null) {
      return onInvalid(message);
    }
    return handler(event, ...(args as A));
  };
}

/** `{ success: false, error }` for channels returning that shape. */
export const failure = (message: string): { success: false; error: string } => ({
  success: false,
  error: message,
});
