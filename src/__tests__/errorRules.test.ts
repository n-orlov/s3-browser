import { describe, it, expect } from 'vitest';
import {
  ERROR_RULES,
  NETWORK_PATTERNS,
  buildDefaultError,
  findErrorRule,
  getErrorMessage,
  isNetworkError,
  matchesAnyPattern,
  parseError,
} from '../renderer/utils/errorMessages';

describe('getErrorMessage', () => {
  it.each([
    ['an Error', new Error('boom'), 'boom'],
    ['a string', 'plain text', 'plain text'],
    ['a number', 42, '42'],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
  ])('extracts the message from %s', (_label, input, expected) => {
    expect(getErrorMessage(input)).toBe(expected);
  });
});

describe('matchesAnyPattern', () => {
  it.each([
    ['hello world', ['world'], true],
    ['hello world', ['nope', 'hello'], true],
    ['hello world', ['nope', 'absent'], false],
    ['hello world', [], false],
    ['', ['x'], false],
  ])('matchesAnyPattern(%j, %j) is %s', (message, patterns, expected) => {
    expect(matchesAnyPattern(message, patterns)).toBe(expected);
  });
});

describe('findErrorRule', () => {
  const cases: Array<[string, string]> = [
    ['accessdenied', 'Access Denied'],
    ['access denied', 'Access Denied'],
    ['forbidden', 'Access Denied'],
    ['invalidsignature', 'Invalid Credentials'],
    ['invalid signature', 'Invalid Credentials'],
    ['signaturedoesnotmatch', 'Invalid Credentials'],
    ['invalidaccesskeyid', 'Invalid Credentials'],
    ['expiredtoken', 'Credentials Expired'],
    ['expired token', 'Credentials Expired'],
    ['token has expired', 'Credentials Expired'],
    ['nosuchbucket', 'Bucket Not Found'],
    ['no such bucket', 'Bucket Not Found'],
    ['nosuchkey', 'File Not Found'],
    ['no such key', 'File Not Found'],
    ['not found', 'File Not Found'],
    ['network', 'Connection Error'],
    ['enotfound', 'Connection Error'],
    ['econnrefused', 'Connection Error'],
    ['econnreset', 'Connection Error'],
    ['etimedout', 'Connection Error'],
    ['timeout', 'Connection Error'],
    ['socket hang up', 'Connection Error'],
    ['slowdown', 'Too Many Requests'],
    ['throttling', 'Too Many Requests'],
    ['toomanyrequests', 'Too Many Requests'],
    ['serviceunavailable', 'Service Unavailable'],
    ['service unavailable', 'Service Unavailable'],
    ['internalerror', 'Service Unavailable'],
    ['internal error', 'Service Unavailable'],
    ['permanentredirect', 'Region Mismatch'],
    ['region', 'Region Mismatch'],
    ['authorizationheadermalformed', 'Region Mismatch'],
    ['entitytoolarge', 'File Too Large'],
    ['too large', 'File Too Large'],
    ['abort', 'Operation Cancelled'],
    ['cancel', 'Operation Cancelled'],
  ];

  it.each(cases)('matches pattern %j to rule %j', (text, title) => {
    expect(findErrorRule(`prefix ${text} suffix`)?.result.title).toBe(title);
  });

  it.each([
    ['access denied: no such bucket', 'Access Denied'],
    ['no such bucket timeout', 'Bucket Not Found'],
    ['timeout while request was cancelled', 'Connection Error'],
    ['region unavailable: operation aborted', 'Region Mismatch'],
  ])('earlier rule wins for %j', (text, title) => {
    expect(findErrorRule(text)?.result.title).toBe(title);
  });

  it.each(['', 'something unexpected', 'ok'])('returns undefined for %j', (text) => {
    expect(findErrorRule(text)).toBeUndefined();
  });

  it('covers every pattern of every rule', () => {
    const covered = new Set(cases.map(([text]) => text));
    for (const rule of ERROR_RULES) {
      for (const pattern of rule.patterns) {
        const hit = [...covered].some((text) => text.includes(pattern));
        expect(hit, `pattern ${pattern}`).toBe(true);
      }
    }
  });
});

describe('buildDefaultError', () => {
  it.each([
    ['custom failure', 'custom failure'],
    ['', 'An unknown error occurred.'],
  ])('builds a retryable default for %j', (input, message) => {
    expect(buildDefaultError(input)).toEqual({
      title: 'Error',
      message,
      suggestion: 'Please try again. If the problem persists, check your configuration.',
      isRetryable: true,
    });
  });
});

describe('parseError via rules', () => {
  it.each([
    ['Operation aborted', 'Operation Cancelled', false],
    ['ThrottlingException', 'Too Many Requests', true],
    ['weird thing', 'Error', true],
    ['', 'Error', true],
  ])('parseError(%j) -> %s (retryable %s)', (input, title, retryable) => {
    const parsed = parseError(new Error(input));
    expect(parsed.title).toBe(title);
    expect(parsed.isRetryable).toBe(retryable);
  });

  it('does not expose the shared rule object to mutation', () => {
    const first = parseError('AccessDenied');
    first.title = 'mutated';
    expect(parseError('AccessDenied').title).toBe('Access Denied');
  });
});

describe('isNetworkError patterns', () => {
  it.each([...NETWORK_PATTERNS, 'fetch failed'])('detects %j', (pattern) => {
    expect(isNetworkError(new Error(`xx ${pattern.toUpperCase()} yy`))).toBe(true);
  });

  it.each(['AccessDenied', 'something else'])('rejects %j', (text) => {
    expect(isNetworkError(new Error(text))).toBe(false);
  });
});
