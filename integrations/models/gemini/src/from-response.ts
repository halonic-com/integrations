import type { ChatResponse, ToolCall } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import { generatedCallId } from "./call-ids.ts";

/** Tokens one model call used. The kit names it only as part of `ChatResponse`. */
type Usage = ChatResponse["usage"];

/**
 * Every part schema is loose: fields we don't read stay on the part,
 * because the whole list of parts goes back unchanged as `replay`.
 * `thoughtSignature` can sit on any part.
 */
const functionCallPartSchema = z.looseObject({
  functionCall: z.looseObject({
    /** Given by Gemini 3 and later; Gemini 2.5 gives none. */
    id: z.string().optional(),
    name: z.string(),
    /** Absent for a call without arguments. */
    args: z.record(z.string(), z.unknown()).optional(),
  }),
  thoughtSignature: z.string().optional(),
});
/** Answer text, or the model's thought summary when `thought` is true. */
const textPartSchema = z.looseObject({
  text: z.string(),
  thought: z.boolean().optional(),
  thoughtSignature: z.string().optional(),
});
/**
 * Any part type we don't read, or one added later: kept for `replay`,
 * otherwise skipped, never a crash. A text or function call part that
 * doesn't fit its schema must fail, not land here, or a broken tool call
 * would silently disappear.
 */
const otherPartSchema = z
  .looseObject({})
  .refine((part) => !Object.hasOwn(part, "text") && !Object.hasOwn(part, "functionCall"));

export const partSchema = z.union([functionCallPartSchema, textPartSchema, otherPartSchema]);
export type GeminiResponsePart = z.infer<typeof partSchema>;
type FunctionCallPart = z.infer<typeof functionCallPartSchema>;
export type TextPart = z.infer<typeof textPartSchema>;

/** Gemini leaves a count out when it is zero. */
const tokenCountSchema = z.int().nonnegative().optional();

/**
 * Only the fields we read. Gemini adds fields over time; they pass through
 * unchecked. A candidate can come without `content` (a blocked answer), and
 * the response without `candidates` (a blocked prompt).
 * https://aistudio.google.com/api-reference/generate-content
 */
export const geminiResponseSchema = z.object({
  /** Used to make up call ids that are unique within a run. */
  responseId: z.string().optional(),
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(partSchema).optional() }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: tokenCountSchema,
      toolUsePromptTokenCount: tokenCountSchema,
      candidatesTokenCount: tokenCountSchema,
      thoughtsTokenCount: tokenCountSchema,
    })
    .optional(),
});
export type GeminiResponse = z.infer<typeof geminiResponseSchema>;

/**
 * Every other reason (`SAFETY`, `RECITATION`, `MALFORMED_FUNCTION_CALL`,
 * ones added later) is "other". A Map, not a plain object: the reason comes
 * from the service, and a value such as "constructor" would find a
 * function in a plain object. Gemini says `STOP` for an answer with
 * function calls too, so `toFinishReason` turns that into `tool_calls`.
 */
const finishReasons: ReadonlyMap<string, ChatResponse["finishReason"]> = new Map([
  ["STOP", "stop"],
  ["MAX_TOKENS", "length"],
]);

/**
 * Reads the first candidate; the request never asks for more than one.
 *
 * `replay` holds all of the candidate's parts, in order, not only the ones
 * with a signature: Gemini wants each signature back on the part it came
 * on, and the parts around it unchanged.
 * https://aistudio.google.com/docs/thought-signatures?generate-content=true
 */
export function fromGeminiResponse(body: GeminiResponse): ChatResponse {
  const candidate = body.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const textParts = parts.filter(isTextPart);
  const toolCalls = parts
    .filter(isFunctionCallPart)
    .map((part, index) => toToolCall(part, body.responseId, index));
  const reasoning = textParts
    .filter((part) => part.thought === true)
    .map((part) => part.text)
    .join("");
  return {
    content: textParts
      .filter((part) => part.thought !== true)
      .map((part) => part.text)
      .join(""),
    ...(reasoning !== "" ? { reasoning } : {}),
    toolCalls,
    replay: { type: "gemini", data: parts },
    usage: toUsage(body.usageMetadata),
    finishReason: toFinishReason(candidate?.finishReason, toolCalls),
  };
}

function toFinishReason(
  reason: string | undefined,
  toolCalls: readonly ToolCall[],
): ChatResponse["finishReason"] {
  const mapped = finishReasons.get(reason ?? "") ?? "other";
  return mapped === "stop" && toolCalls.length > 0 ? "tool_calls" : mapped;
}

/**
 * `promptTokenCount` already holds the tokens read from the cache, so
 * they aren't added again. The prompt for a built-in tool is input too.
 * Thinking is billed as output but isn't in `candidatesTokenCount`, so it
 * is added: `outputTokens` counts every token that is paid as output.
 * https://aistudio.google.com/docs/thinking#pricing
 */
function toUsage(usage: GeminiResponse["usageMetadata"]): Usage {
  return {
    inputTokens: (usage?.promptTokenCount ?? 0) + (usage?.toolUsePromptTokenCount ?? 0),
    outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
  };
}

/** Also used by the stream, so a tool call gets the same id in its pieces as in `done`. */
export function toToolCall(
  part: FunctionCallPart,
  responseId: string | undefined,
  index: number,
): ToolCall {
  const { functionCall, thoughtSignature } = part;
  return {
    id: functionCall.id ?? generatedCallId(responseId, index),
    name: functionCall.name,
    arguments: functionCall.args ?? {},
    ...(thoughtSignature !== undefined ? { signature: thoughtSignature } : {}),
  };
}

export function isTextPart(part: GeminiResponsePart): part is TextPart {
  return Object.hasOwn(part, "text");
}

export function isFunctionCallPart(part: GeminiResponsePart): part is FunctionCallPart {
  return Object.hasOwn(part, "functionCall");
}
