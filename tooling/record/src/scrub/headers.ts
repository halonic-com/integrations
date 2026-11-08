import type { ScrubContext } from "./context.ts";
import type { HeaderEntry } from "./exchange.ts";
import { SCRUBBED } from "./fakes.ts";
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

/** Headers whose whole value is one URL. */
const URL_HEADERS = new Set(["location", "content-location", "referer"]);

/** `Bearer abc` keeps `Bearer `, so a test can still see which scheme was used. */
const AUTH_SCHEME = /^(Bearer|Basic|Digest|Token|token)\s+/;

/**
 * Scrubs every header. Names are written in lower case, the way `fetch`
 * reports them, so a header with odd casing (`X-Api-KEY`) is still found.
 * - secret headers (the standard ones and the ones the integration declares)
 *   get a secret stand-in, keeping the auth scheme; cookies become `scrubbed`
 * - URL headers (`location`) go through the URL rules
 * - every other value goes through the free-text rules
 */
export function scrubHeaders(
  headers: readonly HeaderEntry[],
  where: string,
  context: ScrubContext,
): HeaderEntry[] {
  return headers.map(([rawName, value]): HeaderEntry => {
    const name = rawName.toLowerCase();
    const location = `${where}.${name}`;
    if (SECRET_HEADERS.has(name) || context.policy.secretHeaders.includes(name)) {
      context.report.add("secret-header", location);
      return [name, scrubSecretHeader(name, value, context)];
    }
    if (URL_HEADERS.has(name) && URL.canParse(value)) {
      return [name, scrubUrl(value, location, context)];
    }
    return [name, scrubText(value, location, context)];
  });
}

function scrubSecretHeader(name: string, value: string, context: ScrubContext): string {
  if (name === "cookie" || name === "set-cookie") {
    return SCRUBBED;
  }
  const scheme = AUTH_SCHEME.exec(value)?.[0] ?? "";
  return scheme + context.fakes.secret(value.slice(scheme.length));
}
