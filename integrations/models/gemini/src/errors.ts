export type GeminiErrorCode =
  | "bad-arguments"
  | "not-signed-in"
  | "not-allowed"
  | "not-found"
  | "rate-limited"
  | "unavailable"
  | "unexpected-response";

/** The one error type of this integration. Its message is safe to show to the user and the model. */
export class GeminiError extends Error {
  override readonly name = "GeminiError";
  readonly code: GeminiErrorCode;

  constructor(code: GeminiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
