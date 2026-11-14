import type {
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  IntegrationHttpClient,
  LlmCapabilities,
  LlmProvider,
  ProviderConfig,
} from "@halonicjs/adapters/integration-kit";
import { EventStream } from "@halonicjs/integration-shared";
import { errorForResponse, unexpectedResponse } from "./errors.ts";
import { fromOpenAiResponse, openAiResponseSchema } from "./from-response.ts";
import { fromOpenAiStream } from "./from-stream.ts";
import { type OpenAiRequest, toOpenAiRequest } from "./to-request.ts";

export const chatCompletionsUrl = "https://api.openai.com/v1/chat/completions";

/**
 * Only what the mapping handles. JSON mode is `response_format:
 * json_object`. Images aren't in `ChatMessage` yet.
 */
export const openAiCapabilities: LlmCapabilities = {
  tools: true,
  jsonOutput: true,
  vision: false,
  streaming: true,
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
    stream: (request) => stream(http, request),
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
 * The same request as `chat`, with `stream: true`, read as events as the
 * model writes. Without `include_usage` a streamed answer has no token
 * counts, and spend needs them. Also one request, never retried. Aborting
 * the signal ends the stream with the kit's error, and leaving the loop
 * early closes the connection.
 */
async function* stream(
  http: IntegrationHttpClient,
  request: ChatRequest,
): AsyncGenerator<ChatStreamEvent> {
  const body: StreamedOpenAiRequest = {
    ...toOpenAiRequest(request),
    stream: true,
    stream_options: { include_usage: true },
  };
  const response = await sendChatCompletion(http, body, request.signal);
  if (response.body === null || mediaType(response) !== "text/event-stream") {
    throw unexpectedResponse();
  }
  yield* fromOpenAiStream(new EventStream(response.body));
}

/** The request `stream` sends: `chat`'s, with the switches for streaming. */
interface StreamedOpenAiRequest extends OpenAiRequest {
  stream: true;
  stream_options: { include_usage: true };
}

/** Sends one Chat Completions request and returns the JSON body of a successful answer. */
async function postChatCompletion(
  http: IntegrationHttpClient,
  body: OpenAiRequest,
  signal: ChatRequest["signal"],
): Promise<unknown> {
  const response = await sendChatCompletion(http, body, signal);
  try {
    return await response.json();
  } catch {
    throw unexpectedResponse();
  }
}

/**
 * Sends one Chat Completions request and returns a successful response,
 * before its body is read. The kit's own errors (refused host or secret,
 * timeout, abort) pass through unchanged.
 */
async function sendChatCompletion(
  http: IntegrationHttpClient,
  body: OpenAiRequest | StreamedOpenAiRequest,
  signal: ChatRequest["signal"],
): Promise<Response> {
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
  return response;
}

/** The media type of the response, without parameters such as `charset`. */
function mediaType(response: Response): string {
  return (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}
