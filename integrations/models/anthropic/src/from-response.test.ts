import { describe, expect, it } from "vitest";
import {
  type AnthropicResponse,
  anthropicResponseSchema,
  fromAnthropicResponse,
} from "./from-response.ts";

const usage = { input_tokens: 10, output_tokens: 3 };

function answer(content: unknown[], stopReason: string | null = "end_turn"): AnthropicResponse {
  return anthropicResponseSchema.parse({ content, stop_reason: stopReason, usage });
}

describe("fromAnthropicResponse", () => {
  it("joins text blocks and maps tool_use blocks to tool calls", () => {
    const response = fromAnthropicResponse(
      answer(
        [
          { type: "text", text: "Let me " },
          { type: "text", text: "check." },
          { type: "tool_use", id: "toolu_1", name: "weather_forecast", input: { city: "Ghent" } },
        ],
        "tool_use",
      ),
    );
    expect(response).toEqual({
      content: "Let me check.",
      toolCalls: [{ id: "toolu_1", name: "weather_forecast", arguments: { city: "Ghent" } }],
      replay: expect.objectContaining({ type: "anthropic" }),
      usage: { inputTokens: 10, outputTokens: 3 },
      finishReason: "tool_calls",
    });
  });

  it("skips thinking and block types it doesn't know", () => {
    const response = fromAnthropicResponse(
      answer([
        { type: "thinking", thinking: "…", signature: "abc" },
        { type: "some_future_block" },
        { type: "text", text: "Done." },
      ]),
    );
    expect(response.content).toBe("Done.");
    expect(response.toolCalls).toEqual([]);
  });

  it("counts prompt cache reads and writes as input tokens", () => {
    const body = anthropicResponseSchema.parse({
      content: [],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 10,
        output_tokens: 3,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 1000,
      },
    });
    expect(fromAnthropicResponse(body).usage).toEqual({ inputTokens: 1110, outputTokens: 3 });
  });

  it.each([
    ["end_turn", "stop"],
    ["stop_sequence", "stop"],
    ["tool_use", "tool_calls"],
    ["max_tokens", "length"],
    ["refusal", "other"],
    ["pause_turn", "other"],
    ["constructor", "other"],
    [null, "other"],
  ] as const)("maps the stop reason %s to %s", (stopReason, finishReason) => {
    expect(fromAnthropicResponse(answer([], stopReason)).finishReason).toBe(finishReason);
  });
});

describe("anthropicResponseSchema", () => {
  it("refuses a tool_use block without input, so a tool call can't silently disappear", () => {
    const body = {
      content: [{ type: "tool_use", id: "toolu_1", name: "weather_forecast" }],
      stop_reason: "tool_use",
      usage,
    };
    expect(anthropicResponseSchema.safeParse(body).success).toBe(false);
  });

  it("refuses a body without usage, which spend needs", () => {
    const body = { content: [], stop_reason: "end_turn" };
    expect(anthropicResponseSchema.safeParse(body).success).toBe(false);
  });
});
