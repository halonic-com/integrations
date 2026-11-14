import type {
  ChatMessage,
  ChatRequest,
  ToolCall,
  ToolDefinition,
} from "@halonicjs/adapters/integration-kit";

/**
 * The Chat Completions request body, as far as we send it.
 * https://platform.openai.com/docs/api-reference/chat/create
 */
export interface OpenAiRequest {
  model: string;
  messages: OpenAiMessage[];
  tools?: OpenAiTool[];
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  reasoning_effort?: "low" | "medium" | "high";
  response_format?: { type: "json_object" };
}

export type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAiTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/**
 * JSON mode refuses a request whose messages don't mention JSON, so the
 * instruction is always sent with it.
 * https://platform.openai.com/docs/guides/structured-outputs#json-mode
 */
const jsonInstruction = "Reply with a single JSON object and nothing else.";

/**
 * Maps one `ChatRequest` to a Chat Completions body. `meta` is never sent,
 * and neither is `extra`, which isn't mapped. Without `maxTokens` OpenAI
 * uses the model's own limit, so none is sent.
 */
export function toOpenAiRequest(request: ChatRequest): OpenAiRequest {
  const params = request.params ?? {};
  const wantsJson = request.responseFormat === "json";
  return {
    model: request.model,
    messages: [
      ...(wantsJson ? [{ role: "system" as const, content: jsonInstruction }] : []),
      ...request.messages.map(toOpenAiMessage),
    ],
    ...(request.tools?.length ? { tools: request.tools.map(toOpenAiTool) } : {}),
    // `max_tokens` is deprecated, and reasoning models refuse it.
    ...(params.maxTokens !== undefined ? { max_completion_tokens: params.maxTokens } : {}),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.topP !== undefined ? { top_p: params.topP } : {}),
    ...(params.stop?.length ? { stop: params.stop } : {}),
    // Only reasoning models take it; others refuse the request, so it's the workflow's choice.
    ...(params.reasoningEffort !== undefined ? { reasoning_effort: params.reasoningEffort } : {}),
    ...(wantsJson ? { response_format: { type: "json_object" as const } } : {}),
  };
}

export function toOpenAiMessage(message: ChatMessage): OpenAiMessage {
  switch (message.role) {
    case "system":
    case "user":
      return { role: message.role, content: message.content };
    case "assistant":
      return toAssistantMessage(message.content, message.toolCalls ?? []);
    case "tool":
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
}

/** An assistant turn with only tool calls sends `content: null`, as OpenAI does itself. */
function toAssistantMessage(content: string, toolCalls: readonly ToolCall[]): OpenAiMessage {
  if (toolCalls.length === 0) {
    return { role: "assistant", content };
  }
  return {
    role: "assistant",
    content: content === "" ? null : content,
    tool_calls: toolCalls.map(toOpenAiToolCall),
  };
}

/** OpenAI sends and expects tool arguments as JSON text. */
function toOpenAiToolCall(call: ToolCall): OpenAiToolCall {
  return {
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  };
}

function toOpenAiTool(tool: ToolDefinition): OpenAiTool {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}
