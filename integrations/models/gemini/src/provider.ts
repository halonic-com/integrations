import { errorForResponse, unexpectedResponse } from "./errors.ts";
import { fromGeminiResponse, geminiResponseSchema } from "./from-response.ts";
import type {
  ChatRequest,
  ChatResponse,
  IntegrationHttpClient,
  LlmCapabilities,
  LlmProvider,
  ProviderConfig,
} from "./kit.ts";
import { type GeminiRequest, toGeminiRequest } from "./to-request.ts";

const modelsUrl = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Only what the mapping handles. JSON mode is `responseMimeType`. Images
 * aren't in `ChatMessage` yet, and streaming comes with `stream`.
 */
export const geminiCapabilities: LlmCapabilities = {
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
export function createGeminiProvider(
  http: IntegrationHttpClient,
  config: ProviderConfig,
): LlmProvider {
  return {
    id: config.id,
    type: "gemini",
    capabilities: geminiCapabilities,
    chat: (request) => chat(http, request),
  };
}

/**
 * The model goes in the path. Google's own name for it starts with
 * `models/`, so that prefix is accepted too. Encoded, so a model name can
 * never change the path or the host.
 */
export function generateContentUrl(model: string): string {
  const name = model.startsWith("models/") ? model.slice("models/".length) : model;
  return `${modelsUrl}/${encodeURIComponent(name)}:generateContent`;
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
 * Sends one `generateContent` request and returns the JSON body of a
 * successful answer. The key goes in the `x-goog-api-key` header, never in
 * the URL. The kit's own errors (refused host or secret, timeout, abort)
 * pass through unchanged. Streaming will send the same body to
 * `streamGenerateContent` and read the answer as events instead.
 */
async function postGenerateContent(
  http: IntegrationHttpClient,
  model: string,
  body: GeminiRequest,
  signal: ChatRequest["signal"],
): Promise<unknown> {
  const response = await http.fetch(generateContentUrl(model), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    auth: { secret: "gemini-key", as: "header", header: "x-goog-api-key" },
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
