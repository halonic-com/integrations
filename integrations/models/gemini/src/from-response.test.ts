import { describe, expect, it } from "vitest";
import { generatedCallId } from "./call-ids.ts";
import { fromGeminiResponse, type GeminiResponse, geminiResponseSchema } from "./from-response.ts";

const usageMetadata = { promptTokenCount: 10, candidatesTokenCount: 3 };

function answer(parts: unknown[], finishReason = "STOP"): GeminiResponse {
  return geminiResponseSchema.parse({
    candidates: [{ content: { role: "model", parts }, finishReason }],
    usageMetadata,
  });
}

describe("fromGeminiResponse", () => {
  it("maps text, usage and the parts to replay", () => {
    expect(fromGeminiResponse(answer([{ text: "hel" }, { text: "lo" }]))).toEqual({
      content: "hello",
      toolCalls: [],
      replay: { type: "gemini", data: [{ text: "hel" }, { text: "lo" }] },
      usage: { inputTokens: 10, outputTokens: 3 },
      finishReason: "stop",
    });
  });

  it("keeps the thought summary apart from the answer", () => {
    const response = fromGeminiResponse(
      answer([{ text: "Weighing it up.", thought: true }, { text: "Yes." }]),
    );
    expect(response.content).toBe("Yes.");
    expect(response.reasoning).toBe("Weighing it up.");
  });

  it("maps function calls with their id and signature, and says tool_calls", () => {
    const response = fromGeminiResponse(
      answer([
        {
          functionCall: { id: "abc123", name: "search", args: { q: "x" } },
          thoughtSignature: "sig-fake-1",
        },
        { functionCall: { id: "def456", name: "now" } },
      ]),
    );
    expect(response.toolCalls).toEqual([
      { id: "abc123", name: "search", arguments: { q: "x" }, signature: "sig-fake-1" },
      { id: "def456", name: "now", arguments: {} },
    ]);
    expect(response.finishReason).toBe("tool_calls");
  });

  it("makes up an id for a call that came without one", () => {
    const response = fromGeminiResponse(
      answer([
        { text: "Two lookups." },
        { functionCall: { name: "a", args: {} } },
        { functionCall: { name: "b", args: {} } },
      ]),
    );
    expect(response.toolCalls.map((call) => call.id)).toEqual([
      generatedCallId(0),
      generatedCallId(1),
    ]);
  });

  it("replays every part unchanged and in order, including ones it doesn't read", () => {
    const parts = [
      { text: "Thinking.", thought: true, thoughtSignature: "sig-fake-1" },
      { executableCode: { language: "PYTHON", code: "print(1)" } },
      {
        functionCall: { name: "search", args: { q: "x" }, laterField: 1 },
        thoughtSignature: "sig-fake-2",
      },
    ];
    expect(fromGeminiResponse(answer(parts)).replay).toEqual({ type: "gemini", data: parts });
  });

  it("refuses a function call it can't read, so no call silently disappears", () => {
    const body = { candidates: [{ content: { parts: [{ functionCall: { args: {} } }] } }] };
    expect(geminiResponseSchema.safeParse(body).success).toBe(false);
  });

  it("counts cached and tool prompt tokens as input, and thinking as output", () => {
    const body = geminiResponseSchema.parse({
      candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 100,
        cachedContentTokenCount: 40,
        toolUsePromptTokenCount: 5,
        candidatesTokenCount: 7,
        thoughtsTokenCount: 20,
      },
    });
    expect(fromGeminiResponse(body).usage).toEqual({ inputTokens: 105, outputTokens: 27 });
  });

  it("answers a blocked prompt with nothing, not a crash", () => {
    const body = geminiResponseSchema.parse({ promptFeedback: { blockReason: "SAFETY" } });
    expect(fromGeminiResponse(body)).toEqual({
      content: "",
      toolCalls: [],
      replay: { type: "gemini", data: [] },
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason: "other",
    });
  });

  it.each([
    ["STOP", "stop"],
    ["MAX_TOKENS", "length"],
    ["SAFETY", "other"],
    ["MALFORMED_FUNCTION_CALL", "other"],
    ["constructor", "other"],
  ] as const)("maps the finish reason %s to %s", (finishReason, expected) => {
    expect(fromGeminiResponse(answer([{ text: "x" }], finishReason)).finishReason).toBe(expected);
  });
});
