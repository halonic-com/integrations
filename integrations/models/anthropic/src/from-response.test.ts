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

  function usageOf(usage: Record<string, unknown>) {
    const body = anthropicResponseSchema.parse({ content: [], stop_reason: "end_turn", usage });
    return fromAnthropicResponse(body).usage;
  }

  it("counts prompt cache reads and writes apart from the input tokens", () => {
    const usage = usageOf({
      input_tokens: 10,
      output_tokens: 3,
      cache_creation_input_tokens: 300,
      cache_read_input_tokens: 1000,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
    });
    expect(usage).toEqual({
      inputTokens: 10,
      outputTokens: 3,
      cacheReadTokens: 1000,
      cacheWriteTokens: 100,
      cacheWrite1hTokens: 200,
    });
  });

  it("counts every cache write as a 5-minute write without the cache_creation split", () => {
    const usage = usageOf({
      input_tokens: 10,
      output_tokens: 3,
      cache_creation_input_tokens: 300,
    });
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 3, cacheWriteTokens: 300 });
  });

  it("leaves out cache counts that are 0 or null", () => {
    const usage = usageOf({
      input_tokens: 10,
      output_tokens: 3,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: null,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
    });
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 3 });
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
