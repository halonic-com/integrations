import { z } from "zod";

export type AnthropicErrorCode =
  | "bad-arguments"
  | "not-signed-in"
  | "not-allowed"
  | "not-found"
  | "rate-limited"
  | "unavailable"
  | "unexpected-response";

/** The one error type of this integration. Its message is safe to show to the user and the model. */
export class AnthropicError extends Error {
  override readonly name = "AnthropicError";
  readonly code: AnthropicErrorCode;

  constructor(code: AnthropicErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Anthropic's error body: `{ type: "error", error: { type, message } }`. We
 * read only `error.type`, and only when it looks like a type name, because
 * whatever we put in the message reaches the model.
 * https://docs.anthropic.com/en/api/errors
 */
const errorBodySchema = z.object({
  error: z.object({ type: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/i) }),
});

const messages: Readonly<Record<AnthropicErrorCode, string>> = {
  "bad-arguments": "Anthropic refused the request as invalid",
  "not-signed-in": "Anthropic refused the key. Check the Anthropic key in Settings",
  "not-allowed": "This key may not use this model or feature",
  "not-found": "Anthropic doesn't know this model. Check the model name",
  "rate-limited": "Anthropic is limiting requests. Try again in a moment",
  unavailable: "Anthropic is having trouble right now. Try again later",
  "unexpected-response": "Anthropic answered in an unexpected way",
};

/** The error for a response that isn't `ok`. Never quotes the body's own text. */
export async function errorForResponse(response: Response): Promise<AnthropicError> {
  const code = codeForStatus(response.status);
  // A body that isn't JSON is no error of ours: the status alone says enough.
  const body = errorBodySchema.safeParse(await response.json().catch(() => undefined));
  // Never `error.message`: it can repeat parts of the request, such as the prompt.
  const detail = body.success ? ` (${body.data.error.type})` : "";
  return new AnthropicError(code, `${messages[code]}${detail}.`);
}

/**
 * The error for an `error` event in a streamed answer. The HTTP status was
 * already `200`, so the code comes from Anthropic's error type instead,
 * such as `overloaded_error` when the API is overloaded mid-answer.
 * https://docs.anthropic.com/en/docs/build-with-claude/streaming#error-events
 */
export function errorForStreamEvent(data: unknown): AnthropicError {
  const body = errorBodySchema.safeParse(data);
  if (!body.success) {
    return unexpectedResponse();
  }
  const type = body.data.error.type;
  const code = codeForErrorType.get(type) ?? "unavailable";
  return new AnthropicError(code, `${messages[code]} (${type}).`);
}

/**
 * Anthropic's error types, by the status they belong to. A Map, because
 * the type comes from the service. Any other type, such as `api_error` or
 * `overloaded_error`, is `unavailable`.
 */
const codeForErrorType: ReadonlyMap<string, AnthropicErrorCode> = new Map([
  ["invalid_request_error", "bad-arguments"],
  ["request_too_large", "bad-arguments"],
  ["authentication_error", "not-signed-in"],
  ["permission_error", "not-allowed"],
  ["not_found_error", "not-found"],
  ["rate_limit_error", "rate-limited"],
]);

/** For a body that isn't JSON or that the schema refuses. The parse error isn't attached: it can quote the body. */
export function unexpectedResponse(): AnthropicError {
  return new AnthropicError("unexpected-response", `${messages["unexpected-response"]}.`);
}

/** Section 7 of the integration guide, plus `413` (request too large) and `529` (overloaded). */
export function codeForStatus(status: number): AnthropicErrorCode {
  if (status === 400 || status === 413 || status === 422) return "bad-arguments";
  if (status === 401) return "not-signed-in";
  if (status === 403) return "not-allowed";
  if (status === 404 || status === 410) return "not-found"; // 410: Gone
  if (status === 408 || status === 429) return "rate-limited";
  return "unavailable"; // 500, 529 (overloaded) and anything else
}
