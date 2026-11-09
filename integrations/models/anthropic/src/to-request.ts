import { z } from "zod";
import type { ChatMessage, ChatParams, ChatRequest, ToolCall, ToolDefinition } from "./kit.ts";

/**
 * The Messages API request body, as far as we send it.
 * https://docs.anthropic.com/en/api/messages
 */
export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  tools?: AnthropicTool[];
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  thinking?: { type: "adaptive" };
  output_config?: { effort: Effort };
}

/** The effort levels `ChatParams` can ask for; Anthropic has more. */
export type Effort = NonNullable<ChatParams["reasoningEffort"]>;

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicBlock[];
}

export type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string }
  | ReplayedBlock;

/** A block from an earlier answer, sent back as it came: thinking, text, tool_use or newer. */
export type ReplayedBlock = z.infer<typeof replayedBlockSchema>;

/**
 * Run history is stored, so a replay is checked only as far as the API
 * needs: a list of blocks, each with a type. Its fields are Anthropic's.
 */
const replayedBlockSchema = z.looseObject({ type: z.string() });
const replayedContentSchema = z.array(replayedBlockSchema);

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Used when the workflow sets no limit. The API requires one. High, because
 * a cut-off answer has to be asked again, and only what is written is paid.
 */
const defaultMaxTokens = 16_000;

/**
 * The Messages API has no "any JSON" mode without a schema, and
 * `ChatRequest` carries none, so a JSON answer is only asked for in words.
 * That is why the provider reports `jsonOutput: false`.
 */
const jsonInstruction = "Reply with a single JSON value and nothing else.";

/**
 * Maps one `ChatRequest` to a Messages API body. `meta` is never sent, and
 * neither is `extra`, which isn't mapped yet; `ChatParams` lets a provider
 * ignore what it doesn't support.
 *
 * `temperature` and `topP` are passed on as given. Most current models
 * (Opus 4.7 and later, Opus 5 and 5.5, Fable 5 and 5.1, Sonnet 5) refuse
 * them, and Sonnet 5.5 refuses non-default values, so such a request fails
 * with `bad-arguments`. We still map them because Haiku 4.5 and the 4.6
 * models accept them, and the API is the one that knows which model takes
 * what.
 */
export function toAnthropicRequest(request: ChatRequest): AnthropicRequest {
  const params = request.params ?? {};
  const system = toSystemPrompt(request);
  return {
    model: request.model,
    max_tokens: params.maxTokens ?? defaultMaxTokens,
    messages: toAnthropicMessages(request.messages),
    ...(system !== "" ? { system } : {}),
    ...(request.tools?.length ? { tools: request.tools.map(toAnthropicTool) } : {}),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.topP !== undefined ? { top_p: params.topP } : {}),
    ...(params.stop?.length ? { stop_sequences: params.stop } : {}),
    ...(params.reasoningEffort !== undefined ? toThinking(params.reasoningEffort) : {}),
  };
}

/**
 * `reasoningEffort` becomes Anthropic's `output_config.effort`, with
 * adaptive thinking switched on. Effort alone sets how much the model
 * writes; whether it thinks at all is the `thinking` setting, and Opus 4.6
 * to 4.8 and Sonnet 4.6 don't think unless asked. Newer models think
 * anyway, and there adaptive is what they would do without it.
 *
 * Haiku 4.5 and Sonnet 4.5 refuse `effort`, and Opus 4.5 refuses adaptive
 * thinking, so for them a request with `reasoningEffort` fails with
 * `bad-arguments`. Without `reasoningEffort` nothing is sent and each model
 * keeps its own default.
 * https://platform.claude.com/docs/en/build-with-claude/effort
 */
function toThinking(effort: Effort): Pick<AnthropicRequest, "thinking" | "output_config"> {
  return { thinking: { type: "adaptive" }, output_config: { effort } };
}

/** Anthropic takes the system prompt apart from the messages, as one text. */
function toSystemPrompt(request: ChatRequest): string {
  const parts = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content);
  if (request.responseFormat === "json") {
    parts.push(jsonInstruction);
  }
  return parts.join("\n\n");
}

/**
 * Maps the conversation, and joins messages in a row from the same side
 * into one turn: the results of several tool calls go back as one user turn
 * with one `tool_result` block each, as Anthropic expects.
 */
export function toAnthropicMessages(messages: readonly ChatMessage[]): AnthropicMessage[] {
  const turns: AnthropicMessage[] = [];
  for (const message of messages) {
    const turn = toAnthropicTurn(message);
    if (turn === undefined || turn.content.length === 0) {
      continue;
    }
    const previous = turns.at(-1);
    if (previous !== undefined && previous.role === turn.role) {
      previous.content.push(...turn.content);
    } else {
      turns.push(turn);
    }
  }
  return turns;
}

function toAnthropicTurn(message: ChatMessage): AnthropicMessage | undefined {
  switch (message.role) {
    case "system":
      return undefined; // sent as `system`
    case "user":
      return { role: "user", content: textBlocks(message.content) };
    case "assistant":
      return { role: "assistant", content: replayedBlocks(message) ?? assistantBlocks(message) };
    case "tool":
      return {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: message.toolCallId, content: message.content },
        ],
      };
  }
}

type AssistantMessage = Extract<ChatMessage, { role: "assistant" }>;

/**
 * The turn exactly as Anthropic answered it, when we have it. Thinking
 * blocks must go back unchanged, so the turn is never rebuilt from
 * `content` and `toolCalls` while it is here. Another provider's replay,
 * after a model switch, is ignored. Parsing copies the list, so joining
 * turns never changes the stored history.
 */
function replayedBlocks(message: AssistantMessage): AnthropicBlock[] | undefined {
  if (message.replay?.type !== "anthropic") {
    return undefined;
  }
  const parsed = replayedContentSchema.safeParse(message.replay.data);
  return parsed.success ? parsed.data : undefined;
}

/** Without a replay, the turn is rebuilt: text first, then the tool calls. */
function assistantBlocks(message: AssistantMessage): AnthropicBlock[] {
  return [...textBlocks(message.content), ...(message.toolCalls ?? []).map(toToolUseBlock)];
}

/** The API refuses an empty text block, so empty text sends none. */
function textBlocks(text: string): AnthropicBlock[] {
  return text === "" ? [] : [{ type: "text", text }];
}

function toToolUseBlock(call: ToolCall): AnthropicBlock {
  return { type: "tool_use", id: call.id, name: call.name, input: call.arguments };
}

function toAnthropicTool(tool: ToolDefinition): AnthropicTool {
  return { name: tool.name, description: tool.description, input_schema: tool.parameters };
}
