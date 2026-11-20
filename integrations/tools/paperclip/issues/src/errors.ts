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
 * The integration's one error type. Its message is ours, written for the
 * user: never Paperclip's error text, which can echo what was sent.
 */
export class PaperclipError extends Error {
  override readonly name = "PaperclipError";
  readonly code: PaperclipErrorCode;

  // A field set in the body, not `constructor(readonly code …)`:
  // `erasableSyntaxOnly` refuses parameter properties (TS1294).
  constructor(code: PaperclipErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
