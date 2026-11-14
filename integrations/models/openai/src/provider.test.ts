import type {
  ChatRequest,
  ChatStreamEvent,
  IntegrationHttpClient,
  LlmProvider,
  ProviderConfig,
} from "@halonicjs/adapters/integration-kit";
import { fakeResponse, replay, testHost } from "@halonicjs/tooling-record/replay";
import { readSheetPolicy } from "@halonicjs/tooling-record/sheet-policy";
import { describe, expect, it } from "vitest";
import answerJson from "../recordings/answer-json.json" with { type: "json" };
import answerText from "../recordings/answer-text.json" with { type: "json" };
import keyRefused from "../recordings/key-refused.json" with { type: "json" };
import quotaExceeded from "../recordings/quota-exceeded.json" with { type: "json" };
import streamServerError from "../recordings/stream-server-error.json" with { type: "json" };
import streamText from "../recordings/stream-text.json" with { type: "json" };
import toolCall from "../recordings/tool-call.json" with { type: "json" };
import { OpenAiError } from "./errors.ts";
import { openai } from "./index.ts";
import { createOpenAiProvider } from "./provider.ts";

/**
 * The `recording` section of integration.yaml. The replay scrubs what is
 * sent with it, the way the recorder did, before it compares it with the
 * recording.
 */
const policy = readSheetPolicy(new URL("../integration.yaml", import.meta.url));

/** `secret` and `baseUrl` are set to show they are ignored: the sheet decides both. */
const config: ProviderConfig = {
  id: "gpt",
  type: "openai",
  secret: "some-other-secret",
  baseUrl: "https://gateway.example.com/v1",
  local: false,
  options: {},
};

const question: ChatRequest = {
  model: "gpt-5-mini",
  messages: [{ role: "user", content: "Say hello." }],
  params: { maxTokens: 1024 },
};

/** The question in the answer-text recording, with a system prompt. */
const briefQuestion: ChatRequest = {
  ...question,
  messages: [{ role: "system", content: "Be brief." }, ...question.messages],
};

function provider(http: IntegrationHttpClient) {
  return createOpenAiProvider(http, config);
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

describe("chat", () => {
  it("names the key for the kit and parses the text and usage", async () => {
    const recording = replay(answerText, { policy });
    const response = await provider(recording.http).chat(briefQuestion);
    recording.assertAllUsed();
    expect(recording.sent[0]?.init.auth).toEqual({ secret: "openai-key", as: "bearer" });
    expect(recording.sent[0]?.init.headers).toEqual({ "content-type": "application/json" });
    expect(response).toEqual({
      content: "<scrubbed:content>",
      toolCalls: [],
      usage: { inputTokens: 24, outputTokens: 9 },
      finishReason: "stop",
    });
  });

  it("returns the tool calls the model asks for, with their arguments parsed", async () => {
    const recording = replay(toolCall, { policy });
    const response = await provider(recording.http).chat({
      ...question,
      tools: [
        {
          name: "weather_forecast",
          description: "Forecast for a city.",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      ],
    });
    recording.assertAllUsed();
    expect(response.finishReason).toBe("tool_calls");
    expect(response.toolCalls).toEqual([
      {
        id: "call_FAKE0000000000000000001",
        name: "weather_forecast",
        arguments: { city: "<scrubbed:content>" },
      },
    ]);
    expect(response.usage).toEqual({ inputTokens: 380, outputTokens: 18 });
  });

  it("asks for a JSON answer in JSON mode", async () => {
    const recording = replay(answerJson, { policy });
    await provider(recording.http).chat({ ...question, responseFormat: "json" });
    recording.assertAllUsed();
    // The recording has the instruction scrubbed, as the messages' content, so it is checked here.
    expect(recording.sent[0]?.body).toMatchObject({
      messages: [
        { role: "system", content: "Reply with a single JSON object and nothing else." },
        {},
      ],
      response_format: { type: "json_object" },
    });
  });

  it("passes the signal on", async () => {
    const recording = replay(answerText, { policy });
    const { signal } = new AbortController();
    await provider(recording.http).chat({ ...briefQuestion, signal });
    expect(recording.sent[0]?.init.signal).toBe(signal);
  });
});

describe("chat errors", () => {
  it("reports a refused key without OpenAI's own text", async () => {
    const recording = replay(keyRefused, { policy });
    const error = await provider(recording.http)
      .chat(question)
      .catch((caught) => caught);
    recording.assertAllUsed();
    expect(error).toBeInstanceOf(OpenAiError);
    expect(error).toMatchObject({ code: "not-signed-in" });
    expect(error.message).toBe(
      "OpenAI refused the key. Check the OpenAI key in Settings (invalid_api_key).",
    );
  });

  it("reports an account without credit as quota-exceeded", async () => {
    const recording = replay(quotaExceeded, { policy });
    const error = await provider(recording.http)
      .chat(question)
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: "quota-exceeded", name: "OpenAiError" });
  });

  it("refuses a successful answer that isn't JSON, without quoting it", async () => {
    const http = fakeResponse(200, "hello");
    const error = await provider(http)
      .chat(question)
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: "unexpected-response" });
    expect(error.message).toBe("OpenAI answered in an unexpected way.");
    expect(error.cause).toBeUndefined();
  });

  it("refuses a body the schema refuses, without quoting it", async () => {
    const http = fakeResponse(200, JSON.stringify({ choices: "my private text" }));
    const error = await provider(http)
      .chat(question)
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: "unexpected-response" });
    expect(error.message).not.toContain("private");
  });

  it("lets the kit's own errors through unchanged", async () => {
    const refused = new Error("secret-not-configured");
    const http: IntegrationHttpClient = {
      fetch: async () => {
        throw refused;
      },
    };
    await expect(provider(http).chat(question)).rejects.toBe(refused);
  });
});

