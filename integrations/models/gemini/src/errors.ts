import { z } from "zod";
import type { HttpResponse } from "./kit.ts";

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

/** What a machine-readable reason or status looks like. Anything else is left out. */
const typeName = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/i);

/**
 * Google's error body. We read only `status` (`INVALID_ARGUMENT`) and the
 * `reason` of a `details` entry (`API_KEY_INVALID`), and only when they look
 * like type names, because whatever we put in the message reaches the
 * model. Never `message`: it can repeat parts of the request.
 * https://aistudio.google.com/docs/api-errors
 */
const errorBodySchema = z.object({
  error: z.object({
    /** The HTTP status, as a number. Read only in a streamed answer, whose own status was `200`. */
    code: z.int().optional().catch(undefined),
    status: typeName.optional().catch(undefined),
    details: z
      .array(z.looseObject({ reason: typeName.optional().catch(undefined) }))
      .optional()
      .catch(undefined),
  }),
});

/**
 * Gemini answers a wrong or revoked key with `400 INVALID_ARGUMENT`, not
 * `401`. Only this reason tells it apart from a refused request.
 */
const keyRefusedReasons: ReadonlySet<string> = new Set(["API_KEY_INVALID", "API_KEY_EXPIRED"]);

const messages: Readonly<Record<GeminiErrorCode, string>> = {
  "bad-arguments": "Gemini refused the request as invalid",
  "not-signed-in": "Google refused the key. Check the Gemini key in Settings",
  "not-allowed": "This key may not use this model or feature",
  "not-found": "Gemini doesn't know this model. Check the model name",
  "rate-limited": "Gemini is limiting requests, or a quota is used up. Try again later",
  unavailable: "Gemini is having trouble right now. Try again later",
  "unexpected-response": "Gemini answered in an unexpected way",
};

/** The error for a response that isn't `ok`. Never quotes the body's own text. */
export async function errorForResponse(response: HttpResponse): Promise<GeminiError> {
  // A body that isn't JSON is no error of ours: the status alone says enough.
  const body = errorBodySchema.safeParse(await response.json().catch(() => undefined));
  const reason = body.success ? firstReason(body.data.error.details) : undefined;
  const status = body.success ? body.data.error.status : undefined;
  const code =
    reason !== undefined && keyRefusedReasons.has(reason)
      ? "not-signed-in"
      : codeForStatus(response.status);
  const detail = reason ?? status;
  return new GeminiError(code, `${messages[code]}${detail ? ` (${detail})` : ""}.`);
}

/**
 * The error for a chunk with `error` in a streamed answer: the HTTP status
 * was already `200`, so the code comes from the error itself. The most
 * exact value decides: a refused-key reason first, then Google's status
 * name, then the HTTP status in `code`. Only when none of them is known is
 * it `unavailable`, so a request that can never succeed isn't retried.
 * https://aistudio.google.com/docs/api-errors
 */
export function errorForStreamChunk(data: unknown): GeminiError {
  const body = errorBodySchema.safeParse(data);
  if (!body.success) {
    return unexpectedResponse();
  }
  const { code: httpStatus, status, details } = body.data.error;
  const reason = firstReason(details);
  const code = codeForStreamError(reason, status, httpStatus);
  const detail = reason ?? status;
  return new GeminiError(code, `${messages[code]}${detail ? ` (${detail})` : ""}.`);
}

function codeForStreamError(
  reason: string | undefined,
  status: string | undefined,
  httpStatus: number | undefined,
): GeminiErrorCode {
  if (reason !== undefined && keyRefusedReasons.has(reason)) {
    return "not-signed-in";
  }
  const byStatusName = status === undefined ? undefined : codeForStatusName.get(status);
  if (byStatusName !== undefined) {
    return byStatusName;
  }
  return httpStatus === undefined ? "unavailable" : codeForStatus(httpStatus);
}

/**
 * Google's status names, by the HTTP status they belong to, mapped as
 * `codeForStatus` maps that status. A Map, because the name comes from the
 * service. `INTERNAL`, `UNAVAILABLE`, `DEADLINE_EXCEEDED` and any other
 * name are left to the HTTP status.
 */
const codeForStatusName: ReadonlyMap<string, GeminiErrorCode> = new Map([
  ["INVALID_ARGUMENT", "bad-arguments"],
  ["FAILED_PRECONDITION", "bad-arguments"],
  ["OUT_OF_RANGE", "bad-arguments"],
  ["UNAUTHENTICATED", "not-signed-in"],
  ["PERMISSION_DENIED", "not-allowed"],
  ["NOT_FOUND", "not-found"],
  ["RESOURCE_EXHAUSTED", "rate-limited"],
]);

/** The reason of the first `details` entry that has one: Google's `ErrorInfo`. */
function firstReason(details: readonly { reason?: string | undefined }[] | undefined) {
  return details?.find((detail) => detail.reason !== undefined)?.reason;
}

/** For a body that isn't JSON or that the schema refuses. The parse error isn't attached: it can quote the body. */
export function unexpectedResponse(): GeminiError {
  return new GeminiError("unexpected-response", `${messages["unexpected-response"]}.`);
}

/**
 * Section 7 of the integration guide, plus `413` (request too large). A
 * `429` is a per-minute limit or a used-up daily quota alike; only the
 * free-text details tell them apart, so both are `rate-limited`.
 */
export function codeForStatus(status: number): GeminiErrorCode {
  if (status === 400 || status === 413 || status === 422) return "bad-arguments";
  if (status === 401) return "not-signed-in";
  if (status === 403) return "not-allowed";
  if (status === 404 || status === 410) return "not-found"; // 410: Gone
  if (status === 408 || status === 429) return "rate-limited";
  return "unavailable"; // 500, 503, 504 and anything else
}
