import type { JsonValue, RecordedBody } from "./exchange.ts";

/**
 * User-content paths the recorder adds by itself, for services whose error
 * format is fixed and known. An error's text can repeat what was sent (a
 * recipient, a file name, a search term), and every integration for the
 * service would otherwise have to list the same paths, where one that
 * forgets them publishes that text.
 *
 * These paths come on top of the policy's own. They never stop a recording
 * for matching nothing: most scenarios have no error.
 */
interface ServiceErrorFormat {
  /** Whether a request to this host gets the service's error format. */
  readonly servesHost: (host: string) => boolean;
  /**
   * Whether the response body is in the error format. A host can answer in
   * more than one format, so the host alone isn't enough.
   */
  readonly isFormatOf: (body: RecordedBody) => boolean;
  readonly userContent: readonly string[];
}

/**
 * The free-text fields of Google's `google.rpc` error details, a fixed set of
 * types: https://cloud.google.com/apis/design/errors#error_details
 *
 * Each detail's `@type`, `reason`, `domain` and `retryDelay` stay. Gemini,
 * for one, says a key was refused only in an `ErrorInfo`'s `reason`
 * (`API_KEY_INVALID`). A field not listed here still goes through the
 * free-text rules, and a `details` that isn't a list is replaced whole.
 */
const googleErrorDetailText = [
  "fieldViolations", // BadRequest
  "violations", // QuotaFailure, PreconditionFailure
  "metadata", // ErrorInfo
  "message", // LocalizedMessage
  "links", // Help
  "resourceName", // ResourceInfo
  "owner", // ResourceInfo
  "description", // ResourceInfo
  "stackEntries", // DebugInfo
  "detail", // DebugInfo
  "requestId", // RequestInfo
  "servingData", // RequestInfo
];

/**
 * Google's JSON API errors, the same for Gmail, Drive and every other
 * `*.googleapis.com` API: https://cloud.google.com/apis/design/errors
 *
 * `error.code`, `error.status` and `error.errors[*].reason` and `domain`
 * stay: integrations map errors by them, so a replay needs them.
 *
 * Only a body whose `error` is an object is in this format. The OAuth
 * endpoints on `oauth2.googleapis.com` answer in RFC 6749's instead, where
 * `error` is a code such as `invalid_grant` that the kit maps errors by.
 */
const googleErrors: ServiceErrorFormat = {
  servesHost: (host) => host === "googleapis.com" || host.endsWith(".googleapis.com"),
  isFormatOf: (body) =>
    body.kind === "json" && isObject(body.value) && isObject(body.value["error"]),
  userContent: [
    // The sentence about the error, and the same per error in the older format
    "response.body.error.message",
    "response.body.error.errors[*].message",
    ...googleErrorDetailText.map((field) => `response.body.error.details[*].${field}`),
  ],
};

const serviceErrorFormats: readonly ServiceErrorFormat[] = [googleErrors];

/**
 * The error paths the recorder adds for a request to `url` that got
 * `responseBody` back, or none.
 */
export function serviceErrorPaths(url: string, responseBody: RecordedBody): readonly string[] {
  const host = hostOf(url);
  if (host === undefined) {
    return [];
  }
  return serviceErrorFormats
    .filter((format) => format.servesHost(host) && format.isFormatOf(responseBody))
    .flatMap((format) => format.userContent);
}

function isObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The URL's host in lower case, or `undefined` when it can't be parsed (the URL rule refuses it). */
function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
