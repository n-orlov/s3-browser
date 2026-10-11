import { describe, it, expect, vi } from 'vitest';
import {
  MAX_BUCKET_LENGTH,
  MAX_IDENTIFIER_LENGTH,
  MAX_KEY_BYTES,
  arg,
  describeInvalidArgs,
  failure,
  isBucketName,
  isIdentifier,
  isKeyPrefix,
  isObjectKey,
  isPlainObject,
  validated,
} from '../main/ipc/validate';

describe('size limits', () => {
  it('documents the S3 and identifier bounds', () => {
    expect(MAX_KEY_BYTES).toBe(1024);
    expect(MAX_BUCKET_LENGTH).toBe(255);
    expect(MAX_IDENTIFIER_LENGTH).toBe(4096);
  });
});

describe('isPlainObject', () => {
  it('accepts literals and null-prototype objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it('rejects arrays, null, primitives and instances of other prototypes', () => {
    class Foo {}
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject('x')).toBe(false);
    expect(isPlainObject(1)).toBe(false);
    expect(isPlainObject(new Foo())).toBe(false);
    expect(isPlainObject(Object.create({ inherited: 1 }))).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
  });
});

describe('isBucketName', () => {
  it('accepts names up to exactly the maximum length', () => {
    expect(isBucketName('b')).toBe(true);
    expect(isBucketName('a'.repeat(MAX_BUCKET_LENGTH))).toBe(true);
  });

  it('rejects an over-long name, empty, slash, NUL and non-strings', () => {
    expect(isBucketName('a'.repeat(MAX_BUCKET_LENGTH + 1))).toBe(false);
    expect(isBucketName('')).toBe(false);
    expect(isBucketName('a/b')).toBe(false);
    expect(isBucketName('a\0b')).toBe(false);
    expect(isBucketName(5)).toBe(false);
    expect(isBucketName(undefined)).toBe(false);
  });
});

describe('isKeyPrefix / isObjectKey', () => {
  it('measures the limit in UTF-8 bytes, inclusive of exactly 1024', () => {
    expect(isKeyPrefix('a'.repeat(MAX_KEY_BYTES))).toBe(true);
    expect(isKeyPrefix('a'.repeat(MAX_KEY_BYTES + 1))).toBe(false);
    // 512 two-byte characters = 1024 bytes but only 512 UTF-16 units.
    expect(isKeyPrefix('é'.repeat(512))).toBe(true);
    expect(isKeyPrefix('é'.repeat(513))).toBe(false);
    // 3-byte characters: 342 * 3 = 1026 bytes, 342 units (well under 1024 units).
    expect(isKeyPrefix('€'.repeat(342))).toBe(false);
    expect(isKeyPrefix('€'.repeat(341))).toBe(true);
  });

  it('allows the empty prefix but not the empty key, and rejects NUL and non-strings', () => {
    expect(isKeyPrefix('')).toBe(true);
    expect(isObjectKey('')).toBe(false);
    expect(isObjectKey('k')).toBe(true);
    expect(isObjectKey('a'.repeat(MAX_KEY_BYTES))).toBe(true);
    expect(isObjectKey('a'.repeat(MAX_KEY_BYTES + 1))).toBe(false);
    expect(isKeyPrefix('a\0')).toBe(false);
    expect(isObjectKey('a\0')).toBe(false);
    expect(isKeyPrefix(1)).toBe(false);
    expect(isObjectKey(null)).toBe(false);
  });
});

describe('isIdentifier', () => {
  it('accepts up to exactly the maximum length', () => {
    expect(isIdentifier('x')).toBe(true);
    expect(isIdentifier('x'.repeat(MAX_IDENTIFIER_LENGTH))).toBe(true);
  });

  it('rejects empty, over-long, NUL and non-strings', () => {
    expect(isIdentifier('')).toBe(false);
    expect(isIdentifier('x'.repeat(MAX_IDENTIFIER_LENGTH + 1))).toBe(false);
    expect(isIdentifier('x\0')).toBe(false);
    expect(isIdentifier(3)).toBe(false);
  });
});

