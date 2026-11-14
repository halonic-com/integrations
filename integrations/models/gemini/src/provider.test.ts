import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  LlmProvider,
  ProviderConfig,
} from "@halonicjs/adapters/integration-kit";
import { fakeResponse, type ReplayHttpClient, replay } from "@halonicjs/tooling-record/replay";
import { readSheetPolicy } from "@halonicjs/tooling-record/sheet-policy";
import { describe, expect, it } from "vitest";
import answerJson from "../recordings/answer-json.json" with { type: "json" };
import answerText from "../recordings/answer-text.json" with { type: "json" };
import keyRefused from "../recordings/key-refused.json" with { type: "json" };
import rateLimited from "../recordings/rate-limited.json" with { type: "json" };
import streamText from "../recordings/stream-text.json" with { type: "json" };
import streamUnavailable from "../recordings/stream-unavailable.json" with { type: "json" };
import toolCall from "../recordings/tool-call.json" with { type: "json" };
import { GeminiError } from "./errors.ts";
import { gemini } from "./index.ts";
import { createGeminiProvider, generateContentUrl, streamGenerateContentUrl } from "./provider.ts";
import { hostFor, kitHttp } from "./test/host.ts";

/**
 * The `recording` section of integration.yaml. The replay scrubs what is
 * sent with it, the way the recorder did, before it compares it with the
 * recording.
 */
const policy = readSheetPolicy(new URL("../integration.yaml", import.meta.url));

/** `secret` and `baseUrl` are set to show they are ignored: the sheet decides both. */
const config: ProviderConfig = {
  id: "gemini",
  type: "gemini",
  secret: "some-other-secret",
  baseUrl: "https://gateway.example.com/v1",
  local: false,
  options: {},
};

const question: ChatRequest = {
  model: "gemini-2.5-flash",
  messages: [{ role: "user", content: "Say hello." }],
  params: { maxTokens: 1024 },
};

/** The question in the answer-text recording, with a system prompt. */
const briefQuestion: ChatRequest = {
  ...question,
  messages: [{ role: "system", content: "Be brief." }, ...question.messages],
};