describe("stream", () => {
  it("asks for the usage and yields the text, then done with the token counts", async () => {
    const recording = replay(streamText, { policy });
    const read = await readStream(provider(recording.http), briefQuestion);
    recording.assertAllUsed();
    expect(recording.sent[0]?.body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(recording.sent[0]?.init.auth).toEqual({ secret: "openai-key", as: "bearer" });
    const texts = read.filter((piece) => piece.type === "text").map((piece) => piece.delta);
    expect(texts).toHaveLength(3);
    expect(read.at(-1)).toEqual({
      type: "done",
      response: {
        content: texts.join(""),
        toolCalls: [],
        usage: { inputTokens: 24, outputTokens: 9 },
        finishReason: "stop",
      },
    });
  });

  it("sends the same body as chat apart from the streaming switches", async () => {
    const chatRecording = replay(answerText, { policy });
    await provider(chatRecording.http).chat(briefQuestion);
    const streamRecording = replay(streamText, { policy });
    await readStream(provider(streamRecording.http), briefQuestion);
    expect(streamRecording.sent[0]?.body).toEqual({
      ...(chatRecording.sent[0]?.body as object),
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("passes the signal on", async () => {
    const recording = replay(streamText, { policy });
    const { signal } = new AbortController();
    await readStream(provider(recording.http), { ...briefQuestion, signal });
    expect(recording.sent[0]?.init.signal).toBe(signal);
  });

  it("reports an error chunk mid-answer by its type", async () => {
    const recording = replay(streamServerError, { policy });
    const read: ChatStreamEvent[] = [];
    const error = await (async () => {
      for await (const piece of provider(recording.http).stream?.(question) ?? []) {
        read.push(piece);
      }
    })().catch((caught) => caught);
    expect(read.map((piece) => piece.type)).toEqual(["text"]);
    expect(error).toBeInstanceOf(OpenAiError);
    expect(error).toMatchObject({ code: "unavailable" });
    expect(error.message).toBe(
      "OpenAI is having trouble right now. Try again later (server_error).",
    );
  });

  it("reports a refused key before any event, like chat", async () => {
    const http = fakeResponse(
      401,
      JSON.stringify({
        error: { type: "invalid_request_error", code: "invalid_api_key", message: "Incorrect key" },
      }),
    );
    const error = await readStream(provider(http), question).catch((caught) => caught);
    expect(error).toMatchObject({ code: "not-signed-in", name: "OpenAiError" });
  });

  it("refuses a successful answer that isn't an event stream", async () => {
    const http = fakeResponse(200, JSON.stringify({ choices: [] }));
    const error = await readStream(provider(http), question).catch((caught) => caught);
    expect(error).toMatchObject({ code: "unexpected-response" });
  });
});

describe("the integration", () => {
  it("reports only the capabilities the mapping handles", () => {
    const connection = openai.connect(testHost(replay(answerText).http));
    expect(connection.createLlmProvider?.(config)).toMatchObject({
      id: "gpt",
      type: "openai",
      capabilities: { tools: true, jsonOutput: true, vision: false, streaming: true },
    });
  });

  it("has no tools", async () => {
    const connection = openai.connect(testHost(replay(answerText).http));
    expect(openai.tools).toEqual([]);
    await expect(connection.callTool("anything", {})).rejects.toMatchObject({ code: "not-found" });
  });
});
