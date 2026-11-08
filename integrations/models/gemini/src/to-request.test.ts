import { describe, expect, it } from "vitest";
import { generatedCallId } from "./call-ids.ts";
import type { ChatMessage, ChatRequest } from "./kit.ts";
import { toGeminiContents, toGeminiRequest } from "./to-request.ts";

const question: ChatRequest = {
  model: "gemini-test",
  messages: [{ role: "user", content: "hi" }],
};

describe("toGeminiContents", () => {
  it("sends the user as `user` and the assistant as `model`", () => {
    expect(
      toGeminiContents([
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ]),
    ).toEqual([
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "hello" }] },
    ]);
  });

  it("rebuilds a turn without a replay: text first, then calls with their signature", () => {
    const contents = toGeminiContents([
      {
        role: "assistant",
        content: "Looking it up.",
        toolCalls: [
          { id: "abc123", name: "search", arguments: { q: "x" }, signature: "sig-fake-1" },
          { id: "def456", name: "search", arguments: { q: "y" } },
        ],
      },
    ]);
    expect(contents).toEqual([
      {
        role: "model",
        parts: [
          { text: "Looking it up." },
          {
            functionCall: { id: "abc123", name: "search", args: { q: "x" } },
            thoughtSignature: "sig-fake-1",
          },
          {
            functionCall: { id: "def456", name: "search", args: { q: "y" } },
            thoughtSignature: "skip_thought_signature_validator",
          },
        ],
      },
    ]);
  });

  it("rebuilds another provider's turn with the placeholder signature and without its ids", () => {
    const contents = toGeminiContents([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "toolu_fake1", name: "now", arguments: {} }],
        replay: { type: "anthropic", data: [{ type: "tool_use" }] },
      },
      { role: "tool", toolCallId: "toolu_fake1", name: "now", content: "noon" },
    ]);
    expect(contents).toEqual([
      {
        role: "model",
        parts: [
          {
            functionCall: { name: "now", args: {} },
            thoughtSignature: "skip_thought_signature_validator",
          },
        ],
      },
      {
        role: "user",
        parts: [{ functionResponse: { name: "now", response: { output: "noon" } } }],
      },
    ]);
  });

  it("sends no empty text part", () => {
    const contents = toGeminiContents([
      { role: "assistant", content: "", toolCalls: [{ id: "abc123", name: "now", arguments: {} }] },
    ]);
    expect(contents[0]?.parts).toEqual([
      {
        functionCall: { id: "abc123", name: "now", args: {} },
        thoughtSignature: "skip_thought_signature_validator",
      },
    ]);
  });

  it("sends a Gemini replay back exactly as it came, not the rebuilt turn", () => {
    const parts = [
      { text: "Thinking about it.", thought: true, thoughtSignature: "sig-fake-1" },
      { functionCall: { name: "search", args: { q: "x" } }, thoughtSignature: "sig-fake-2" },
      { someLaterPart: { kept: true } },
    ];
    const contents = toGeminiContents([
      {
        role: "assistant",
        content: "rebuilt text",
        toolCalls: [{ id: generatedCallId("resp1", 0), name: "search", arguments: { q: "x" } }],
        replay: { type: "gemini", data: parts },
      },
    ]);
    expect(contents).toEqual([{ role: "model", parts }]);
  });

  it.each([
    ["another provider's replay", { type: "anthropic", data: [{ type: "thinking" }] }],
    ["a replay that isn't a list of parts", { type: "gemini", data: { text: "x" } }],
  ])("rebuilds the turn from %s", (_kind, replay) => {
    const contents = toGeminiContents([{ role: "assistant", content: "hello", replay }]);
    expect(contents).toEqual([{ role: "model", parts: [{ text: "hello" }] }]);
  });

  it("never changes the stored replay when it joins turns", () => {
    const parts = [{ functionCall: { name: "search", args: {} } }];
    const messages: ChatMessage[] = [
      { role: "assistant", content: "", replay: { type: "gemini", data: parts } },
      { role: "assistant", content: "more" },
    ];
    const contents = toGeminiContents(messages);
    expect(contents[0]?.parts).toHaveLength(2);
    expect(parts).toHaveLength(1);
  });

  it("answers several tool calls in one user turn, with the call's id and name", () => {
    const contents = toGeminiContents([
      { role: "tool", toolCallId: "abc123", name: "search", content: "3 results" },
      { role: "tool", toolCallId: "def456", name: "search", content: "no results" },
    ]);
    expect(contents).toEqual([
      {
        role: "user",
        parts: [
          { functionResponse: { id: "abc123", name: "search", response: { output: "3 results" } } },
          {
            functionResponse: { id: "def456", name: "search", response: { output: "no results" } },
          },
        ],
      },
    ]);
  });

  it("never sends an id Gemini didn't issue", () => {
    const id = generatedCallId("resp1", 0);
    const contents = toGeminiContents([
      { role: "assistant", content: "", toolCalls: [{ id, name: "now", arguments: {} }] },
      { role: "tool", toolCallId: id, name: "now", content: "noon" },
    ]);
    expect(contents).toEqual([
      {
        role: "model",
        parts: [
          {
            functionCall: { name: "now", args: {} },
            thoughtSignature: "skip_thought_signature_validator",
          },
        ],
      },
      {
        role: "user",
        parts: [{ functionResponse: { name: "now", response: { output: "noon" } } }],
      },
    ]);
  });
});

describe("toGeminiRequest", () => {
  it("maps messages, the system prompt, tools and the sampling settings", () => {
    const parameters = { type: "object", additionalProperties: false };
    const request = toGeminiRequest({
      model: "gemini-test",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "system", content: "Use metric units." },
        { role: "user", content: "u" },
      ],
      tools: [{ name: "search", description: "d", parameters }],
      params: { temperature: 0, topP: 0.5, maxTokens: 100, stop: ["END"], reasoningEffort: "low" },
    });
    expect(request).toEqual({
      contents: [{ role: "user", parts: [{ text: "u" }] }],
      systemInstruction: { parts: [{ text: "Be brief.\n\nUse metric units." }] },
      tools: [
        {
          functionDeclarations: [
            { name: "search", description: "d", parametersJsonSchema: parameters },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 100,
        temperature: 0,
        topP: 0.5,
        stopSequences: ["END"],
        thinkingConfig: { thinkingLevel: "low", includeThoughts: true },
      },
    });
  });

  it("asks for JSON with the response type, without an added instruction", () => {
    const request = toGeminiRequest({ ...question, responseFormat: "json" });
    expect(request.generationConfig).toEqual({ responseMimeType: "application/json" });
    expect(request.systemInstruction).toBeUndefined();
  });

  it("sends only what is set, and never the model, meta or extra", () => {
    const request = toGeminiRequest({
      ...question,
      responseFormat: "text",
      tools: [],
      meta: { agentId: "agent-1", runId: "run-1" },
      params: { extra: { user: "x" }, stop: [] },
    });
    expect(Object.keys(request)).toEqual(["contents"]);
  });
});
