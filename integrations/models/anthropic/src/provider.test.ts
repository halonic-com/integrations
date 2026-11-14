import type {
  ChatMessage,
  ChatRequest,
  ChatStreamEvent,
  LlmProvider,
  ProviderConfig,
  ToolDefinition,
} from "@halonicjs/adapters/integration-kit";
import { fakeResponse, type ReplayHttpClient, replay } from "@halonicjs/tooling-record/replay";
import { readSheetPolicy } from "@halonicjs/tooling-record/sheet-policy";
import { describe, expect, it } from "vitest";
import answerText from "../recordings/answer-text.json" with { type: "json" };
import effortAdaptive from "../recordings/effort-adaptive.json" with { type: "json" };
import keyRefused from "../recordings/key-refused.json" with { type: "json" };
import overloaded from "../recordings/overloaded.json" with { type: "json" };
import streamOverloaded from "../recordings/stream-overloaded.json" with { type: "json" };
import streamText from "../recordings/stream-text.json" with { type: "json" };
import toolCall from "../recordings/tool-call.json" with { type: "json" };
import toolLoopThinking from "../recordings/tool-loop-thinking.json" with { type: "json" };
import { AnthropicError } from "./errors.ts";
import { anthropic } from "./index.ts";
import { createAnthropicProvider } from "./provider.ts";
import { hostFor, kitHttp } from "./test/host.ts";

/**
 * The `recording` section of integration.yaml. The replay scrubs what is
 * sent with it, the way the recorder did, before it compares it with the
 * recording.
 */
const policy = readSheetPolicy(new URL("../integration.yaml", import.meta.url));

/** `secret` and `baseUrl` are set to show they are ignored: the sheet decides both. */
const config: ProviderConfig = {
  id: "claude",
  type: "anthropic",
  secret: "some-other-secret",
  baseUrl: "https://gateway.example.com",
  local: false,
  options: {},
};

const model = "claude-haiku-4-5-20251001";
const question: ChatRequest = {
  model,
  messages: [{ role: "user", content: "Say hello." }],
  params: { maxTokens: 1024 },
};

/** The question in the answer-text recording, with a system prompt. */
const briefQuestion: ChatRequest = {
  ...question,
  messages: [{ role: "system", content: "Be brief." }, ...question.messages],
};

const weatherForecast: ToolDefinition = {
  name: "weather_forecast",
  description: "Forecast for a city.",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
};

function provider(http: ReplayHttpClient) {
  return createAnthropicProvider(kitHttp(http), config);
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
    expect(recording.sent[0]?.init.auth).toEqual({
      secret: "anthropic-key",
      as: "header",
      header: "x-api-key",
    });
    expect(recording.sent[0]?.init.headers).toEqual({
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    });
    expect(response).toEqual({
      content: "<scrubbed:content>",
      toolCalls: [],
      replay: { type: "anthropic", data: [{ type: "text", text: "<scrubbed:content>" }] },
      usage: { inputTokens: 21, outputTokens: 9 },
      finishReason: "stop",
    });
  });

  it("returns the tool calls the model asks for", async () => {
    const recording = replay(toolCall, { policy });
    const response = await provider(recording.http).chat({ ...question, tools: [weatherForecast] });
    recording.assertAllUsed();
    expect(response.finishReason).toBe("tool_calls");
    expect(response.toolCalls).toEqual([
      {
        id: "toolu_01FAKE00000000000000001",
        name: "weather_forecast",
        arguments: { city: "<scrubbed:content>" },
      },
    ]);
    expect(response.usage).toEqual({ inputTokens: 402, outputTokens: 57 });
  });

  /** HAL-316, recorded live on a model that thinks adaptively. */
  it("sends a thinking turn back unchanged in a tool loop, and Anthropic accepts it", async () => {
    const recording = replay(toolLoopThinking, { policy });
    const llm = provider(recording.http);
    const request = {
      model: "claude-sonnet-5-5",
      tools: [weatherForecast],
      params: { maxTokens: 4096 },
    };
    const opening: ChatMessage[] = [
      { role: "system", content: "Use the tools you are given." },
      { role: "user", content: "Should I take an umbrella?" },
    ];

    const toolTurn = await llm.chat({ ...request, messages: opening });
    const toolCall = toolTurn.toolCalls[0];
    if (toolCall === undefined || toolTurn.replay === undefined) {
      throw new Error("The recording has no tool call to answer.");
    }
    expect(toolTurn.replay.data).toContainEqual(expect.objectContaining({ type: "thinking" }));

    const finalTurn = await llm.chat({
      ...request,
      messages: [
        ...opening,
        {
          role: "assistant",
          content: toolTurn.content,
          toolCalls: toolTurn.toolCalls,
          replay: toolTurn.replay,
        },
        { role: "tool", toolCallId: toolCall.id, name: toolCall.name, content: "Rain." },
      ],
    });
    recording.assertAllUsed();

    const followUp = JSON.parse(String(recording.sent[1]?.init.body));
    expect(followUp.messages[1].content).toEqual(toolTurn.replay.data);
    expect(finalTurn.finishReason).toBe("stop");
  });

  /** HAL-2570, recorded live on Sonnet 4.6, which doesn't think unless asked. */
  it("asks for effort and adaptive thinking, and Anthropic then refuses a temperature", async () => {
    const recording = replay(effortAdaptive, { policy });
    const llm = provider(recording.http);
    const request: ChatRequest = {
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: "Answer with the number only." },
        { role: "user", content: "How many three-digit numbers add up to 12?" },
      ],
      params: { maxTokens: 4096, reasoningEffort: "high" },
    };

    const answer = await llm.chat(request);
    expect(recording.sent[0]?.body).toMatchObject({
      output_config: { effort: "high" },
      thinking: { type: "adaptive" },
    });
    expect(answer.replay?.data).toContainEqual(expect.objectContaining({ type: "thinking" }));
    expect(answer.finishReason).toBe("stop");

    const refusal = await llm
      .chat({ ...request, params: { ...request.params, temperature: 0.5 } })
      .catch((caught) => caught);
    recording.assertAllUsed();
    expect(refusal).toBeInstanceOf(AnthropicError);
    expect(refusal).toMatchObject({ code: "bad-arguments" });
    expect(refusal.message).not.toContain("temperature");
  });

  it("passes the signal on", async () => {
    const recording = replay(answerText, { policy });
    const { signal } = new AbortController();
    await provider(recording.http).chat({ ...briefQuestion, signal });
    expect(recording.sent[0]?.init.signal).toBe(signal);
  });
});

