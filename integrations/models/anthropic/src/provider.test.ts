import { describe, expect, it } from "vitest";
import answerText from "../recordings/answer-text.json" with { type: "json" };
import keyRefused from "../recordings/key-refused.json" with { type: "json" };
import overloaded from "../recordings/overloaded.json" with { type: "json" };
import toolCall from "../recordings/tool-call.json" with { type: "json" };
import { AnthropicError } from "./errors.ts";
import { anthropic } from "./index.ts";
import type { ChatRequest, IntegrationHttpClient, ProviderConfig } from "./kit.ts";
import { createAnthropicProvider } from "./provider.ts";
import { fakeResponse, replay } from "./test/replay.ts";

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

function provider(http: IntegrationHttpClient) {
  return createAnthropicProvider(http, config);
}

describe("chat", () => {
  it("names the key for the kit and parses the text and usage", async () => {
    const recording = replay(answerText);
    const response = await provider(recording.http).chat({
      ...question,
      messages: [{ role: "system", content: "Be brief." }, ...question.messages],
    });
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
    const recording = replay(toolCall);
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
        id: "toolu_01FAKE00000000000000001",
        name: "weather_forecast",
        arguments: { city: "<scrubbed:content>" },
      },
    ]);
    expect(response.usage).toEqual({ inputTokens: 402, outputTokens: 57 });
  });

  it("passes the signal on", async () => {
    const recording = replay(answerText);
    const signal = { aborted: false };
    await provider(recording.http).chat({ ...question, signal });
    expect(recording.sent[0]?.init.signal).toBe(signal);
  });
});

describe("chat errors", () => {
  it("reports a refused key without Anthropic's own text", async () => {
    const recording = replay(keyRefused);
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
    const recording = replay(overloaded);
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
    const http: IntegrationHttpClient = {
      fetch: async () => {
        throw refused;
      },
    };
    await expect(provider(http).chat(question)).rejects.toBe(refused);
  });
});

describe("the integration", () => {
  it("reports only the capabilities the mapping handles", () => {
    const connection = anthropic.connect({ http: replay(answerText).http });
    expect(connection.createLlmProvider?.(config)).toMatchObject({
      id: "claude",
      type: "anthropic",
      capabilities: { tools: true, jsonOutput: false, vision: false, streaming: false },
    });
  });

  it("has no tools", async () => {
    const connection = anthropic.connect({ http: replay(answerText).http });
    expect(anthropic.tools).toEqual([]);
    await expect(connection.callTool("anything", {})).rejects.toMatchObject({ code: "not-found" });
  });
});
