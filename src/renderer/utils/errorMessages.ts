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

/**
 * Parses an error message and returns a user-friendly error object
 */
export function parseError(error: unknown): ParsedError {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  // Access Denied / Permission errors
  if (
    lowerMessage.includes('accessdenied') ||
    lowerMessage.includes('access denied') ||
    lowerMessage.includes('forbidden')
  ) {
    return {
      title: 'Access Denied',
      message: 'You do not have permission to access this resource.',
      suggestion: 'Check your AWS credentials or contact your administrator.',
      isRetryable: false,
    };
  }

  // Invalid credentials
  if (
    lowerMessage.includes('invalidsignature') ||
    lowerMessage.includes('invalid signature') ||
    lowerMessage.includes('signaturedoesnotmatch') ||
    lowerMessage.includes('invalidaccesskeyid')
  ) {
    return {
      title: 'Invalid Credentials',
      message: 'Your AWS credentials appear to be invalid or expired.',
      suggestion: 'Try refreshing your credentials or selecting a different profile.',
      isRetryable: false,
    };
  }

  // Expired credentials
  if (
    lowerMessage.includes('expiredtoken') ||
    lowerMessage.includes('expired token') ||
    lowerMessage.includes('token has expired')
  ) {
    return {
      title: 'Credentials Expired',
      message: 'Your AWS session token has expired.',
      suggestion: 'Please refresh your credentials and try again.',
      isRetryable: false,
    };
  }

  // Bucket not found
  if (
    lowerMessage.includes('nosuchbucket') ||
    lowerMessage.includes('no such bucket')
  ) {
    return {
      title: 'Bucket Not Found',
      message: 'The requested bucket does not exist.',
      suggestion: 'Verify the bucket name and region are correct.',
      isRetryable: false,
    };
  }

  // Object/Key not found
  if (
    lowerMessage.includes('nosuchkey') ||
    lowerMessage.includes('no such key') ||
    lowerMessage.includes('not found')
  ) {
    return {
      title: 'File Not Found',
      message: 'The requested file could not be found.',
      suggestion: 'The file may have been deleted or moved.',
      isRetryable: false,
    };
  }

  // Network / Connection errors
  if (
    lowerMessage.includes('network') ||
    lowerMessage.includes('enotfound') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('econnreset') ||
    lowerMessage.includes('etimedout') ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('socket hang up')
  ) {
    return {
      title: 'Connection Error',
      message: 'Could not connect to AWS S3.',
      suggestion: 'Check your internet connection and try again.',
      isRetryable: true,
    };
  }

  // Throttling
  if (
    lowerMessage.includes('slowdown') ||
    lowerMessage.includes('throttl') ||
    lowerMessage.includes('toomanyrequests')
  ) {
    return {
      title: 'Too Many Requests',
      message: 'AWS is temporarily throttling requests.',
      suggestion: 'Please wait a moment and try again.',
      isRetryable: true,
    };
  }

  // Service unavailable
  if (
    lowerMessage.includes('serviceunavailable') ||
    lowerMessage.includes('service unavailable') ||
    lowerMessage.includes('internalerror') ||
    lowerMessage.includes('internal error')
  ) {
    return {
      title: 'Service Unavailable',
      message: 'AWS S3 is temporarily unavailable.',
      suggestion: 'Please try again in a few moments.',
      isRetryable: true,
    };
  }

  // Region mismatch
  if (
    lowerMessage.includes('permanentredirect') ||
    lowerMessage.includes('region') ||
    lowerMessage.includes('authorizationheadermalformed')
  ) {
    return {
      title: 'Region Mismatch',
      message: 'The bucket is in a different region than expected.',
      suggestion: 'Try configuring the correct region in your AWS profile.',
      isRetryable: false,
    };
  }

  // File too large
  if (
    lowerMessage.includes('entitytoolarge') ||
    lowerMessage.includes('too large')
  ) {
    return {
      title: 'File Too Large',
      message: 'The file exceeds the maximum allowed size.',
      suggestion: 'Try uploading a smaller file or use multipart upload.',
      isRetryable: false,
    };
  }

  // Aborted / Cancelled
  if (
    lowerMessage.includes('abort') ||
    lowerMessage.includes('cancel')
  ) {
    return {
      title: 'Operation Cancelled',
      message: 'The operation was cancelled.',
      isRetryable: false,
    };
  }

  // Default / Unknown error
  return {
    title: 'Error',
    message: message || 'An unknown error occurred.',
    suggestion: 'Please try again. If the problem persists, check your configuration.',
    isRetryable: true,
  };
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
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  return (
    lowerMessage.includes('network') ||
    lowerMessage.includes('enotfound') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('econnreset') ||
    lowerMessage.includes('etimedout') ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('socket hang up') ||
    lowerMessage.includes('fetch failed')
  );
}

/**
 * Determines if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  return parseError(error).isRetryable;
}
