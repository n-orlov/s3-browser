/**
 * Utility functions for parsing and formatting AWS S3 errors
 * into user-friendly messages.
 */

export interface ParsedError {
  title: string;
  message: string;
  suggestion?: string;
  isRetryable: boolean;
}

export interface ErrorRule {
  /** Lower-case substrings; the rule matches when any is contained in the message. */
  patterns: readonly string[];
  result: ParsedError;
}

/** Substrings that identify a network / connection failure. */
export const NETWORK_PATTERNS: readonly string[] = [
  'network',
  'enotfound',
  'econnrefused',
  'econnreset',
  'etimedout',
  'timeout',
  'socket hang up',
];

/**
 * Ordered error rules: the first rule with a matching pattern wins.
 */
export const ERROR_RULES: readonly ErrorRule[] = [
  {
    // Access Denied / Permission errors
    patterns: ['accessdenied', 'access denied', 'forbidden'],
    result: {
      title: 'Access Denied',
      message: 'You do not have permission to access this resource.',
      suggestion: 'Check your AWS credentials or contact your administrator.',
      isRetryable: false,
    },
  },
  {
    // Invalid credentials
    patterns: ['invalidsignature', 'invalid signature', 'signaturedoesnotmatch', 'invalidaccesskeyid'],
    result: {
      title: 'Invalid Credentials',
      message: 'Your AWS credentials appear to be invalid or expired.',
      suggestion: 'Try refreshing your credentials or selecting a different profile.',
      isRetryable: false,
    },
  },
  {
    // Expired credentials
    patterns: ['expiredtoken', 'expired token', 'token has expired'],
    result: {
      title: 'Credentials Expired',
      message: 'Your AWS session token has expired.',
      suggestion: 'Please refresh your credentials and try again.',
      isRetryable: false,
    },
  },
  {
    // Bucket not found
    patterns: ['nosuchbucket', 'no such bucket'],
    result: {
      title: 'Bucket Not Found',
      message: 'The requested bucket does not exist.',
      suggestion: 'Verify the bucket name and region are correct.',
      isRetryable: false,
    },
  },
  {
    // Object/Key not found
    patterns: ['nosuchkey', 'no such key', 'not found'],
    result: {
      title: 'File Not Found',
      message: 'The requested file could not be found.',
      suggestion: 'The file may have been deleted or moved.',
      isRetryable: false,
    },
  },
  {
    // Network / Connection errors
    patterns: NETWORK_PATTERNS,
    result: {
      title: 'Connection Error',
      message: 'Could not connect to AWS S3.',
      suggestion: 'Check your internet connection and try again.',
      isRetryable: true,
    },
  },
  {
    // Throttling
    patterns: ['slowdown', 'throttl', 'toomanyrequests'],
    result: {
      title: 'Too Many Requests',
      message: 'AWS is temporarily throttling requests.',
      suggestion: 'Please wait a moment and try again.',
      isRetryable: true,
    },
  },
  {
    // Service unavailable
    patterns: ['serviceunavailable', 'service unavailable', 'internalerror', 'internal error'],
    result: {
      title: 'Service Unavailable',
      message: 'AWS S3 is temporarily unavailable.',
      suggestion: 'Please try again in a few moments.',
      isRetryable: true,
    },
  },
  {
    // Region mismatch
    patterns: ['permanentredirect', 'region', 'authorizationheadermalformed'],
    result: {
      title: 'Region Mismatch',
      message: 'The bucket is in a different region than expected.',
      suggestion: 'Try configuring the correct region in your AWS profile.',
      isRetryable: false,
    },
  },
  {
    // File too large
    patterns: ['entitytoolarge', 'too large'],
    result: {
      title: 'File Too Large',
      message: 'The file exceeds the maximum allowed size.',
      suggestion: 'Try uploading a smaller file or use multipart upload.',
      isRetryable: false,
    },
  },
  {
    // Aborted / Cancelled
    patterns: ['abort', 'cancel'],
    result: {
      title: 'Operation Cancelled',
      message: 'The operation was cancelled.',
      isRetryable: false,
    },
  },
];

/**
 * Extracts the message text from an unknown thrown value
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * True when the lower-cased message contains any of the given substrings
 */
export function matchesAnyPattern(lowerMessage: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => lowerMessage.includes(pattern));
}

/**
 * Finds the first rule whose patterns match the lower-cased message
 */
export function findErrorRule(lowerMessage: string): ErrorRule | undefined {
  return ERROR_RULES.find((rule) => matchesAnyPattern(lowerMessage, rule.patterns));
}

/**
 * Builds the fallback error for a message no rule matched
 */
export function buildDefaultError(message: string): ParsedError {
  return {
    title: 'Error',
    message: message || 'An unknown error occurred.',
    suggestion: 'Please try again. If the problem persists, check your configuration.',
    isRetryable: true,
  };
}

/**
 * Parses an error message and returns a user-friendly error object
 */
export function parseError(error: unknown): ParsedError {
  const message = getErrorMessage(error);
  const rule = findErrorRule(message.toLowerCase());
  return rule ? { ...rule.result } : buildDefaultError(message);
}

/**
 * Gets a short user-friendly error message
 */
export function getShortErrorMessage(error: unknown): string {
  const parsed = parseError(error);
  return parsed.message;
}

/**
 * Determines if an error is likely network-related
 */
export function isNetworkError(error: unknown): boolean {
  const lowerMessage = getErrorMessage(error).toLowerCase();
  return matchesAnyPattern(lowerMessage, NETWORK_PATTERNS) || lowerMessage.includes('fetch failed');
}

/**
 * Determines if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  return parseError(error).isRetryable;
}
