import { z } from "zod";
import { GoogleError } from "./errors.ts";

/*
 * The integration preset has no Web or Node globals. Node and the cloud
 * runtimes all have `URL` and `URLSearchParams`, so only the parts used
 * here are declared.
 */
interface URLSearchParams {
  append(name: string, value: string): void;
}
declare const URL: new (
  url: string,
  base: string,
) => { readonly href: string; readonly searchParams: URLSearchParams };

/** The base URLs of the Google APIs our integrations call. Each ends in `/`. */
export const googleBaseUrls = {
  gmail: "https://gmail.googleapis.com/gmail/v1/",
  drive: "https://www.googleapis.com/drive/v3/",
  /** Drive takes file contents on a separate path. */
  driveUpload: "https://www.googleapis.com/upload/drive/v3/",
} as const;

/** One query parameter. A list repeats the parameter; `undefined` leaves it out. */
export type QueryValue = string | number | boolean | readonly string[] | undefined;

/**
 * Path parts that `new URL` would resolve as dot segments, or that would
 * point at the parent resource. Encoding doesn't help: `new URL` also
 * resolves `%2e`, so these are refused instead.
 */
const unsafePathParts: ReadonlySet<string> = new Set(["", ".", ".."]);

/**
 * Builds a Google API URL and returns its `href` for `host.http`.
 *
 * Each path part is encoded on its own, so an id such as `../admin` can't
 * change the path (guide, section 4, rule 4). A part that is empty, `.` or
 * `..` would still change it, so it throws a `bad-arguments` error. Query
 * values are encoded by `URLSearchParams`.
 *
 * @example
 * googleUrl(googleBaseUrls.gmail, ["users", "me", "messages", messageId], {
 *   format: "metadata",
 *   metadataHeaders: ["From", "Subject"],
 * });
 */
export function googleUrl(
  base: string,
  path: readonly string[],
  query: Readonly<Record<string, QueryValue>> = {},
): string {
  const url = new URL(path.map(encodePathPart).join("/"), base);
  for (const [name, value] of Object.entries(query)) {
    appendQueryValue(url.searchParams, name, value);
  }
  return url.href;
}

function encodePathPart(part: string): string {
  if (unsafePathParts.has(part)) {
    // The value is left out of the message: it may come from the model.
    throw new GoogleError(
      "bad-arguments",
      "A path part can't be empty, '.' or '..'. Check the ids",
    );
  }
  return encodeURIComponent(part);
}

function appendQueryValue(params: URLSearchParams, name: string, value: QueryValue): void {
  if (value === undefined) {
    return;
  }
  if (typeof value === "object") {
    for (const item of value) {
      params.append(name, item);
    }
    return;
  }
  params.append(name, String(value));
}

/**
 * Adds Google's `nextPageToken` to a list schema. A tool hands the token
 * back to the model, which passes it as `pageToken` for the next page.
 * There is no loop over pages here on purpose: one tool call fetches one
 * page (guide, section 4, rule 9).
 *
 * @example
 * const messageListSchema = withNextPageToken(
 *   z.object({ messages: z.array(z.object({ id: z.string() })).default([]) }),
 * );
 * googleUrl(googleBaseUrls.gmail, ["users", "me", "messages"], { q: query, pageToken });
 */
export function withNextPageToken<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  return schema.extend({ nextPageToken: z.string().optional() });
}
