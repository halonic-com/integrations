import { RecordingRefused, type ScrubContext, secretStandIn } from "./context.ts";
import { USER_CONTENT } from "./fakes.ts";
import { PLACEHOLDER } from "./patterns.ts";
import { NO_QUERY_PATHS, type QueryPaths } from "./query-paths.ts";
import { isSecretName } from "./secret-names.ts";
import { scrubText } from "./text.ts";

/*
 * The replay imports this file, and integration tests typecheck it with the
 * integration preset, which has no Web or Node globals. Node and the cloud
 * runtimes all have these, so only the parts used here are declared.
 */
interface ParsedUrl {
  username: string;
  password: string;
  pathname: string;
  search: string;
  hash: string;
  readonly searchParams: Iterable<[string, string]>;
  toString(): string;
}
declare const URL: {
  new (url: string, base?: string): ParsedUrl;
  canParse(url: string, base?: string): boolean;
};
declare const URLSearchParams: new (pairs: [string, string][]) => { toString(): string };

/**
 * Scrubs a URL:
 * - a user name or password in it is removed (`fetch` refuses such URLs
 *   anyway, and a stand-in like `x@host` would read as an e-mail address)
 * - query parameters with secret-like names (`key`, `api_key`,
 *   `access_token`, `sig`, `code` and the integration's own) get a secret stand-in
 * - query parameters the sheet declares as user content (`request.query.q`)
 *   get the user-content placeholder; one that also has a secret-like name
 *   gets the secret stand-in, and still counts as matched
 * - a query value that is itself a web URL goes through these rules too
 * - every other part (path segments, parameter names and values, the
 *   fragment) goes through the free-text rules
 *
 * The host stays: it's declared in the permission sheet and is public.
 * A URL that can't be parsed stops the recording.
 */
export function scrubUrl(
  url: string,
  where: string,
  context: ScrubContext,
  userContent: QueryPaths = NO_QUERY_PATHS,
): string {
  const parsed = parseUrl(url, where);
  scrubUserinfo(parsed, where, context);
  parsed.pathname = scrubPath(parsed.pathname, `${where}.path`, context);
  scrubQuery(parsed, where, userContent, context);
  if (parsed.hash !== "") {
    parsed.hash = scrubText(safeDecode(parsed.hash), `${where}.fragment`, context);
  }
  return parsed.toString();
}

/** Only used to read a relative URL; never written to a recording. */
export const RELATIVE_BASE = "https://relative.invalid";

/** A query value that is a web URL. Not any URL: `from:someone` parses as one too. */
const NESTED_URL = /^https?:\/\//i;

/**
 * Scrubs a URL that may be relative, as in a `Location: /callback?code=...`
 * header. A relative URL is read against a placeholder host, scrubbed by the
 * same rules and written back relative. An untouched URL keeps its exact form.
 */
export function scrubUrlReference(url: string, where: string, context: ScrubContext): string {
  if (URL.canParse(url)) {
    return scrubUrl(url, where, context);
  }
  if (!URL.canParse(url, RELATIVE_BASE)) {
    return scrubText(url, where, context);
  }
  const resolved = new URL(url, RELATIVE_BASE).toString();
  const scrubbed = scrubUrl(resolved, where, context);
  if (scrubbed === resolved) {
    return url;
  }
  // A protocol-relative URL (`//host/path`) names its own host, so it stays whole.
  return scrubbed.startsWith(`${RELATIVE_BASE}/`) ? scrubbed.slice(RELATIVE_BASE.length) : scrubbed;
}

function parseUrl(url: string, where: string): ParsedUrl {
  try {
    return new URL(url);
  } catch {
    throw new RecordingRefused(where, "the URL can't be parsed, so it can't be scrubbed");
  }
}

function scrubUserinfo(url: ParsedUrl, where: string, context: ScrubContext): void {
  if (url.username === "" && url.password === "") {
    return;
  }
  context.report.add("url-userinfo", `${where}.userinfo`);
  url.username = "";
  url.password = "";
}

/** Each segment is decoded, scrubbed and encoded again; untouched segments keep their exact form. */
function scrubPath(pathname: string, where: string, context: ScrubContext): string {
  return pathname
    .split("/")
    .map((segment) => {
      const decoded = safeDecode(segment);
      const scrubbed = scrubText(decoded, where, context);
      return scrubbed === decoded ? segment : encodeURIComponent(scrubbed);
    })
    .join("/");
}

function scrubQuery(
  url: ParsedUrl,
  where: string,
  userContent: QueryPaths,
  context: ScrubContext,
): void {
  if (url.search === "") {
    return;
  }
  const original = [...url.searchParams];
  const scrubbed = original.map(([rawName, value]): [string, string] => {
    // The name is scrubbed first, so the report never holds an address used as a name.
    const name = scrubText(rawName, `${where}.query`, context);
    const location = `${where}.query.${name}`;
    const declared = userContent.match(rawName);
    // A declared parameter counts as matched whichever rule replaces it: one
    // with a secret-like name (`request.query.code`) goes to the secret rule.
    if (declared !== undefined) {
      context.matchedUserContent.add(declared);
    }
    if (
      value !== "" &&
      !PLACEHOLDER.test(value) &&
      isSecretName(rawName, "query-or-form", context.policy.secretFields)
    ) {
      context.report.add("secret-field", location);
      return [name, secretStandIn(value, context)];
    }
    if (declared !== undefined) {
      return [name, replaceUserContent(value, location, context)];
    }
    return [name, scrubQueryValue(value, location, context)];
  });
  const changed = scrubbed.some(([name, value], index) => {
    const [originalName, originalValue] = original[index] ?? [];
    return name !== originalName || value !== originalValue;
  });
  // Only rewrite the query when something changed, so an untouched URL keeps its exact form.
  if (changed) {
    url.search = new URLSearchParams(scrubbed).toString();
  }
}

/** An empty value stays empty: there is nothing in it to remove. */
function replaceUserContent(value: string, where: string, context: ScrubContext): string {
  if (value === "") {
    return value;
  }
  context.report.add("user-content", where);
  return USER_CONTENT.text;
}

/**
 * A query value that is itself a URL (`?next=https://...?token=...`) goes
 * through the URL rules, so its own secret parameters are found by name.
 */
function scrubQueryValue(value: string, where: string, context: ScrubContext): string {
  if (NESTED_URL.test(value) && URL.canParse(value)) {
    return scrubUrl(value, where, context);
  }
  return scrubText(value, where, context);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
