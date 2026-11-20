/**
 * What went wrong reading Paperclip (guide, section 7). The codes are the
 * guide's, plus `bad-config` for a setting the workspace has to fix.
 */
export type PaperclipErrorCode =
  | "bad-arguments"
  | "bad-config"
  | "not-signed-in"
  | "not-allowed"
  | "not-found"
  | "rate-limited"
  | "unavailable"
  | "unexpected-response";

/**
 * How a surface (HTTP, CLI, Studio, MCP) responds to an error. These are
 * the kit's error kinds, copied because `@halonicjs/adapters/integration-kit`
 * doesn't export the type, as `GoogleError` does. A surface reads the
 * `kind` property of an error and reports one without it as an internal
 * error.
 */
export type PaperclipErrorKind =
  | "invalid_input"
  | "not_found"
  | "unauthenticated"
  | "denied"
  | "limit_reached"
  | "unavailable";

/** The kit's error kind for each code. */
const kindForCode: Readonly<Record<PaperclipErrorCode, PaperclipErrorKind>> = {
  "bad-arguments": "invalid_input",
  // A setting the user fixes in the workspace, like a bad argument.
  "bad-config": "invalid_input",
  "not-signed-in": "unauthenticated",
  "not-allowed": "denied",
  "not-found": "not_found",
  "rate-limited": "limit_reached",
  unavailable: "unavailable",
  // Paperclip answered, but not in a shape we can use: not something the user can fix.
  "unexpected-response": "unavailable",
};

/**
 * The integration's one error type. Its message is ours, written for the
 * user: never Paperclip's error text, which can echo what was sent.
 */
export class PaperclipError extends Error {
  override readonly name = "PaperclipError";
  readonly code: PaperclipErrorCode;
  /** How a surface responds to this error; see {@link PaperclipErrorKind}. */
  readonly kind: PaperclipErrorKind;

  // A field set in the body, not `constructor(readonly code …)`:
  // `erasableSyntaxOnly` refuses parameter properties (TS1294).
  constructor(code: PaperclipErrorCode, message: string) {
    super(message);
    this.code = code;
    this.kind = kindForCode[code];
  }
}
