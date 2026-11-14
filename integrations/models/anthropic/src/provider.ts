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
import { anthropicResponseSchema, fromAnthropicResponse } from "./from-response.ts";
import { fromAnthropicStream } from "./from-stream.ts";
import { type AnthropicRequest, toAnthropicRequest } from "./to-request.ts";

export const messagesUrl = "https://api.anthropic.com/v1/messages";
/** The API version this integration's mapping is written for. */
export const apiVersion = "2023-06-01";

/**
 * Only what the mapping handles. Images aren't in `ChatMessage` yet, and a
 * JSON answer is only asked for in words (see `to-request.ts`).
 */
export const anthropicCapabilities: LlmCapabilities = {
  tools: true,
  jsonOutput: false,
  vision: false,
  streaming: true,
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
    stream: (request) => stream(http, request),
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
 * The same request as `chat`, with `stream: true`, read as events as the
 * model writes. Also one request, never retried. Aborting the signal ends
 * the stream with the kit's error, and leaving the loop early closes the
 * connection.
 */
async function* stream(
  http: IntegrationHttpClient,
  request: ChatRequest,
): AsyncGenerator<ChatStreamEvent> {
  const body = { ...toAnthropicRequest(request), stream: true as const };
  const response = await sendMessages(http, body, request.signal);
  if (response.body === null || mediaType(response) !== "text/event-stream") {
    throw unexpectedResponse();
  }
  yield* fromAnthropicStream(new EventStream(response.body));
}

/** Sends one Messages request and returns the JSON body of a successful answer. */
async function postMessages(
  http: IntegrationHttpClient,
  body: AnthropicRequest,
  signal: ChatRequest["signal"],
): Promise<unknown> {
  const response = await sendMessages(http, body, signal);
  try {
    return await response.json();
  } catch {
    throw unexpectedResponse();
  }
}

/**
 * Sends one Messages request and returns a successful response, before its
 * body is read. The kit's own errors (refused host or secret, timeout,
 * abort) pass through unchanged.
 */
async function sendMessages(
  http: IntegrationHttpClient,
  body: AnthropicRequest & { stream?: true },
  signal: ChatRequest["signal"],
): Promise<Response> {
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
  return response;
}

/** The media type of the response, without parameters such as `charset`. */
function mediaType(response: Response): string {
  return (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}
