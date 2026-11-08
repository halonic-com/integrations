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
  readonly userContent: readonly string[];
}

/**
 * Google's JSON API errors, the same for Gmail, Drive and every other
 * `*.googleapis.com` API: https://cloud.google.com/apis/design/errors
 *
 * `error.code`, `error.status` and `error.errors[*].reason` and `domain`
 * stay: integrations map errors by them, so a replay needs them.
 */
const googleErrors: ServiceErrorFormat = {
  servesHost: (host) => host === "googleapis.com" || host.endsWith(".googleapis.com"),
  userContent: [
    // The sentence about the error, and the same per error in the older format
    "response.body.error.message",
    "response.body.error.errors[*].message",
    // BadRequest describes each refused field in words, ErrorInfo carries metadata
    "response.body.error.details",
  ],
};

const serviceErrorFormats: readonly ServiceErrorFormat[] = [googleErrors];

/** The error paths the recorder adds for a request to `url`, or none. */
export function serviceErrorPaths(url: string): readonly string[] {
  const host = hostOf(url);
  if (host === undefined) {
    return [];
  }
  return serviceErrorFormats
    .filter((format) => format.servesHost(host))
    .flatMap((format) => format.userContent);
}

/** The URL's host in lower case, or `undefined` when it can't be parsed (the URL rule refuses it). */
function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
