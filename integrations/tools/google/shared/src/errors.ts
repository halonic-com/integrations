import type { DisabledApi } from "./disabled-api.ts";

/**
 * The one error type for every Google integration (guide, section 7).
 * Gmail and Drive both throw it, so a message reads the same whichever
 * service failed.
 */

/** What went wrong, in the guide's short codes. */
export type GoogleErrorCode =
  | "bad-arguments"
  | "not-signed-in"
  | "not-allowed"
  | "not-found"
  | "rate-limited"
  | "quota-exceeded"
  | "api-disabled"
  | "unavailable"
  | "unexpected-response";

/**
 * How a surface (HTTP, CLI, Studio, MCP) responds to an error. These are
 * the kit's error kinds, copied because `@halonicjs/adapters/integration-kit`
 * doesn't export the type. A surface reads the `kind` property of an error
 * and reports one without it as an internal error.
 */
export type GoogleErrorKind =
  | "invalid_input"
  | "not_found"
  | "unauthenticated"
  | "denied"
  | "limit_reached"
  | "unavailable";

/** The kit's error kind for each code. */
const kindForCode: Readonly<Record<GoogleErrorCode, GoogleErrorKind>> = {
  "bad-arguments": "invalid_input",
  "not-signed-in": "unauthenticated",
  "not-allowed": "denied",
  "not-found": "not_found",
  "rate-limited": "limit_reached",
  "quota-exceeded": "limit_reached",
  // A rule in the user's Google Cloud project says no until they switch the API on.
  "api-disabled": "denied",
  unavailable: "unavailable",
  // Google answered, but not in a shape we can use: not something the user can fix.
  "unexpected-response": "unavailable",
};

/**
 * An error that is safe to show to the model, the user and the logs. Its
 * message never holds Google's own error text, a query string, a header or
 * the user's content.
 */
export class GoogleError extends Error {
  override readonly name = "GoogleError";
  readonly code: GoogleErrorCode;
  /** How a surface responds to this error; see {@link GoogleErrorKind}. */
  readonly kind: GoogleErrorKind;

  // No `readonly code` parameter property: the TypeScript preset allows only
  // syntax that type stripping can remove (`erasableSyntaxOnly`).
  constructor(code: GoogleErrorCode, message: string) {
    super(message);
    this.code = code;
    this.kind = kindForCode[code];
  }
}

/**
 * The Google API the request needs is switched off in the user's Google
 * Cloud project: a `403` with `SERVICE_DISABLED` or `accessNotConfigured`.
 * Halonic's run banner reads `api` and `project` to link straight to the
 * API's "Enable" page.
 *
 * Both are `undefined` when Google didn't name them in a shape we trust,
 * and in a replay: the recorder removes the error details they come from.
 */
export class GoogleApiDisabledError extends GoogleError {
  override readonly code = "api-disabled";
  /** The API's service name, such as `drive.googleapis.com`. */
  readonly api: string | undefined;
  /** The Google Cloud project as Google names it in the error: usually its number. */
  readonly project: string | undefined;
  /**
   * The typed cause Halonic records on a failed run, so Studio's "API off"
   * banner never reads the message. The code is stable; `detail` holds `api`
   * and `project` when Google named them, and `enableUrl`, the API's page in
   * the Google Cloud console, when the API is known. Google's own
   * `activationUrl` is never passed on: the link is built here from the
   * `api` and `project` that passed their pattern.
   */
  readonly failureCause: {
    readonly code: "google.api-disabled";
    readonly detail: Readonly<Record<string, string>>;
  };

  constructor(message: string, disabled: DisabledApi) {
    super("api-disabled", message);
    this.api = disabled.api;
    this.project = disabled.project;
    this.failureCause = {
      code: "google.api-disabled",
      detail: {
        ...(disabled.api === undefined ? {} : { api: disabled.api }),
        ...(disabled.project === undefined ? {} : { project: disabled.project }),
        ...(disabled.api === undefined
          ? {}
          : { enableUrl: enableUrlFor(disabled.api, disabled.project) }),
      },
    };
  }
}

/**
 * The API's page in the Google Cloud console, with its "Enable" button. The
 * project is added when known, so the page opens in the right one. Both
 * parts passed a strict pattern (lower-case letters, digits, hyphens and
 * dots), so neither needs escaping.
 */
function enableUrlFor(api: string, project: string | undefined): string {
  const page = `https://console.cloud.google.com/apis/library/${api}`;
  return project === undefined ? page : `${page}?project=${project}`;
}
