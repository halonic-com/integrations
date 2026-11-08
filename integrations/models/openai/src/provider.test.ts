import { describe, expect, it } from "vitest";
import answerJson from "../recordings/answer-json.json" with { type: "json" };
import answerText from "../recordings/answer-text.json" with { type: "json" };
import keyRefused from "../recordings/key-refused.json" with { type: "json" };
import quotaExceeded from "../recordings/quota-exceeded.json" with { type: "json" };
import toolCall from "../recordings/tool-call.json" with { type: "json" };
import { OpenAiError } from "./errors.ts";
import { openai } from "./index.ts";
import type { ChatRequest, IntegrationHttpClient, ProviderConfig } from "./kit.ts";
import { createOpenAiProvider } from "./provider.ts";
import { fakeResponse, replay } from "./test/replay.ts";

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

function provider(http: IntegrationHttpClient) {
  return createOpenAiProvider(http, config);
}

describe("chat", () => {
  it("names the key for the kit and parses the text and usage", async () => {
    const recording = replay(answerText);
    const response = await provider(recording.http).chat({
      ...question,
      messages: [{ role: "system", content: "Be brief." }, ...question.messages],
    });
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
        id: "call_FAKE0000000000000000001",
        name: "weather_forecast",
        arguments: { city: "<scrubbed:content>" },
      },
    ]);
    expect(response.usage).toEqual({ inputTokens: 380, outputTokens: 18 });
  });

  it("asks for a JSON answer in JSON mode", async () => {
    const recording = replay(answerJson);
    await provider(recording.http).chat({ ...question, responseFormat: "json" });
    recording.assertAllUsed();
    expect(recording.sent[0]?.body).toMatchObject({ response_format: { type: "json_object" } });
  });

  it("passes the signal on", async () => {
    const recording = replay(answerText);
    const signal = { aborted: false };
    await provider(recording.http).chat({ ...question, signal });
    expect(recording.sent[0]?.init.signal).toBe(signal);
  });
});

describe("chat errors", () => {
  it("reports a refused key without OpenAI's own text", async () => {
    const recording = replay(keyRefused);
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
    const recording = replay(quotaExceeded);
    const error = await provider(recording.http)
      .chat(question)
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: "quota-exceeded", name: "OpenAiError" });
  });

  it("refuses a successful answer that isn't JSON, without quoting it", async () => {
    const http = fakeResponse(200, async () => {
      throw new SyntaxError("Unexpected token 'h', \"hello\" is not valid JSON");
    });
    const error = await provider(http)
      .chat(question)
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: "unexpected-response" });
    expect(error.message).toBe("OpenAI answered in an unexpected way.");
    expect(error.cause).toBeUndefined();
  });

  it("refuses a body the schema refuses, without quoting it", async () => {
    const http = fakeResponse(200, async () => ({ choices: "my private text" }));
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
    const connection = openai.connect({ http: replay(answerText).http });
    expect(connection.createLlmProvider?.(config)).toMatchObject({
      id: "gpt",
      type: "openai",
      capabilities: { tools: true, jsonOutput: true, vision: false, streaming: false },
    });
  });

  it("has no tools", async () => {
    const connection = openai.connect({ http: replay(answerText).http });
    expect(openai.tools).toEqual([]);
    await expect(connection.callTool("anything", {})).rejects.toMatchObject({ code: "not-found" });
  });
});
