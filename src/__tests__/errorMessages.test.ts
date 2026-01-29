import { describe, it, expect } from 'vitest';
import {
  parseError,
  getShortErrorMessage,
  isNetworkError,
  isRetryableError,
} from '../renderer/utils/errorMessages';

describe('parseError', () => {
  it('handles Access Denied errors', () => {
    const result = parseError(new Error('AccessDenied: User is not authorized'));

    expect(result.title).toBe('Access Denied');
    expect(result.message).toContain('permission');
    expect(result.isRetryable).toBe(false);
  });

  it('handles Forbidden errors', () => {
    const result = parseError(new Error('Forbidden: Access denied'));

    expect(result.title).toBe('Access Denied');
    expect(result.isRetryable).toBe(false);
  });

  it('handles Invalid Signature errors', () => {
    const result = parseError(new Error('SignatureDoesNotMatch'));

    expect(result.title).toBe('Invalid Credentials');
    expect(result.message).toContain('invalid or expired');
    expect(result.isRetryable).toBe(false);
  });

  it('handles Invalid Access Key errors', () => {
    const result = parseError(new Error('InvalidAccessKeyId: The access key ID does not exist'));

    expect(result.title).toBe('Invalid Credentials');
    expect(result.isRetryable).toBe(false);
  });

  it('handles Expired Token errors', () => {
    const result = parseError(new Error('ExpiredToken: The security token has expired'));

    expect(result.title).toBe('Credentials Expired');
    expect(result.message).toContain('expired');
    expect(result.isRetryable).toBe(false);
  });

  it('handles NoSuchBucket errors', () => {
    const result = parseError(new Error('NoSuchBucket: The specified bucket does not exist'));

    expect(result.title).toBe('Bucket Not Found');
    expect(result.isRetryable).toBe(false);
  });

  it('handles NoSuchKey errors', () => {
    const result = parseError(new Error('NoSuchKey: The specified key does not exist'));

    expect(result.title).toBe('File Not Found');
    expect(result.isRetryable).toBe(false);
  });

  it('handles Not Found errors', () => {
    const result = parseError(new Error('Not Found'));

    expect(result.title).toBe('File Not Found');
    expect(result.isRetryable).toBe(false);
  });

  it('handles network connection errors', () => {
    const networkErrors = [
      'ENOTFOUND: getaddrinfo failed',
      'ECONNREFUSED: Connection refused',
      'ECONNRESET: Connection reset by peer',
      'ETIMEDOUT: Connection timed out',
      'timeout waiting for response',
      'socket hang up',
      'NetworkError: Failed to fetch',
    ];

    networkErrors.forEach((errorMessage) => {
      const result = parseError(new Error(errorMessage));
      expect(result.title).toBe('Connection Error');
      expect(result.isRetryable).toBe(true);
    });
  });

  it('handles throttling errors', () => {
    const result = parseError(new Error('SlowDown: Please reduce your request rate'));

    expect(result.title).toBe('Too Many Requests');
    expect(result.isRetryable).toBe(true);
  });

  it('handles TooManyRequests errors', () => {
    const result = parseError(new Error('TooManyRequests'));

    expect(result.title).toBe('Too Many Requests');
    expect(result.isRetryable).toBe(true);
  });

  it('handles Service Unavailable errors', () => {
    const result = parseError(new Error('ServiceUnavailable: Service is temporarily unavailable'));

    expect(result.title).toBe('Service Unavailable');
    expect(result.isRetryable).toBe(true);
  });

  it('handles Internal Error', () => {
    const result = parseError(new Error('InternalError: We encountered an internal error'));

    expect(result.title).toBe('Service Unavailable');
    expect(result.isRetryable).toBe(true);
  });

  it('handles Region mismatch errors', () => {
    const result = parseError(new Error('PermanentRedirect: The bucket is in a different region'));

    expect(result.title).toBe('Region Mismatch');
    expect(result.isRetryable).toBe(false);
  });

  it('handles AuthorizationHeaderMalformed errors', () => {
    const result = parseError(new Error('AuthorizationHeaderMalformed'));

    expect(result.title).toBe('Region Mismatch');
    expect(result.isRetryable).toBe(false);
  });

  it('handles EntityTooLarge errors', () => {
    const result = parseError(new Error('EntityTooLarge: Your proposed upload exceeds the maximum allowed size'));

    expect(result.title).toBe('File Too Large');
    expect(result.isRetryable).toBe(false);
  });

  it('handles Aborted operations', () => {
    const result = parseError(new Error('Operation aborted'));

    expect(result.title).toBe('Operation Cancelled');
    expect(result.isRetryable).toBe(false);
  });

  it('handles Cancelled operations', () => {
    const result = parseError(new Error('Request cancelled by user'));

    expect(result.title).toBe('Operation Cancelled');
    expect(result.isRetryable).toBe(false);
  });

  it('handles unknown errors with default message', () => {
    const result = parseError(new Error('Something completely unexpected'));

    expect(result.title).toBe('Error');
    expect(result.message).toBe('Something completely unexpected');
    expect(result.isRetryable).toBe(true);
  });

  it('handles string errors', () => {
    const result = parseError('AccessDenied');

    expect(result.title).toBe('Access Denied');
  });

  it('handles empty errors', () => {
    const result = parseError(new Error(''));

    expect(result.title).toBe('Error');
    expect(result.isRetryable).toBe(true);
  });

  it('handles non-Error objects', () => {
    const result = parseError({ code: 'AccessDenied' });

    expect(result.title).toBe('Error');
  });

  it('includes suggestions for most errors', () => {
    const result = parseError(new Error('AccessDenied'));

    expect(result.suggestion).toBeDefined();
    expect(result.suggestion!.length).toBeGreaterThan(0);
  });
});

