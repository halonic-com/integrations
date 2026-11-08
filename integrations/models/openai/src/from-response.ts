import { z } from "zod";
import { unexpectedResponse } from "./errors.ts";
import type { ChatResponse, ToolCall } from "./kit.ts";

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const choiceSchema = z.object({
  message: z.object({
    content: z.string().nullable(),
    /** Set instead of `content` when the model declines. */
    refusal: z.string().nullish(),
    tool_calls: z.array(toolCallSchema).nullish(),
  }),
  finish_reason: z.string().nullable(),
});

/** Only the fields we read. OpenAI adds fields over time; they pass through unchecked. */
export const openAiResponseSchema = z.object({
  /** We never ask for more than one choice. */
  choices: z.array(choiceSchema).min(1),
  usage: z.object({
    prompt_tokens: z.int().nonnegative(),
    completion_tokens: z.int().nonnegative(),
  }),
});
export type OpenAiResponse = z.infer<typeof openAiResponseSchema>;

/**
 * Every other reason (`content_filter`, ones added later) is "other". A Map,
 * not a plain object: the reason comes from the service, and a value such as
 * "constructor" would find a function in a plain object.
 */
const finishReasons: ReadonlyMap<string, ChatResponse["finishReason"]> = new Map([
  ["stop", "stop"],
  ["tool_calls", "tool_calls"],
  ["function_call", "tool_calls"],
  ["length", "length"],
]);

/**
 * `prompt_tokens` already includes cached input tokens, and
 * `completion_tokens` includes reasoning tokens, so both count everything
 * spend needs.
 *
 * @throws OpenAiError `unexpected-response` when there is no choice, or a
 *   tool call's arguments aren't a JSON object
 */
export function fromOpenAiResponse(body: OpenAiResponse): ChatResponse {
  const choice = body.choices[0];
  if (choice === undefined) {
    throw unexpectedResponse(); // the schema already refuses this; TypeScript can't know
  }
  return {
    content: choice.message.content ?? choice.message.refusal ?? "",
    toolCalls: (choice.message.tool_calls ?? []).map(toToolCall),
    usage: { inputTokens: body.usage.prompt_tokens, outputTokens: body.usage.completion_tokens },
    finishReason: finishReasons.get(choice.finish_reason ?? "") ?? "other",
  };
}

function toToolCall(call: z.infer<typeof toolCallSchema>): ToolCall {
  return {
    id: call.id,
    name: call.function.name,
    arguments: parseArguments(call.function.arguments),
  };
}

const argumentsSchema = z.record(z.string(), z.unknown());

/**
 * The model writes the arguments as JSON text, and a cut-off answer can leave
 * it broken. Running the tool with empty arguments instead would do
 * something nobody asked for, so the answer is refused.
 */
function parseArguments(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw unexpectedResponse();
  }
  const result = argumentsSchema.safeParse(parsed);
  if (!result.success) {
    throw unexpectedResponse();
  }
  return result.data;
}
