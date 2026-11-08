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
  | "unavailable"
  | "unexpected-response";

/**
 * An error that is safe to show to the model, the user and the logs. Its
 * message never holds Google's own error text, a query string, a header or
 * the user's content.
 */
export class GoogleError extends Error {
  override readonly name = "GoogleError";
  readonly code: GoogleErrorCode;

  // No `readonly code` parameter property: the TypeScript preset allows only
  // syntax that type stripping can remove (`erasableSyntaxOnly`).
  constructor(code: GoogleErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
