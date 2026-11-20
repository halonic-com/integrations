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
) => {
  readonly href: string;
  readonly host: string;
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
};

/** One query parameter; `undefined` leaves it out. */
export type QueryValue = string | number | undefined;

/**
 * Builds a URL on the Paperclip server and returns its `href` for
 * `host.http`.
 *
 * `server` is the `url` setting, which may have a path of its own, such as
 * `https://example.com/paperclip`. Each path part is encoded on its own,
 * so an id can't change the path (guide, section 4, rule 4); the argument
 * schemas also allow only letters, digits and hyphens in an id, so a part
 * is never empty, `.` or `..`.
 *
 * @example
 * paperclipUrl("https://tasks.example.com", ["api", "issues", "HAL-12", "comments"], { order: "asc" });
 * // "https://tasks.example.com/api/issues/HAL-12/comments?order=asc"
 */
export function paperclipUrl(
  server: string,
  path: readonly string[],
  query: Readonly<Record<string, QueryValue>> = {},
): string {
  const base = server.endsWith("/") ? server : `${server}/`;
  const url = new URL(path.map(encodeURIComponent).join("/"), base);
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.append(name, String(value));
    }
  }
  return url.href;
}

/**
 * The host and path of a request, without its query, for an error message
 * (guide, section 7, rule 6). The path is shortened: the ids in it are the
 * caller's, and a message stays short.
 */
export function describeRequest(href: string): string {
  const url = new URL(href, href);
  const path =
    url.pathname.length > maxPathLength ? `${url.pathname.slice(0, maxPathLength)}…` : url.pathname;
  return `${url.host}${path}`;
}

/** Paperclip's paths are short; a longer one in a message only comes from a long setting. */
const maxPathLength = 120;
