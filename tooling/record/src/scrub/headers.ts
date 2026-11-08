import type { ScrubContext } from "./context.ts";
import type { HeaderEntry, RecordedHeaders } from "./exchange.ts";
import { SECRET } from "./fakes.ts";
import { scrubText } from "./text.ts";
import { scrubUrl } from "./url.ts";

/** Headers that carry a secret for every integration. */
const SECRET_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "cookie",
  "set-cookie",
]);

/**
 * Headers left out of a recording: they change on every run (dates, request
 * IDs, trace IDs), describe the connection rather than the API, or no longer
 * fit once a body is scrubbed (`content-length`). Leaving them out keeps
 * recordings stable between runs.
 */
const UNSTABLE_HEADERS = new Set([
  "age",
  "alt-svc",
  "cf-cache-status",
  "cf-ray",
  "connection",
  "content-length",
  "date",
  "etag",
  "expires",
  "keep-alive",
  "last-modified",
  "nel",
  "report-to",
  "request-id",
  "server",
  "server-timing",
  "strict-transport-security",
  "traceparent",
  "tracestate",
  "transfer-encoding",
  "vary",
  "via",
  "x-amzn-requestid",
  "x-amzn-trace-id",
  "x-cloud-trace-context",
  "x-request-id",
]);

/** Prefixes of header families that are always per-run (rate limits, CDN and proxy details). */
const UNSTABLE_PREFIXES = ["x-envoy-", "x-ratelimit-", "ratelimit-", "x-guploader-"];

/** Headers whose whole value is one URL. */
const URL_HEADERS = new Set(["location", "content-location", "referer"]);

/** `Bearer abc` keeps `Bearer `, so a test can still see which scheme was used. */
const AUTH_SCHEME = /^(Bearer|Basic|Digest|Token|token)\s+/;

/**
 * Scrubs every header and returns them as one object with lower-case names,
 * the way `fetch` reports them, so a header with odd casing (`X-Api-KEY`) is
 * still found. Repeated headers are joined with `, `, as `fetch` does.
 * - unstable headers are left out
 * - secret headers (the standard ones and the ones the integration declares)
 *   become `<scrubbed:secret>`, keeping the auth scheme
 * - URL headers (`location`) go through the URL rules
 * - every other value goes through the free-text rules
 */
export function scrubHeaders(
  headers: readonly HeaderEntry[],
  where: string,
  context: ScrubContext,
): RecordedHeaders {
  const result: RecordedHeaders = {};
  for (const [rawName, value] of headers) {
    const name = rawName.toLowerCase();
    if (isUnstable(name) && !isSecret(name, context)) {
      continue;
    }
    const scrubbed = scrubHeader(name, value, `${where}.${name}`, context);
    const earlier = result[name];
    result[name] = earlier === undefined ? scrubbed : `${earlier}, ${scrubbed}`;
  }
  return result;
}

/** Secret headers are always kept (as `<scrubbed:secret>`), so the suite can check them on replay. */
function isSecret(name: string, context: ScrubContext): boolean {
  return SECRET_HEADERS.has(name) || context.policy.secretHeaders.includes(name);
}

function isUnstable(name: string): boolean {
  return UNSTABLE_HEADERS.has(name) || UNSTABLE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function scrubHeader(name: string, value: string, where: string, context: ScrubContext): string {
  if (isSecret(name, context)) {
    context.report.add("secret-header", where);
    return scrubSecretHeader(name, value);
  }
  if (URL_HEADERS.has(name) && URL.canParse(value)) {
    return scrubUrl(value, where, context);
  }
  return scrubText(value, where, context);
}

function scrubSecretHeader(name: string, value: string): string {
  if (name === "cookie" || name === "set-cookie") {
    return SECRET;
  }
  const scheme = AUTH_SCHEME.exec(value)?.[0] ?? "";
  return scheme + SECRET;
}
