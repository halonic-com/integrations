import { errorForResponse, unexpectedResponse } from "./errors.ts";
import { anthropicResponseSchema, fromAnthropicResponse } from "./from-response.ts";
import type {
  ChatRequest,
  ChatResponse,
  IntegrationHttpClient,
  LlmCapabilities,
  LlmProvider,
  ProviderConfig,
} from "./kit.ts";
import { type AnthropicRequest, toAnthropicRequest } from "./to-request.ts";

export const messagesUrl = "https://api.anthropic.com/v1/messages";
/** The API version this integration's mapping is written for. */
export const apiVersion = "2023-06-01";

/**
 * Only what the mapping handles. Images aren't in `ChatMessage` yet, a JSON
 * answer is only asked for in words (see `to-request.ts`), and streaming
 * comes with `stream`.
 */
export const anthropicCapabilities: LlmCapabilities = {
  tools: true,
  jsonOutput: false,
  vision: false,
  streaming: false,
};

/**
 * The provider for one workspace. `config.baseUrl` and `config.secret` are
 * ignored: Halonic has already mapped them onto the permission sheet, and
 * the kit places the key named there.
 */
export function createAnthropicProvider(
  http: IntegrationHttpClient,
  config: ProviderConfig,
): LlmProvider {
  return {
    id: config.id,
    type: "anthropic",
    capabilities: anthropicCapabilities,
    chat: (request) => chat(http, request),
  };
}

/** One request per call, never retried: a model call costs money, so the workflow decides. */
async function chat(http: IntegrationHttpClient, request: ChatRequest): Promise<ChatResponse> {
  const body = await postMessages(http, toAnthropicRequest(request), request.signal);
  const parsed = anthropicResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw unexpectedResponse();
  }
  return fromAnthropicResponse(parsed.data);
}

/**
 * Sends one Messages request and returns the JSON body of a successful
 * answer. The kit's own errors (refused host or secret, timeout, abort)
 * pass through unchanged. Streaming will send the same body with
 * `stream: true` and read the answer as events instead.
 */
async function postMessages(
  http: IntegrationHttpClient,
  body: AnthropicRequest,
  signal: ChatRequest["signal"],
): Promise<unknown> {
  const response = await http.fetch(messagesUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-version": apiVersion },
    body: JSON.stringify(body),
    auth: { secret: "anthropic-key", as: "header", header: "x-api-key" },
    signal: signal ?? null,
  });
  if (!response.ok) {
    throw await errorForResponse(response);
  }
  try {
    return await response.json();
  } catch {
    throw unexpectedResponse();
  }
}
