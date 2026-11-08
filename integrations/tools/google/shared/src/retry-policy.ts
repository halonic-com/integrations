/**
 * When a Google request is sent again, and how long to wait first (guide,
 * section 4, rule 10): at most twice, only on `429` and `5xx`, honouring
 * `retry-after` up to 30 seconds, and only for requests that are safe to
 * repeat.
 */

import { type HttpResponse, maxIntegrationWaitMs } from "./http.ts";

/** A request is sent at most three times: once, then retried twice. */
export const maxRetries = 2;

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
 * `undefined` when Google asks for a longer wait than the host allows.
 *
 * Reads the response's `retry-after`: seconds, or an HTTP date (RFC 9110,
 * section 10.2.3). A date is measured against the response's own `date`
 * header, so it needs no clock and Google's clock is compared with
 * Google's clock. Without a `retry-after` that can be read, or a date form
 * without a `date` header, it backs off 1 s, then 2 s.
 */
export function retryDelayMs(headers: HttpResponse["headers"], retry: number): number | undefined {
  const asked = askedWaitMs(headers);
  if (asked === undefined) {
    return firstBackoffMs * 2 ** retry;
  }
  return asked <= maxIntegrationWaitMs ? asked : undefined;
}

/** The wait `retry-after` asks for in milliseconds, at least 0, or `undefined` when it can't be read. */
function askedWaitMs(headers: HttpResponse["headers"]): number | undefined {
  const retryAfter = headers.get("retry-after")?.trim();
  if (retryAfter === undefined) {
    return undefined;
  }
  if (/^\d+$/.test(retryAfter)) {
    return Number(retryAfter) * 1_000;
  }
  const until = parseHttpDate(retryAfter);
  const sent = parseHttpDate(headers.get("date") ?? "");
  if (until === undefined || sent === undefined) {
    return undefined;
  }
  return Math.max(0, until - sent);
}

/** An HTTP date in milliseconds since 1970, or `undefined` when it isn't one. */
function parseHttpDate(value: string): number | undefined {
  const text = value.trim();
  // Every HTTP date format starts with the day's name. Checking that first
  // keeps Date.parse from reading text such as "-5" as a year.
  if (!/^[a-z]{3}/i.test(text)) {
    return undefined;
  }
  const time = Date.parse(text);
  return Number.isNaN(time) ? undefined : time;
}
