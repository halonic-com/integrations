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
import { fromGeminiResponse, geminiResponseSchema } from "./from-response.ts";
import { fromGeminiStream } from "./from-stream.ts";
import { type GeminiRequest, toGeminiRequest } from "./to-request.ts";

const modelsUrl = "https://generativelanguage.googleapis.com/v1beta/models";

/** Only what the mapping handles. JSON mode is `responseMimeType`. Images aren't in `ChatMessage` yet. */
export const geminiCapabilities: LlmCapabilities = {
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
export function createGeminiProvider(
  http: IntegrationHttpClient,
  config: ProviderConfig,
): LlmProvider {
  return {
    id: config.id,
    type: "gemini",
    capabilities: geminiCapabilities,
    chat: (request) => chat(http, request),
    stream: (request) => stream(http, request),
  };
}

/**
 * The model goes in the path. Google's own name for it starts with
 * `models/`, so that prefix is accepted too. Encoded, so a model name can
 * never change the path or the host.
 */
export function generateContentUrl(model: string): string {
  return `${modelUrl(model)}:generateContent`;
}

/** The same model path, for the streamed answer as server-sent events (`alt=sse`). */
export function streamGenerateContentUrl(model: string): string {
  return `${modelUrl(model)}:streamGenerateContent?alt=sse`;
}

function modelUrl(model: string): string {
  const name = model.startsWith("models/") ? model.slice("models/".length) : model;
  return `${modelsUrl}/${encodeURIComponent(name)}`;
}

/** One request per call, never retried: a model call costs money, so the workflow decides. */
async function chat(http: IntegrationHttpClient, request: ChatRequest): Promise<ChatResponse> {
  const body = await postGenerateContent(
    http,
    request.model,
    toGeminiRequest(request),
    request.signal,
  );
  const parsed = geminiResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw unexpectedResponse();
  }
  return fromGeminiResponse(parsed.data);
}

/**
 * The same request as `chat`, sent to `streamGenerateContent` and read as
 * events as the model writes. Also one request, never retried. Aborting
 * the signal ends the stream with the kit's error, and leaving the loop
 * early closes the connection.
 */
async function* stream(
  http: IntegrationHttpClient,
  request: ChatRequest,
): AsyncGenerator<ChatStreamEvent> {
  const url = streamGenerateContentUrl(request.model);
  const response = await send(http, url, toGeminiRequest(request), request.signal);
  if (response.body === null || mediaType(response) !== "text/event-stream") {
    throw unexpectedResponse();
  }
  yield* fromGeminiStream(new EventStream(response.body));
}

/** Sends one `generateContent` request and returns the JSON body of a successful answer. */
async function postGenerateContent(
  http: IntegrationHttpClient,
  model: string,
  body: GeminiRequest,
  signal: ChatRequest["signal"],
): Promise<unknown> {
  const response = await send(http, generateContentUrl(model), body, signal);
  try {
    return await response.json();
  } catch {
    throw unexpectedResponse();
  }
}

/**
 * Sends one request and returns a successful response, before its body is
 * read. The key goes in the `x-goog-api-key` header, never in the URL. The
 * kit's own errors (refused host or secret, timeout, abort) pass through
 * unchanged.
 */
async function send(
  http: IntegrationHttpClient,
  url: string,
  body: GeminiRequest,
  signal: ChatRequest["signal"],
): Promise<Response> {
  const response = await http.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    auth: { secret: "gemini-key", as: "header", header: "x-goog-api-key" },
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
