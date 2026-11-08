import { RecordingRefused, type ScrubContext } from "./context.ts";
import { SCRUBBED } from "./fakes.ts";
import { PLACEHOLDER } from "./patterns.ts";
import { isSecretName } from "./secret-names.ts";
import { scrubText } from "./text.ts";

/**
 * Scrubs a URL:
 * - a user name or password in it becomes `scrubbed`
 * - query parameters with secret-like names (`key`, `api_key`,
 *   `access_token`, `sig`, `code` and the integration's own) get a secret stand-in
 * - every other part (path segments, parameter names and values, the
 *   fragment) goes through the free-text rules
 *
 * The host stays: it's declared in the permission sheet and is public.
 * A URL that can't be parsed stops the recording.
 */
export function scrubUrl(url: string, where: string, context: ScrubContext): string {
  const parsed = parseUrl(url, where);
  scrubUserinfo(parsed, where, context);
  parsed.pathname = scrubPath(parsed.pathname, `${where}.path`, context);
  scrubQuery(parsed, where, context);
  if (parsed.hash !== "") {
    parsed.hash = scrubText(safeDecode(parsed.hash), `${where}.fragment`, context);
  }
  return parsed.toString();
}

function parseUrl(url: string, where: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new RecordingRefused(where, "the URL can't be parsed, so it can't be scrubbed");
  }
}

function scrubUserinfo(url: URL, where: string, context: ScrubContext): void {
  if (url.username === "" && url.password === "") {
    return;
  }
  context.report.add("url-userinfo", `${where}.userinfo`);
  url.username = url.username === "" ? "" : SCRUBBED;
  url.password = url.password === "" ? "" : SCRUBBED;
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

function scrubQuery(url: URL, where: string, context: ScrubContext): void {
  if (url.search === "") {
    return;
  }
  const original = [...url.searchParams];
  const scrubbed = original.map(([name, value]): [string, string] => {
    const location = `${where}.query.${name}`;
    if (
      value !== "" &&
      !PLACEHOLDER.test(value) &&
      isSecretName(name, "query-or-form", context.policy.secretFields)
    ) {
      context.report.add("secret-field", location);
      return [name, context.fakes.secret(value)];
    }
    return [scrubText(name, location, context), scrubText(value, location, context)];
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

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
