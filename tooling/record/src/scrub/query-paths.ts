import { RecordingRefused } from "./context.ts";

/**
 * The query parameters of the request URL that hold the user's own content,
 * such as Gmail's search in `?q=from:...`. A sheet declares them in
 * `recording.userContent` as `request.query.<name>`, next to its body paths.
 * See `ScrubPolicy.userContent`.
 *
 * A path names exactly one parameter: no wildcards and no steps after the
 * name. Only the request URL is matched, not a URL inside a query value or
 * in a response header.
 */
export class QueryPaths {
  /** The declared path for each parameter name. */
  private readonly byName: ReadonlyMap<string, string>;

  /**
   * Keeps the paths that start at `request.query`. Throws `RecordingRefused`
   * for one it can't read: a path that silently matched nothing would leave
   * content in the file that was meant to be removed.
   */
  constructor(sources: readonly string[]) {
    this.byName = new Map(
      sources.filter(isQueryPath).map((source) => [parameterName(source), source]),
    );
  }

  /** The declared path for the parameter `name`, if any. Names match exactly. */
  match(name: string): string | undefined {
    return this.byName.get(name);
  }
}

/** No declared query parameters, for URLs the sheet's paths don't reach. */
export const NO_QUERY_PATHS = new QueryPaths([]);

const QUERY_PREFIX = "request.query";

/** One parameter name after the prefix; dots, brackets and `*` would read as path steps. */
const QUERY_PATH = /^request\.query\.([^.[\]*]+)$/;

/** True for a path that points into the request's query string rather than a body. */
export function isQueryPath(source: string): boolean {
  return source === QUERY_PREFIX || source.startsWith(`${QUERY_PREFIX}.`);
}

function parameterName(source: string): string {
  const found = QUERY_PATH.exec(source);
  if (found?.[1] === undefined) {
    throw new RecordingRefused(
      "recording.userContent",
      `the path "${source}" is unclear: a query path is request.query.<name>, one parameter name without wildcards`,
    );
  }
  return found[1];
}
