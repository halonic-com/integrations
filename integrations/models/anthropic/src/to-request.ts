import type { ChatMessage, ChatRequest, ToolCall, ToolDefinition } from "./kit.ts";

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
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicBlock[];
}

export type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

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
 * neither are `reasoningEffort` and `extra`, which aren't mapped yet;
 * `ChatParams` lets a provider ignore what it doesn't support.
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
  };
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
      return {
        role: "assistant",
        content: [...textBlocks(message.content), ...(message.toolCalls ?? []).map(toToolUseBlock)],
      };
    case "tool":
      return {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: message.toolCallId, content: message.content },
        ],
      };
  }
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
