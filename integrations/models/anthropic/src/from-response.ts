import { z } from "zod";
import type { ChatResponse, ToolCall, Usage } from "./kit.ts";

/**
 * Every block schema is loose: fields we don't read, such as a thinking
 * block's `signature`, stay on the block, because the whole content goes
 * back unchanged as `replay`.
 */
const textBlockSchema = z.looseObject({ type: z.literal("text"), text: z.string() });
const toolUseBlockSchema = z.looseObject({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});
/**
 * Thinking and any block type added later: kept for `replay`, otherwise
 * skipped, never a crash. A text or tool_use block that doesn't fit its
 * schema must fail, not land here, or a broken tool call would silently
 * disappear.
 */
const otherBlockSchema = z.looseObject({
  type: z.string().refine((type) => type !== "text" && type !== "tool_use"),
});

/** Absent, or `null` on older models, when the prompt cache wasn't used. */
const cacheTokensSchema = z.int().nonnegative().nullish();

/**
 * The cache writes split by how long the cache entry lives. Absent on older
 * models and in older recordings.
 */
export const cacheCreationSchema = z
  .object({
    ephemeral_5m_input_tokens: cacheTokensSchema,
    ephemeral_1h_input_tokens: cacheTokensSchema,
  })
  .nullish();

/** Only the fields we read. Anthropic adds fields over time; they pass through unchecked. */
export const anthropicResponseSchema = z.object({
  content: z.array(z.union([textBlockSchema, toolUseBlockSchema, otherBlockSchema])),
  stop_reason: z.string().nullable(),
  usage: z.object({
    input_tokens: z.int().nonnegative(),
    output_tokens: z.int().nonnegative(),
    cache_creation_input_tokens: cacheTokensSchema,
    cache_read_input_tokens: cacheTokensSchema,
    cache_creation: cacheCreationSchema,
  }),
});
export type AnthropicResponse = z.infer<typeof anthropicResponseSchema>;
type AnthropicContentBlock = AnthropicResponse["content"][number];

/**
 * Every other reason (`refusal`, `pause_turn`, ones added later) is "other".
 * A Map, not a plain object: the reason comes from the service, and a value
 * such as "constructor" would find a function in a plain object.
 */
const finishReasons: ReadonlyMap<string, ChatResponse["finishReason"]> = new Map([
  ["end_turn", "stop"],
  ["stop_sequence", "stop"],
  ["tool_use", "tool_calls"],
  ["max_tokens", "length"],
]);

/**
 * `replay` holds the whole ordered content, not only the thinking blocks:
 * thinking can sit between text and tool_use blocks, and Anthropic wants
 * the turn back exactly as it came, signatures included.
 * https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
 */
export function fromAnthropicResponse(body: AnthropicResponse): ChatResponse {
  return {
    content: body.content
      .filter(isTextBlock)
      .map((block) => block.text)
      .join(""),
    toolCalls: body.content.filter(isToolUseBlock).map(toToolCall),
    replay: { type: "anthropic", data: body.content },
    usage: toUsage(body.usage),
    finishReason: finishReasons.get(body.stop_reason ?? "") ?? "other",
  };
}

/**
 * `input_tokens` already leaves out the tokens read from or written to the
 * prompt cache, which is what `inputTokens` means too. The cache tokens go
 * in their own counts, because spend prices each at its own price
 * (decision HAL-2688-01 and -02 in halonic-com/halonic). A count that is 0
 * is left out.
 * https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 */
function toUsage(usage: AnthropicResponse["usage"]): Usage {
  const writes = cacheWrites(usage);
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    ...countIfAny("cacheReadTokens", usage.cache_read_input_tokens ?? 0),
    ...countIfAny("cacheWriteTokens", writes.short),
    ...countIfAny("cacheWrite1hTokens", writes.oneHour),
  };
}

/**
 * Splits the cache writes into 5-minute and 1-hour writes, which cost
 * different prices. Without the `cache_creation` split, every write counts
 * as a 5-minute write: that is the default lifetime, and the cheaper price
 * when the model has a 1-hour price too.
 */
function cacheWrites(usage: AnthropicResponse["usage"]): { short: number; oneHour: number } {
  const total = usage.cache_creation_input_tokens ?? 0;
  if (usage.cache_creation === undefined || usage.cache_creation === null) {
    return { short: total, oneHour: 0 };
  }
  return {
    short: usage.cache_creation.ephemeral_5m_input_tokens ?? 0,
    oneHour: usage.cache_creation.ephemeral_1h_input_tokens ?? 0,
  };
}

function countIfAny<Field extends keyof Usage>(field: Field, count: number): Partial<Usage> {
  return count > 0 ? { [field]: count } : {};
}

function toToolCall(block: z.infer<typeof toolUseBlockSchema>): ToolCall {
  return { id: block.id, name: block.name, arguments: block.input };
}

function isTextBlock(block: AnthropicContentBlock): block is z.infer<typeof textBlockSchema> {
  return block.type === "text";
}

function isToolUseBlock(block: AnthropicContentBlock): block is z.infer<typeof toolUseBlockSchema> {
  return block.type === "tool_use";
}
