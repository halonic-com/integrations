import { type DisabledApi, disabledApiIn } from "./disabled-api.ts";
import { googleErrorReason } from "./error-reason.ts";
import { GoogleApiDisabledError, GoogleError, type GoogleErrorCode } from "./errors.ts";

/** The request an error answered. Used only to name it in the message. */
export interface FailedRequest {
  /** The service's name for the user, such as `Gmail` or `Google Drive`. */
  readonly service: string;
  /** The request's URL. Only its host and path reach the message, never its query. */
  readonly url: string;
}

/**
 * Google reasons on a `403` that mean a short-term "too many requests".
 * Google sends these instead of a `429` in places; Drive's documentation:
 * https://developers.google.com/workspace/drive/api/guides/handle-errors
 */
const rateLimitReasons: ReadonlySet<string> = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

/** Google reasons on a `403` that mean a limit that doesn't clear in seconds, such as a daily one. */
const quotaReasons: ReadonlySet<string> = new Set(["dailyLimitExceeded", "quotaExceeded"]);

/** A path is shortened to this length in a message. Google ids are far shorter. */
const maxPathLength = 120;

/**
 * Turns a Google error response into a {@link GoogleError}, the same way
 * for every Google service (guide, section 7, rule 2).
 *
 * The message names the service, the host and path, the status and, when
 * it looks like an identifier, Google's machine-readable reason. Never
 * Google's own error text, the query string or a header.
 *
 * A `403` that says the API is switched off becomes a
 * {@link GoogleApiDisabledError}, which also names the API and the project.
 *
 * @param status - the response's HTTP status, never a `2xx`
 * @param bodyText - the response body as text; it may be anything
 */
export function errorForResponse(
  status: number,
  bodyText: string,
  request: FailedRequest,
): GoogleError {
  const reason = googleErrorReason(bodyText);
  const details = reason === undefined ? `status ${status}` : `status ${status}, ${reason}`;
  const disabled = status === 403 ? disabledApiIn(bodyText) : undefined;
  if (disabled !== undefined) {
    return new GoogleApiDisabledError(
      `${apiDisabledMessage(request, disabled)} (${details}).`,
      disabled,
    );
  }
  const code = codeForStatus(status, reason);
  return new GoogleError(code, `${messageFor(code, request)} (${details}).`);
}

/**
 * The error for a success response we can't use: a body that isn't JSON,
 * or one the caller's Zod schema refuses. The parse error and the
 * `ZodError` can quote the body, so neither is kept, not even as `cause`
 * (guide, section 7, rule 5).
 */
export function unexpectedResponse(request: FailedRequest): GoogleError {
  return new GoogleError("unexpected-response", `${messageFor("unexpected-response", request)}.`);
}

/**
 * The error's code, by the guide's status table. A `403` can also mean too
 * many requests or a used-up limit, which Google says only in its reason.
 */
export function codeForStatus(status: number, reason?: string): GoogleErrorCode {
  switch (status) {
    case 400:
    case 422:
      return "bad-arguments";
    case 401:
      return "not-signed-in";
    case 403:
      return codeForForbidden(reason);
    case 404:
    // Gone: Calendar answers this for an event that is already deleted.
    case 410:
      return "not-found";
    case 408:
    case 429:
      return "rate-limited";
    default:
      // 5xx, and every other status the table doesn't name.
      return "unavailable";
  }
}

function codeForForbidden(reason: string | undefined): GoogleErrorCode {
  if (reason !== undefined && rateLimitReasons.has(reason)) {
    return "rate-limited";
  }
  if (reason !== undefined && quotaReasons.has(reason)) {
    return "quota-exceeded";
  }
  return "not-allowed";
}

/** What the message says for each code, written for the user. */
function messageFor(code: GoogleErrorCode, request: FailedRequest): string {
  const { service } = request;
  const target = describeTarget(request.url);
  switch (code) {
    case "bad-arguments":
      return `${service} refused the request to ${target}. Check the arguments`;
    case "not-signed-in":
      return `${service} didn't accept the Google sign-in. Reconnect the Google account`;
    case "not-allowed":
      return `The Google account may not do this in ${service}: ${target}`;
    case "not-found":
      return `${service} found nothing at ${target}`;
    case "rate-limited":
      return `${service} is getting too many requests. Try again later`;
    case "quota-exceeded":
      return `The Google account has reached a ${service} limit. Try again tomorrow or free up space`;
    case "api-disabled":
      return apiDisabledMessage(request, { api: undefined, project: undefined });
    case "unavailable":
      return `${service} is having trouble. Try again later`;
    case "unexpected-response":
      return `${service} answered ${target} in an unexpected way`;
  }
}

/**
 * What the message says for a switched-off API. The API and the project
 * passed {@link disabledApiIn}'s shape checks, so they can't carry text.
 */
function apiDisabledMessage(request: FailedRequest, disabled: DisabledApi): string {
  const api = disabled.api === undefined ? "" : ` (${disabled.api})`;
  const project =
    disabled.project === undefined
      ? "the Google Cloud project"
      : `Google Cloud project ${disabled.project}`;
  return `The ${request.service} API${api} is switched off in ${project}. Switch it on, then try again`;
}

/**
 * The host and path of a URL, shortened, without its query: the query can
 * hold the user's search or a page token (guide, section 7, rule 6).
 */
export function describeTarget(url: string): string {
  const parsed = URL.parse(url);
  if (parsed === null) {
    return "the service";
  }
  const target = `${parsed.host}${parsed.pathname}`;
  return target.length > maxPathLength ? `${target.slice(0, maxPathLength)}…` : target;
}
