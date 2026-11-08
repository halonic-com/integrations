/**
 * The interface types this integration is built against, kept here until
 * `@halonicjs/integration-kit` publishes them.
 *
 * Copied from `packages/core/ports/src` in halonic-com/halonic: `chat.ts`
 * and `llm-provider.ts` on `liam/HAL-112-02-ports` (97fbe6c), and
 * `integration.ts` on `liam/HAL-135-01-port` (c27f6f0). `ProviderReplay` is
 * from halonic-com/halonic#42, which adds it to the port. Only the parts
 * this integration uses are here. The same copy as model-anthropic's.
 *
 * To swap: delete this file and import the same names from
 * `@halonicjs/integration-kit`. Two names change: `HttpResponse` becomes the
 * Web `Response`, and `IntegrationRequestInit` extends the Web
 * `RequestInit`. They are small here because the integration preset has no
 * DOM types, and the kit will bring its own.
 */

/** Tokens one model call used. From `@halonicjs/events`. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** A tool call the model asked for. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Opaque data a provider needs back with this call in later turns (Gemini's thought signature). */
  signature?: string;
}

/** Provider-owned data that must go back unchanged with this assistant turn. Only the provider of `type` reads it. JSON-safe, because run history is stored. */
export interface ProviderReplay {
  type: string;
  data: unknown;
}

/** One message of a conversation with a model. */
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; replay?: ProviderReplay }
  | { role: "tool"; content: string; toolCallId: string; name: string };

/** A tool the model may call. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>;
}

/** Sampling settings for one model call. Providers ignore what they don't support. */
export interface ChatParams {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  reasoningEffort?: "low" | "medium" | "high";
  extra?: Record<string, unknown>;
}

/** One model call. */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  params?: ChatParams;
  responseFormat?: "text" | "json";
  /** Who is asking; used by mocks, logging and routing. Never sent to vendors. */
  meta?: { agentId?: string; runId?: string };
  signal?: AbortSignal;
}

/** The model's answer to one {@link ChatRequest}. */
export interface ChatResponse {
  content: string;
  /** The model's own summary of its reasoning, where the provider gives one. */
  reasoning?: string;
  toolCalls: ToolCall[];
  /** Goes back unchanged on the assistant message for this answer. */
  replay?: ProviderReplay;
  usage: Usage;
  finishReason: "stop" | "tool_calls" | "length" | "error" | "other";
}

/** What a provider's models can do. */
export interface LlmCapabilities {
  tools: boolean;
  jsonOutput: boolean;
  vision: boolean;
  streaming: boolean;
}

/** A model provider as one workspace configures it. */
export interface LlmProvider {
  readonly id: string;
  readonly type: string;
  readonly capabilities: LlmCapabilities;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

/** A provider as the workspace's YAML configures it. */
export interface ProviderConfig {
  id: string;
  type: string;
  baseUrl?: string;
  /** The **name** of the secret that holds the API key, never the key itself. */
  secret?: string;
  local: boolean;
  options: Record<string, unknown>;
}

/** The Web `AbortSignal`, as far as this integration uses it: it only passes it on. */
export interface AbortSignal {
  readonly aborted: boolean;
}

/** Where the kit puts a secret in a request. The integration names it and never sees its value. */
export type SecretPlacement =
  | { secret: string; as: "bearer" }
  | { secret: string; as: "header"; header: string; prefix?: string }
  | { secret: string; as: "form"; field: string };

/** The parts of the Web `RequestInit` this integration sends, plus `auth`. */
export interface IntegrationRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal | null;
  auth?: SecretPlacement | readonly SecretPlacement[];
}

/** The parts of the Web `Response` this integration reads. */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** The only way an integration reaches the network: `host.http`. */
export interface IntegrationHttpClient {
  fetch(url: string, init?: IntegrationRequestInit): Promise<HttpResponse>;
}

/** What an integration is given. Tokens and settings aren't used by this integration. */
export interface IntegrationHost {
  readonly http: IntegrationHttpClient;
}

/** One integration connected through its host. */
export interface IntegrationConnection {
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
  createLlmProvider?(config: ProviderConfig): LlmProvider;
  close(): Promise<void>;
}

/** An integration as its package exports it. */
export interface Integration {
  readonly name: string;
  readonly version: string;
  /** A model provider offers no tools, so the tool type isn't copied. */
  readonly tools: readonly never[];
  connect(host: IntegrationHost): IntegrationConnection;
}