describe("chat errors", () => {
  it("reports a refused key without Anthropic's own text", async () => {
    const recording = replay(keyRefused, { policy });
    const error = await provider(recording.http)
      .chat(question)
      .catch((caught) => caught);
    recording.assertAllUsed();
    expect(error).toBeInstanceOf(AnthropicError);
    expect(error).toMatchObject({ code: "not-signed-in" });
    expect(error.message).toBe(
      "Anthropic refused the key. Check the Anthropic key in Settings (authentication_error).",
    );
  });

  it("reports an overloaded API as unavailable", async () => {
    const recording = replay(overloaded, { policy });
    const error = await provider(recording.http)
      .chat(question)
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: "unavailable", name: "AnthropicError" });
  });

  it("refuses a successful answer that isn't JSON, without quoting it", async () => {
    const http = fakeResponse(200, async () => {
      throw new SyntaxError("Unexpected token 'h', \"hello\" is not valid JSON");
    });
    const error = await provider(http)
      .chat(question)
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: "unexpected-response" });
    expect(error.message).toBe("Anthropic answered in an unexpected way.");
    expect(error.cause).toBeUndefined();
  });

  it("refuses a body the schema refuses, without quoting it", async () => {
    const http = fakeResponse(200, async () => ({ content: "my private text" }));
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
  it("sends the chat request with stream: true and yields the text, then done", async () => {
    const recording = replay(streamText, { policy });
    const read = await readStream(provider(recording.http), briefQuestion);
    recording.assertAllUsed();
    expect(recording.sent[0]?.body).toMatchObject({ stream: true, model });
    expect(recording.sent[0]?.init.auth).toEqual({
      secret: "anthropic-key",
      as: "header",
      header: "x-api-key",
    });
    const texts = read.filter((piece) => piece.type === "text").map((piece) => piece.delta);
    expect(texts).toHaveLength(3);
    expect(read.at(-1)).toEqual({
      type: "done",
      response: {
        content: texts.join(""),
        toolCalls: [],
        replay: { type: "anthropic", data: [{ type: "text", text: texts.join("") }] },
        usage: { inputTokens: 21, outputTokens: 9 },
        finishReason: "stop",
      },
    });
  });

  it("sends the same body as chat apart from stream", async () => {
    const chatRecording = replay(answerText, { policy });
    await provider(chatRecording.http).chat(briefQuestion);
    const streamRecording = replay(streamText, { policy });
    await readStream(provider(streamRecording.http), briefQuestion);
    expect(streamRecording.sent[0]?.body).toEqual({
      ...(chatRecording.sent[0]?.body as object),
      stream: true,
    });
  });

  it("passes the signal on", async () => {
    const recording = replay(streamText, { policy });
    const { signal } = new AbortController();
    await readStream(provider(recording.http), { ...briefQuestion, signal });
    expect(recording.sent[0]?.init.signal).toBe(signal);
  });

  it("reports an error event mid-answer by its type", async () => {
    const recording = replay(streamOverloaded, { policy });
    const read: ChatStreamEvent[] = [];
    const error = await (async () => {
      for await (const piece of provider(recording.http).stream?.(question) ?? []) {
        read.push(piece);
      }
    })().catch((caught) => caught);
    expect(read.map((piece) => piece.type)).toEqual(["text", "text"]);
    expect(error).toBeInstanceOf(AnthropicError);
    expect(error).toMatchObject({ code: "unavailable" });
    expect(error.message).toBe(
      "Anthropic is having trouble right now. Try again later (overloaded_error).",
    );
  });

  it("reports a refused key before any event, like chat", async () => {
    const http = fakeResponse(401, async () => ({
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
    }));
    const error = await readStream(provider(http), question).catch((caught) => caught);
    expect(error).toMatchObject({ code: "not-signed-in", name: "AnthropicError" });
  });

  it("refuses a successful answer that isn't an event stream", async () => {
    const http = fakeResponse(200, async () => ({ content: [] }));
    const error = await readStream(provider(http), question).catch((caught) => caught);
    expect(error).toMatchObject({ code: "unexpected-response" });
  });
});

describe("the integration", () => {
  it("reports only the capabilities the mapping handles", () => {
    const connection = anthropic.connect(hostFor(replay(answerText).http));
    expect(connection.createLlmProvider?.(config)).toMatchObject({
      id: "claude",
      type: "anthropic",
      capabilities: { tools: true, jsonOutput: false, vision: false, streaming: true },
    });
  });

  it("offers stream along with chat", () => {
    const connection = anthropic.connect(hostFor(replay(answerText).http));
    expect(connection.createLlmProvider?.(config).stream).toBeTypeOf("function");
  });

  it("has no tools", async () => {
    const connection = anthropic.connect(hostFor(replay(answerText).http));
    expect(anthropic.tools).toEqual([]);
    await expect(connection.callTool("anything", {})).rejects.toMatchObject({ code: "not-found" });
  });
});
