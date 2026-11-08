import { errorForResponse, unexpectedResponse } from "./errors.ts";
import { fromOpenAiResponse, openAiResponseSchema } from "./from-response.ts";
import type {
  ChatRequest,
  ChatResponse,
  IntegrationHttpClient,
  LlmCapabilities,
  LlmProvider,
  ProviderConfig,
} from "./kit.ts";
import { type OpenAiRequest, toOpenAiRequest } from "./to-request.ts";

export const chatCompletionsUrl = "https://api.openai.com/v1/chat/completions";

/**
 * Only what the mapping handles. JSON mode is `response_format:
 * json_object`. Images aren't in `ChatMessage` yet, and streaming comes
 * with `stream`.
 */
export const openAiCapabilities: LlmCapabilities = {
  tools: true,
  jsonOutput: true,
  vision: false,
  streaming: false,
};

/**
 * The provider for one workspace. `config.baseUrl` and `config.secret` are
 * ignored: Halonic has already mapped them onto the permission sheet, and
 * the kit places the key named there.
 */
export function createOpenAiProvider(
  http: IntegrationHttpClient,
  config: ProviderConfig,
): LlmProvider {
  return {
    id: config.id,
    type: "openai",
    capabilities: openAiCapabilities,
    chat: (request) => chat(http, request),
  };
}

/** One request per call, never retried: a model call costs money, so the workflow decides. */
async function chat(http: IntegrationHttpClient, request: ChatRequest): Promise<ChatResponse> {
  const body = await postChatCompletion(http, toOpenAiRequest(request), request.signal);
  const parsed = openAiResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw unexpectedResponse();
  }
  return fromOpenAiResponse(parsed.data);
}

/**
 * Sends one Chat Completions request and returns the JSON body of a
 * successful answer. The kit's own errors (refused host or secret, timeout,
 * abort) pass through unchanged. Streaming will send the same body with
 * `stream: true` and read the answer as events instead.
 */
async function postChatCompletion(
  http: IntegrationHttpClient,
  body: OpenAiRequest,
  signal: ChatRequest["signal"],
): Promise<unknown> {
  const response = await http.fetch(chatCompletionsUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    auth: { secret: "openai-key", as: "bearer" },
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