const weatherTool = {
  name: "weather_forecast",
  description: "Forecast for a city.",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

function provider(http: ReplayHttpClient) {
  return createGeminiProvider(kitHttp(http), config);
}

async function readStream(llm: LlmProvider, request: ChatRequest): Promise<ChatStreamEvent[]> {
  if (llm.stream === undefined) {
    throw new Error("The provider doesn't stream.");
  }
  const read: ChatStreamEvent[] = [];
  for await (const piece of llm.stream(request)) {
    read.push(piece);
  }
  return read;
}

/** The assistant message Halonic stores for an answer, `replay` included. */
function assistantTurn(response: ChatResponse): ChatMessage {
  return {
    role: "assistant",
    content: response.content,
    toolCalls: response.toolCalls,
    ...(response.replay !== undefined ? { replay: response.replay } : {}),
  };
}

describe("chat", () => {
  it("puts the key in a header, not the URL, and parses the text and usage", async () => {
    const recording = replay(answerText, { policy });
    const response = await provider(recording.http).chat(briefQuestion);
    recording.assertAllUsed();
    expect(recording.sent[0]?.init.auth).toEqual({
      secret: "gemini-key",
      as: "header",
      header: "x-goog-api-key",
    });
    expect(recording.sent[0]?.init.headers).toEqual({ "content-type": "application/json" });
    expect(recording.sent[0]?.url).not.toContain("key=");
    expect(response).toEqual({
      content: "<scrubbed:content>",
      toolCalls: [],
      replay: { type: "gemini", data: [{ text: "<scrubbed:content>" }] },
      usage: { inputTokens: 8, outputTokens: 28 },
      finishReason: "stop",
    });
  });

  it("returns a tool call with its signature, and sends the turn back unchanged", async () => {
    const recording = replay(toolCall, { policy });
    const chat = provider(recording.http);
    const request: ChatRequest = {
      model: "gemini-3-flash-preview",
      messages: [{ role: "user", content: "What's the weather in Lisbon tomorrow?" }],
      tools: [weatherTool],
      params: { maxTokens: 1024 },
    };

    const call = await chat.chat(request);
    expect(call.finishReason).toBe("tool_calls");
    expect(call.toolCalls).toEqual([
      {
        id: "fakecall01",
        name: "weather_forecast",
        arguments: { city: "<scrubbed:content>" },
        signature: "scrubbed-secret-1",
      },
    ]);
    expect(call.usage).toEqual({ inputTokens: 52, outputTokens: 82 });

    const answer = await chat.chat({
      ...request,
      messages: [
        ...request.messages,
        assistantTurn(call),
        { role: "tool", toolCallId: "fakecall01", name: "weather_forecast", content: "Sunny" },
      ],
    });
    recording.assertAllUsed();
    const sentBack = recording.sent[1]?.body as { contents: unknown[] };
    // Exact, so an extra or changed field in the replayed turn fails the test.
    expect(sentBack.contents[1]).toEqual({ role: "model", parts: call.replay?.data });
    expect(sentBack).toMatchObject({
      contents: [
        { role: "user" },
        { role: "model" },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: "fakecall01",
                name: "weather_forecast",
                response: { output: "Sunny" },
              },
            },
          ],
        },
      ],
    });
    expect(answer).toMatchObject({ content: "<scrubbed:content>", finishReason: "stop" });
  });

  it("asks for a JSON answer with the response type", async () => {
    const recording = replay(answerJson, { policy });
    const response = await provider(recording.http).chat({ ...question, responseFormat: "json" });
    recording.assertAllUsed();
    expect(recording.sent[0]?.body).toMatchObject({
      generationConfig: { responseMimeType: "application/json" },
    });
    expect(JSON.parse(response.content)).toEqual({ "field-1": "<scrubbed:content>" });
  });

  it("takes the model by Google's own name too", async () => {
    const recording = replay(answerText, { policy });
    await provider(recording.http).chat({ ...briefQuestion, model: "models/gemini-2.5-flash" });
    recording.assertAllUsed();
  });

  it("passes the signal on", async () => {
    const recording = replay(answerText, { policy });
    const { signal } = new AbortController();
    await provider(recording.http).chat({ ...briefQuestion, signal });
    expect(recording.sent[0]?.init.signal).toBe(signal);
  });
});

describe("generateContentUrl", () => {
  it("never lets a model name change the path or the host", () => {
    expect(generateContentUrl("../../evil.example.com/x?key=1")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/..%2F..%2Fevil.example.com%2Fx%3Fkey%3D1:generateContent",
    );
  });
});

describe("chat errors", () => {
  it("reports a refused key without Google's own text", async () => {
    const recording = replay(keyRefused, { policy });
    const error = await provider(recording.http)
      .chat(question)
      .catch((caught) => caught);
    recording.assertAllUsed();
    expect(error).toBeInstanceOf(GeminiError);
    expect(error).toMatchObject({ code: "not-signed-in" });
    expect(error.message).toBe(
      "Google refused the key. Check the Gemini key in Settings (API_KEY_INVALID).",
    );
  });

  it("reports a used-up quota as rate-limited", async () => {
    const recording = replay(rateLimited, { policy });
    const error = await provider(recording.http)
      .chat(question)
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: "rate-limited", name: "GeminiError" });
    expect(error.message).toContain("(RESOURCE_EXHAUSTED)");
  });

  it("refuses a successful answer that isn't JSON, without quoting it", async () => {
    const http = fakeResponse(200, async () => {
      throw new SyntaxError("Unexpected token 'h', \"hello\" is not valid JSON");
    });
    const error = await provider(http)
      .chat(question)
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: "unexpected-response" });
    expect(error.message).toBe("Gemini answered in an unexpected way.");
    expect(error.cause).toBeUndefined();
  });

  it("refuses a body the schema refuses, without quoting it", async () => {
    const http = fakeResponse(200, async () => ({ candidates: "my private text" }));
    const error = await provider(http)
      .chat(question)
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: "unexpected-response" });
    expect(error.message).not.toContain("private");
  });

  it("lets the kit's own errors through unchanged", async () => {
    const refused = new Error("secret-not-configured");
    const http: ReplayHttpClient = {
      fetch: async () => {
        throw refused;
      },
    };
    await expect(provider(http).chat(question)).rejects.toBe(refused);
  });
});