describe('arg specs', () => {
  it('carry the parameter name and a description of the expected value', () => {
    expect(arg.identifier('p')).toMatchObject({
      name: 'p',
      expected: 'a non-empty string',
    });
    expect(arg.text('p')).toMatchObject({ name: 'p', expected: 'a string' });
    expect(arg.bucket('p')).toMatchObject({
      name: 'p',
      expected: "a non-empty bucket name without '/'",
    });
    expect(arg.key('p')).toMatchObject({
      name: 'p',
      expected: 'a non-empty object key of at most 1024 bytes',
    });
    expect(arg.prefix('p')).toMatchObject({
      name: 'p',
      expected: 'a key prefix string of at most 1024 bytes',
    });
    expect(arg.nonEmptyPrefix('p')).toMatchObject({
      name: 'p',
      expected: 'a non-empty key prefix of at most 1024 bytes',
    });
    expect(arg.keys('p')).toMatchObject({
      name: 'p',
      expected: 'an array of object keys',
    });
    expect(arg.paths('p')).toMatchObject({
      name: 'p',
      expected: 'an array of non-empty strings',
    });
    expect(arg.listOptions('p')).toMatchObject({
      name: 'p',
      expected: 'an object { bucket, prefix?, delimiter?, maxKeys?, continuationToken? }',
    });
    expect(arg.listAllOptions('p')).toMatchObject({
      name: 'p',
      expected: 'an object { bucket, prefix?, delimiter?, maxKeys? }',
    });
    expect(arg.appStateData('p')).toMatchObject({
      name: 'p',
      expected: 'an object with only lastProfile, lastBucket (string or null) and lastPrefix (string)',
    });
  });

  it('text accepts any NUL-free string including empty', () => {
    const { check } = arg.text('t');
    expect(check('')).toBe(true);
    expect(check('abc')).toBe(true);
    expect(check('a\0')).toBe(false);
    expect(check(1)).toBe(false);
  });

  it('nonEmptyPrefix rejects the empty string', () => {
    expect(arg.nonEmptyPrefix('p').check('')).toBe(false);
    expect(arg.nonEmptyPrefix('p').check('a/')).toBe(true);
  });

  it('keys requires every element to be a valid key', () => {
    const { check } = arg.keys('k');
    expect(check([])).toBe(true);
    expect(check(['a', 'b'])).toBe(true);
    expect(check(['a', ''])).toBe(false);
    expect(check(['', 'a'])).toBe(false);
    expect(check(['a', 5])).toBe(false);
    expect(check('a')).toBe(false);
  });

  it('paths requires every element to be a non-empty identifier', () => {
    const { check } = arg.paths('p');
    expect(check([])).toBe(true);
    expect(check(['/a', '/b'])).toBe(true);
    expect(check(['/a', ''])).toBe(false);
    expect(check(['', '/a'])).toBe(false);
    expect(check(['/a', 7])).toBe(false);
    expect(check('/a')).toBe(false);
  });
});

describe('list options', () => {
  const listAll = arg.listAllOptions('o').check;
  const list = arg.listOptions('o').check;

  it('accepts a bucket with every optional field', () => {
    expect(list({ bucket: 'b' })).toBe(true);
    expect(
      list({
        bucket: 'b',
        prefix: '',
        delimiter: '/',
        maxKeys: 1,
        continuationToken: 't',
      }),
    ).toBe(true);
    expect(listAll({ bucket: 'b', prefix: 'p/', delimiter: '/', maxKeys: 500 })).toBe(true);
  });

  it('accepts each known key one by one (and only known keys)', () => {
    for (const key of ['prefix', 'delimiter']) expect(list({ bucket: 'b', [key]: 'x' })).toBe(true);
    expect(list({ bucket: 'b', maxKeys: 3 })).toBe(true);
    expect(list({ bucket: 'b', continuationToken: 'tok' })).toBe(true);
    expect(list({ bucket: 'b', other: 1 })).toBe(false);
  });

  it('only the paginated variant accepts continuationToken', () => {
    expect(list({ bucket: 'b', continuationToken: 't' })).toBe(true);
    expect(listAll({ bucket: 'b', continuationToken: 't' })).toBe(false);
    expect(listAll({ bucket: 'b', 'Stryker was here': 1 })).toBe(false);
    expect(listAll({ bucket: 'b', other: 1 })).toBe(false);
  });

  it('requires maxKeys to be a positive integer', () => {
    expect(list({ bucket: 'b', maxKeys: 0 })).toBe(false);
    expect(list({ bucket: 'b', maxKeys: -3 })).toBe(false);
    expect(list({ bucket: 'b', maxKeys: 1.5 })).toBe(false);
    expect(list({ bucket: 'b', maxKeys: '5' })).toBe(false);
    expect(list({ bucket: 'b', maxKeys: NaN })).toBe(false);
    expect(list({ bucket: 'b', maxKeys: null })).toBe(false);
    expect(list({ bucket: 'b', maxKeys: 1 })).toBe(true);
  });

  it('rejects bad optional values, a missing bucket and non-objects', () => {
    expect(list({ bucket: 'b', prefix: 1 })).toBe(false);
    expect(list({ bucket: 'b', delimiter: 1 })).toBe(false);
    expect(list({ bucket: 'b', continuationToken: '' })).toBe(false);
    expect(list({ prefix: 'p' })).toBe(false);
    expect(list(null)).toBe(false);
    expect(list([])).toBe(false);
    expect(list('b')).toBe(false);
  });
});

