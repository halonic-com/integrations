import { describe, expect, it } from "vitest";
import { fromOpenAiResponse, type OpenAiResponse, openAiResponseSchema } from "./from-response.ts";

const usage = { prompt_tokens: 10, completion_tokens: 3 };

function answer(
  message: Record<string, unknown>,
  finishReason: string | null = "stop",
): OpenAiResponse {
  return openAiResponseSchema.parse({
    choices: [{ message: { content: null, ...message }, finish_reason: finishReason }],
    usage,
  });
}

function toolCall(args: string) {
  return { id: "c1", type: "function", function: { name: "search", arguments: args } };
}

describe("fromOpenAiResponse", () => {
  it("maps text and usage", () => {
    expect(fromOpenAiResponse(answer({ content: "hello" }))).toEqual({
      content: "hello",
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 3 },
      finishReason: "stop",
    });
  });

  it("parses the arguments of tool calls", () => {
    const response = fromOpenAiResponse(
      answer({ tool_calls: [toolCall('{"q":"x"}')] }, "tool_calls"),
    );
    expect(response.content).toBe("");
    expect(response.toolCalls).toEqual([{ id: "c1", name: "search", arguments: { q: "x" } }]);
    expect(response.finishReason).toBe("tool_calls");
  });

  it("returns a refusal as the answer's text", () => {
    const response = fromOpenAiResponse(answer({ refusal: "I can't help with that." }));
    expect(response.content).toBe("I can't help with that.");
  });

  it.each([
    ["broken JSON", '{"q":'],
    ["a list", "[1, 2]"],
    ["a string", '"x"'],
  ])("refuses tool arguments that are %s, without quoting them", (_kind, args) => {
    const body = answer({ tool_calls: [toolCall(args)] }, "length");
    expect(() => fromOpenAiResponse(body)).toThrow(
      expect.objectContaining({
        code: "unexpected-response",
        message: "OpenAI answered in an unexpected way.",
      }),
    );
  });

  it.each([
    ["stop", "stop"],
    ["tool_calls", "tool_calls"],
    ["function_call", "tool_calls"],
    ["length", "length"],
    ["content_filter", "other"],
    ["constructor", "other"],
    [null, "other"],
  ] as const)("maps the finish reason %s to %s", (finishReason, expected) => {
    expect(fromOpenAiResponse(answer({ content: "" }, finishReason)).finishReason).toBe(expected);
  });
});

describe("openAiResponseSchema", () => {
  it("refuses an answer without a choice", () => {
    expect(openAiResponseSchema.safeParse({ choices: [], usage }).success).toBe(false);
  });

  it("refuses an answer without usage, which spend needs", () => {
    const body = { choices: [{ message: { content: "hi" }, finish_reason: "stop" }] };
    expect(openAiResponseSchema.safeParse(body).success).toBe(false);
  });
});