describe("stream", () => {
  it("sends the chat request to streamGenerateContent and yields the text, then done", async () => {
    const recording = replay(streamText, { policy });
    const read = await readStream(provider(recording.http), briefQuestion);
    recording.assertAllUsed();
    expect(recording.sent[0]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
    );
    expect(recording.sent[0]?.init.auth).toEqual({
      secret: "gemini-key",
      as: "header",
      header: "x-goog-api-key",
    });
    const texts = read.filter((piece) => piece.type === "text").map((piece) => piece.delta);
    expect(texts).toHaveLength(3);
    expect(read.at(-1)).toEqual({
      type: "done",
      response: {
        content: texts.join(""),
        toolCalls: [],
        replay: { type: "gemini", data: [{ text: texts.join("") }] },
        usage: { inputTokens: 8, outputTokens: 28 },
        finishReason: "stop",
      },
    });
  });

  it("sends the same body as chat", async () => {
    const chatRecording = replay(answerText, { policy });
    await provider(chatRecording.http).chat(briefQuestion);
    const streamRecording = replay(streamText, { policy });
    await readStream(provider(streamRecording.http), briefQuestion);
    expect(streamRecording.sent[0]?.body).toEqual(chatRecording.sent[0]?.body);
  });

  it("passes the signal on", async () => {
    const recording = replay(streamText, { policy });
    const { signal } = new AbortController();
    await readStream(provider(recording.http), { ...briefQuestion, signal });
    expect(recording.sent[0]?.init.signal).toBe(signal);
  });

  it("reports an error chunk mid-answer by Google's status", async () => {
    const recording = replay(streamUnavailable, { policy });
    const read: ChatStreamEvent[] = [];
    const error = await (async () => {
      for await (const piece of provider(recording.http).stream?.(question) ?? []) {
        read.push(piece);
      }
    })().catch((caught) => caught);
    expect(read.map((piece) => piece.type)).toEqual(["text", "text"]);
    expect(error).toBeInstanceOf(GeminiError);
    expect(error).toMatchObject({ code: "unavailable" });
    expect(error.message).toBe(
      "Gemini is having trouble right now. Try again later (UNAVAILABLE).",
    );
  });

  it("reports a refused key before any event, like chat", async () => {
    const http = fakeResponse(400, async () => ({
      error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
        details: [{ reason: "API_KEY_INVALID" }],
      },
    }));
    const error = await readStream(provider(http), question).catch((caught) => caught);
    expect(error).toMatchObject({ code: "not-signed-in", name: "GeminiError" });
  });

  it("refuses a successful answer that isn't an event stream", async () => {
    const http = fakeResponse(200, async () => ({ candidates: [] }));
    const error = await readStream(provider(http), question).catch((caught) => caught);
    expect(error).toMatchObject({ code: "unexpected-response" });
  });
});

describe("streamGenerateContentUrl", () => {
  it("encodes the model like generateContentUrl and asks for server-sent events", () => {
    expect(streamGenerateContentUrl("models/../x?key=1")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/..%2Fx%3Fkey%3D1:streamGenerateContent?alt=sse",
    );
  });
});

describe("the integration", () => {
  it("offers stream along with chat", () => {
    const connection = gemini.connect(hostFor(replay(answerText).http));
    expect(connection.createLlmProvider?.(config).stream).toBeTypeOf("function");
  });

  it("reports only the capabilities the mapping handles", () => {
    const connection = gemini.connect(hostFor(replay(answerText).http));
    expect(connection.createLlmProvider?.(config)).toMatchObject({
      id: "gemini",
      type: "gemini",
      capabilities: { tools: true, jsonOutput: true, vision: false, streaming: true },
    });
  });
});