describe('appStateData', () => {
  const { check } = arg.appStateData('s');

  it('accepts the three known keys, each optional, with null for profile and bucket', () => {
    expect(check({})).toBe(true);
    expect(check({ lastProfile: 'p', lastBucket: 'b', lastPrefix: 'x/' })).toBe(true);
    expect(check({ lastProfile: null, lastBucket: null })).toBe(true);
    expect(check({ lastProfile: undefined })).toBe(true);
    expect(check({ lastProfile: 'p' })).toBe(true);
    expect(check({ lastBucket: 'b' })).toBe(true);
    expect(check({ lastPrefix: '' })).toBe(true);
  });

  it('accepts each known key alone and rejects any other key', () => {
    expect(check({ lastProfile: 'p' })).toBe(true);
    expect(check({ lastBucket: 'b' })).toBe(true);
    expect(check({ lastPrefix: 'a' })).toBe(true);
    expect(check({ lastProfile: 'p', extra: 1 })).toBe(false);
    expect(check({ extra: 1 })).toBe(false);
  });

  it('rejects non-string values, null prefix and NUL', () => {
    expect(check({ lastProfile: 5 })).toBe(false);
    expect(check({ lastBucket: 5 })).toBe(false);
    expect(check({ lastPrefix: null })).toBe(false);
    expect(check({ lastPrefix: 5 })).toBe(false);
    expect(check({ lastProfile: 'a\0' })).toBe(false);
    expect(check({ lastBucket: 'a\0' })).toBe(false);
    expect(check({ lastPrefix: 'a\0' })).toBe(false);
  });

  it('bounds string length at the identifier limit, inclusively', () => {
    const max = 'x'.repeat(MAX_IDENTIFIER_LENGTH);
    const over = 'x'.repeat(MAX_IDENTIFIER_LENGTH + 1);
    for (const key of ['lastProfile', 'lastBucket', 'lastPrefix']) {
      expect(check({ [key]: max })).toBe(true);
      expect(check({ [key]: over })).toBe(false);
    }
  });

  it('rejects non-plain objects', () => {
    expect(check(null)).toBe(false);
    expect(check([])).toBe(false);
    expect(check('x')).toBe(false);
    expect(check(Object.create({ lastPrefix: 'x' }))).toBe(false);
  });
});

describe('describeInvalidArgs', () => {
  const specs = [arg.bucket('bucket'), arg.key('key')];

  it('returns null when every argument is valid', () => {
    expect(describeInvalidArgs(specs, ['b', 'k'])).toBeNull();
    expect(describeInvalidArgs([], [])).toBeNull();
    expect(describeInvalidArgs([], ['ignored'])).toBeNull();
  });

  it('names the first invalid argument with its expectation', () => {
    expect(describeInvalidArgs(specs, ['', 'k'])).toBe(
      "Invalid argument 'bucket': expected a non-empty bucket name without '/'",
    );
    expect(describeInvalidArgs(specs, ['b', ''])).toBe(
      "Invalid argument 'key': expected a non-empty object key of at most 1024 bytes",
    );
    expect(describeInvalidArgs(specs, ['', ''])).toContain("'bucket'");
    expect(describeInvalidArgs(specs, ['b'])).toContain("'key'");
  });
});

describe('validated', () => {
  it('runs the handler with the event and arguments when valid', async () => {
    const handler = vi.fn(async (_e: unknown, b: string, k: string) => `${b}/${k}`);
    const onInvalid = vi.fn((m: string) => m);
    const wrapped = validated([arg.bucket('bucket'), arg.key('key')], onInvalid, handler);
    const event = { id: 1 } as never;
    await expect(wrapped(event, 'b', 'k')).resolves.toBe('b/k');
    expect(handler).toHaveBeenCalledWith(event, 'b', 'k');
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it('resolves to onInvalid(message) and skips the handler when invalid', async () => {
    const handler = vi.fn();
    const wrapped = validated([arg.bucket('bucket')], (m: string) => ({ msg: m }), handler);
    await expect(wrapped({} as never, 5)).resolves.toEqual({
      msg: "Invalid argument 'bucket': expected a non-empty bucket name without '/'",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('supports synchronous handlers', async () => {
    const wrapped = validated(
      [],
      () => 'bad',
      () => 'ok',
    );
    await expect(wrapped({} as never)).resolves.toBe('ok');
  });
});

describe('failure', () => {
  it('builds the failure shape', () => {
    expect(failure('boom')).toEqual({ success: false, error: 'boom' });
  });
});