describe('getShortErrorMessage', () => {
  it('returns the parsed error message', () => {
    const message = getShortErrorMessage(new Error('AccessDenied'));

    expect(message).toBe('You do not have permission to access this resource.');
  });

  it('returns original message for unknown errors', () => {
    const message = getShortErrorMessage(new Error('Custom error text'));

    expect(message).toBe('Custom error text');
  });
});

describe('isNetworkError', () => {
  it('returns true for network-related errors', () => {
    expect(isNetworkError(new Error('ENOTFOUND'))).toBe(true);
    expect(isNetworkError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isNetworkError(new Error('ECONNRESET'))).toBe(true);
    expect(isNetworkError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isNetworkError(new Error('timeout'))).toBe(true);
    expect(isNetworkError(new Error('socket hang up'))).toBe(true);
    expect(isNetworkError(new Error('network error'))).toBe(true);
    expect(isNetworkError(new Error('fetch failed'))).toBe(true);
  });

  it('returns false for non-network errors', () => {
    expect(isNetworkError(new Error('AccessDenied'))).toBe(false);
    expect(isNetworkError(new Error('NoSuchBucket'))).toBe(false);
    expect(isNetworkError(new Error('InvalidCredentials'))).toBe(false);
  });
});

describe('isRetryableError', () => {
  it('returns true for retryable errors', () => {
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryableError(new Error('SlowDown'))).toBe(true);
    expect(isRetryableError(new Error('ServiceUnavailable'))).toBe(true);
    expect(isRetryableError(new Error('Unknown error'))).toBe(true);
  });

  it('returns false for non-retryable errors', () => {
    expect(isRetryableError(new Error('AccessDenied'))).toBe(false);
    expect(isRetryableError(new Error('NoSuchBucket'))).toBe(false);
    expect(isRetryableError(new Error('InvalidSignature'))).toBe(false);
    expect(isRetryableError(new Error('ExpiredToken'))).toBe(false);
    expect(isRetryableError(new Error('Operation aborted'))).toBe(false);
  });
});
