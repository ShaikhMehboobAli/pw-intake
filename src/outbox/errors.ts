/** Worth trying again later: network failure, timeout, 5xx, 408, 429. */
export class RetryableError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'RetryableError';
  }
}

/** Retrying the same request will not help (e.g. 400 validation error). */
export class PermanentError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'PermanentError';
  }
}

export function classifyHttpStatus(status: number, retryAfterHeader?: string | null): Error | null {
  if (status >= 200 && status < 300) return null;
  if (status === 408 || status === 429 || status >= 500) {
    const seconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    return new RetryableError(`HTTP ${status}`, Number.isFinite(seconds) ? seconds * 1000 : undefined);
  }
  return new PermanentError(`HTTP ${status}`, status);
}
