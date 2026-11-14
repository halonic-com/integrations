import { z } from "zod";

export type OpenAiErrorCode =
  | "bad-arguments"
  | "not-signed-in"
  | "not-allowed"
  | "not-found"
  | "rate-limited"
  | "quota-exceeded"
  | "unavailable"
  | "unexpected-response";

/** The one error type of this integration. Its message is safe to show to the user and the model. */
export class OpenAiError extends Error {
  override readonly name = "OpenAiError";
  readonly code: OpenAiErrorCode;

  constructor(code: OpenAiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** What a machine-readable error type looks like. Anything else is left out. */
const typeName = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/i);

/**
 * OpenAI's error body: `{ error: { message, type, param, code } }`. We read
 * only `code` and `type`, and only when they look like type names, because
 * whatever we put in the message reaches the model.
 * https://platform.openai.com/docs/guides/error-codes
 */
const errorBodySchema = z.object({
  error: z.object({
    code: typeName.nullish().catch(undefined),
    type: typeName.nullish().catch(undefined),
  }),
});

/**
 * A `429` with this code means the account has no credit left: trying again
 * later doesn't help, so it gets its own code and message.
 */
const quotaCode = "insufficient_quota";

const messages: Readonly<Record<OpenAiErrorCode, string>> = {
  "bad-arguments": "OpenAI refused the request as invalid",
  "not-signed-in": "OpenAI refused the key. Check the OpenAI key in Settings",
  "not-allowed": "This key may not use this model or feature",
  "not-found": "OpenAI doesn't know this model. Check the model name",
  "rate-limited": "OpenAI is limiting requests. Try again in a moment",
  "quota-exceeded": "The OpenAI account has no credit left. Check its plan and billing",
  unavailable: "OpenAI is having trouble right now. Try again later",
  "unexpected-response": "OpenAI answered in an unexpected way",
};

/** The error for a response that isn't `ok`. Never quotes the body's own text. */
export async function errorForResponse(response: Response): Promise<OpenAiError> {
  // A body that isn't JSON is no error of ours: the status alone says enough.
  const body = errorBodySchema.safeParse(await response.json().catch(() => undefined));
  // Never `error.message` or `error.param`: they can repeat parts of the request.
  const detail = body.success ? (body.data.error.code ?? body.data.error.type) : undefined;
  const code =
    response.status === 429 && detail === quotaCode
      ? "quota-exceeded"
      : codeForStatus(response.status);
  return new OpenAiError(code, `${messages[code]}${detail ? ` (${detail})` : ""}.`);
}

/**
 * The error for a chunk with `error` in a streamed answer. The HTTP status
 * was already `200`, so the code comes from OpenAI's error code if we know
 * it, else from its type. Only when we know neither is it `unavailable`,
 * like a `5xx`.
 */
export function errorForStreamChunk(data: unknown): OpenAiError {
  const body = errorBodySchema.safeParse(data);
  if (!body.success) {
    return unexpectedResponse();
  }
  const { code: errorCode, type: errorType } = body.data.error;
  const code = knownCode(errorCode) ?? knownCode(errorType) ?? "unavailable";
  const detail = errorCode ?? errorType;
  return new OpenAiError(code, `${messages[code]}${detail ? ` (${detail})` : ""}.`);
}

function knownCode(name: string | null | undefined): OpenAiErrorCode | undefined {
  return name ? codeForErrorType.get(name) : undefined;
}

/** OpenAI's error codes and types we know, by our code. A Map, because the name comes from the service. */
const codeForErrorType: ReadonlyMap<string, OpenAiErrorCode> = new Map([
  ["invalid_request_error", "bad-arguments"],
  ["rate_limit_exceeded", "rate-limited"],
  [quotaCode, "quota-exceeded"],
]);

/** For a body that isn't JSON or that the schema refuses. The parse error isn't attached: it can quote the body. */
export function unexpectedResponse(): OpenAiError {
  return new OpenAiError("unexpected-response", `${messages["unexpected-response"]}.`);
}

/** Section 7 of the integration guide, plus `413` (request too large). */
export function codeForStatus(status: number): OpenAiErrorCode {
  if (status === 400 || status === 413 || status === 422) return "bad-arguments";
  if (status === 401) return "not-signed-in";
  if (status === 403) return "not-allowed";
  if (status === 404 || status === 410) return "not-found"; // 410: Gone
  if (status === 408 || status === 429) return "rate-limited";
  return "unavailable"; // 500, 503 and anything else
}
