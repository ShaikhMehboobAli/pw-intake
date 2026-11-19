export type BackoffConfig = { baseMs: number; maxMs: number };

export const DEFAULT_BACKOFF: BackoffConfig = { baseMs: 2_000, maxMs: 5 * 60_000 };

/**
 * Exponential backoff with "equal jitter": half the window is fixed, half is random.
 * The fixed half guarantees we never hot-loop; the random half stops a dealership full of phones
 * retrying in lockstep the moment the wifi comes back.
 */
export function backoffDelay(attempt: number, config: BackoffConfig = DEFAULT_BACKOFF, random = Math.random): number {
  const ceiling = Math.min(config.maxMs, config.baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(ceiling / 2 + random() * (ceiling / 2));
}
