/**
 * When a Google request is sent again, and how long to wait first (guide,
 * section 4, rule 10): at most twice, only on `429` and `5xx`, honouring
 * `retry-after` up to 30 seconds, and only for requests that are safe to
 * repeat.
 */

/** Gives the time and waits. Passed in, so tests and replays control time. */
export interface RetryClock {
  /** The current time, for a `retry-after` given as a date. */
  now(): Date;
  /**
   * Waits `ms` milliseconds.
   *
   * @throws when `signal` aborts, so a call the user cancels stops waiting
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

/** A request is sent at most three times: once, then retried twice. */
export const maxRetries = 2;

/** The longest `retry-after` we wait for. A longer one ends the call instead. */
export const maxRetryAfterMs = 30_000;

/** The wait before the first retry when Google gives no `retry-after`; it doubles for the second. */
const firstBackoffMs = 1_000;

/**
 * Whether a request may be sent again. `GET` and `HEAD` change nothing.
 * Any other method only when the caller says the service makes it safe to
 * repeat, such as with an idempotency key. Never a `DELETE`: a timeout
 * doesn't prove it didn't happen.
 *
 * Methods are matched case-sensitively, so callers must pass upper-case
 * names. The request helper's method type only allows those.
 */
export function isRepeatable(method: string, repeatable: boolean): boolean {
  switch (method) {
    case "GET":
    case "HEAD":
      return true;
    case "DELETE":
      return false;
    default:
      return repeatable;
  }
}

/** Only these statuses are worth another try: too many requests, or trouble at Google. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * How long to wait before retry number `retry` (0 for the first), or
 * `undefined` when Google asks for a longer wait than we allow.
 *
 * @param retryAfter - the response's `retry-after` header, if any: seconds,
 *   or an HTTP date (RFC 9110, section 10.2.3)
 */
export function retryDelayMs(
  retryAfter: string | null,
  retry: number,
  now: Date,
): number | undefined {
  const asked = retryAfter === null ? undefined : parseRetryAfterMs(retryAfter, now);
  if (asked === undefined) {
    return firstBackoffMs * 2 ** retry;
  }
  return asked <= maxRetryAfterMs ? asked : undefined;
}

/** A `retry-after` in milliseconds, at least 0, or `undefined` when it can't be read. */
function parseRetryAfterMs(value: string, now: Date): number | undefined {
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    return Number(text) * 1_000;
  }
  // Every HTTP date format starts with the day's name. Checking that first
  // keeps Date.parse from reading text such as "-5" as a year.
  const date = /^[a-z]{3}/i.test(text) ? Date.parse(text) : Number.NaN;
  if (Number.isNaN(date)) {
    return undefined;
  }
  return Math.max(0, date - now.getTime());
}
