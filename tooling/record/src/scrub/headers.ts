import { type ScrubContext, secretStandIn } from "./context.ts";
import type { HeaderEntry, RecordedHeaders } from "./exchange.ts";
import { SECRET } from "./fakes.ts";
import { AUTH_SCHEME, PLACEHOLDER } from "./patterns.ts";
import { isSecretName } from "./secret-names.ts";
import { scrubText } from "./text.ts";
import { scrubUrlReference } from "./url.ts";

/** Headers that carry the integration's own key for every integration. */
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
 * fit the body as saved (`content-length` changes when a body is scrubbed, and
 * `content-encoding` would claim a gzip body when the file holds it decoded).
 * Leaving them out keeps recordings stable between runs and replayable.
 */
const UNSTABLE_HEADERS = new Set([
  "age",
  "alt-svc",
  "cf-cache-status",
  "cf-ray",
  "connection",
  "content-encoding",
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
const UNSTABLE_PREFIXES = [
  "x-envoy-",
  "x-ratelimit-",
  "ratelimit-",
  "anthropic-ratelimit-",
  "x-guploader-",
];

/** Headers whose whole value is one URL, absolute or relative. */
const URL_HEADERS = new Set(["location", "content-location", "referer"]);

/** A URL in angle brackets, as a `Link` header lists them (RFC 8288). */
const LINK_TARGET = /<([^>]*)>/;

/**
 * Scrubs every header and returns them as one object with lower-case names,
 * the way `fetch` reports them, so a header with odd casing (`X-Api-KEY`) is
 * still found. Repeated headers are joined with `, `, as `fetch` does.
 * - unstable headers are left out
 * - key headers (the standard ones and the ones the integration declares)
 *   become `<scrubbed:secret>`, keeping the auth scheme
 * - headers named like a secret (`X-Access-Token`, `Private-Token`,
 *   `X-Session-Id`) get a secret stand-in, the same way query, form and JSON
 *   fields do
 * - URL headers (`location`) go through the URL rules, and so does each
 *   `<url>` of a `link` header
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
    if (isUnstable(name) && !isKeyHeader(name, context)) {
      continue;
    }
    const scrubbed = scrubHeader(name, value, `${where}.${name}`, context);
    const earlier = result[name];
    result[name] = earlier === undefined ? scrubbed : `${earlier}, ${scrubbed}`;
  }
  return result;
}

/**
 * True when a header holds a secret: a standard key header, or one whose
 * name says so. The safety net uses this too, so both judge headers the
 * same way.
 */
export function isSecretHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return SECRET_HEADERS.has(lower) || isSecretName(lower, "header", []);
}

/**
 * Key headers are always kept (as `<scrubbed:secret>`), even when their name
 * looks unstable, so the suite can check them on replay. Other headers named
 * like a secret are not: `x-ratelimit-remaining-tokens` is still left out.
 */
function isKeyHeader(name: string, context: ScrubContext): boolean {
  return SECRET_HEADERS.has(name) || context.policy.secretHeaders.includes(name);
}

function isUnstable(name: string): boolean {
  return UNSTABLE_HEADERS.has(name) || UNSTABLE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function scrubHeader(name: string, value: string, where: string, context: ScrubContext): string {
  if (isKeyHeader(name, context)) {
    context.report.add("secret-header", where);
    return scrubKeyHeader(name, value);
  }
  if (isSecretHeader(name)) {
    return scrubSecretNamedHeader(value, where, context);
  }
  if (URL_HEADERS.has(name)) {
    return scrubUrlReference(value, where, context);
  }
  if (name === "link") {
    return scrubLinkHeader(value, where, context);
  }
  return scrubText(value, where, context);
}

/**
 * `<https://...?page_token=...>; rel="next", <...>; rel="last"`: each URL
 * goes through the URL rules, so a query parameter named like a secret is
 * replaced as it is in a request URL. The parameters between the URLs go
 * through the free-text rules.
 */
function scrubLinkHeader(value: string, where: string, context: ScrubContext): string {
  // Splitting on a pattern with one group puts the URLs at the odd indexes.
  const parts = value.split(new RegExp(LINK_TARGET, "g"));
  return parts
    .map((part, index) =>
      index % 2 === 1
        ? `<${scrubUrlReference(part, where, context)}>`
        : scrubText(part, where, context),
    )
    .join("");
}

function scrubKeyHeader(name: string, value: string): string {
  if (name === "cookie" || name === "set-cookie") {
    return SECRET;
  }
  return schemeOf(value) + SECRET;
}

function scrubSecretNamedHeader(value: string, where: string, context: ScrubContext): string {
  const scheme = schemeOf(value);
  const credential = value.slice(scheme.length);
  if (credential === "" || PLACEHOLDER.test(credential)) {
    return value;
  }
  context.report.add("secret-header", where);
  return scheme + secretStandIn(credential, context);
}

/** `Bearer abc` keeps `Bearer `, so a test can still see which scheme was used. */
function schemeOf(value: string): string {
  return AUTH_SCHEME.exec(value)?.[0] ?? "";
}
