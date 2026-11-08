import { describe, expect, it } from "vitest";
import { anthropicResponseSchema, fromAnthropicResponse } from "./from-response.ts";
import type { ChatMessage, ChatResponse } from "./kit.ts";
import { toAnthropicMessages } from "./to-request.ts";

/**
 * Hand-written answers in Anthropic's documented shapes. The signatures and
 * the redacted data are fake: the API would refuse them, which is fine,
 * because these tests only check that they go back unchanged.
 */
const thinking = {
  type: "thinking",
  thinking: "The user wants the weather, so I call the forecast tool.",
  signature: "fake-signature-1",
};
const redactedThinking = { type: "redacted_thinking", data: "fake-redacted-data-1" };
const text = { type: "text", text: "Let me check.", citations: null };
const toolUse = {
  type: "tool_use",
  id: "toolu_1",
  name: "weather_forecast",
  input: { city: "Ghent" },
};

function answer(content: unknown[]): ChatResponse {
  return fromAnthropicResponse(
    anthropicResponseSchema.parse({
      content,
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 3 },
    }),
  );
}

/** What the engine stores for an answer: the assistant message with its replay. */
function assistantTurn(response: ChatResponse): ChatMessage {
  return {
    role: "assistant",
    content: response.content,
    toolCalls: response.toolCalls,
    ...(response.replay !== undefined ? { replay: response.replay } : {}),
  };
}

/** The assistant turn as the next request sends it. */
function sentBack(message: ChatMessage) {
  const turns = toAnthropicMessages([
    { role: "user", content: "What's the weather in Ghent?" },
    message,
    { role: "tool", toolCallId: "toolu_1", name: "weather_forecast", content: "Sunny." },
  ]);
  return turns[1]?.content;
}

describe("thinking blocks", () => {
  it("go back unchanged with the tool call they led to", () => {
    const response = answer([thinking, toolUse]);
    expect(response.toolCalls).toEqual([
      { id: "toolu_1", name: "weather_forecast", arguments: { city: "Ghent" } },
    ]);
    expect(sentBack(assistantTurn(response))).toEqual([thinking, toolUse]);
  });

  it("go back unchanged when redacted", () => {
    const response = answer([redactedThinking, toolUse]);
    expect(sentBack(assistantTurn(response))).toEqual([redactedThinking, toolUse]);
  });

  it("keep their place between text and tool_use", () => {
    const response = answer([text, thinking, toolUse]);
    expect(sentBack(assistantTurn(response))).toEqual([text, thinking, toolUse]);
  });

  it("go back with block types we don't know yet", () => {
    const future = { type: "some_future_block", payload: { kept: true } };
    const response = answer([thinking, future, toolUse]);
    expect(sentBack(assistantTurn(response))).toEqual([thinking, future, toolUse]);
  });

  it("never change the stored replay when turns are joined", () => {
    const response = answer([thinking, toolUse]);
    const stored = JSON.parse(JSON.stringify(response.replay));
    toAnthropicMessages([
      assistantTurn(response),
      { role: "assistant", content: "And one more thing." },
    ]);
    expect(response.replay).toEqual(stored);
  });
});

describe("an assistant turn without an Anthropic replay", () => {
  const rebuilt = [
    { type: "text", text: "Let me check." },
    { type: "tool_use", id: "toolu_1", name: "weather_forecast", input: { city: "Ghent" } },
  ];
  const message: ChatMessage = {
    role: "assistant",
    content: "Let me check.",
    toolCalls: [{ id: "toolu_1", name: "weather_forecast", arguments: { city: "Ghent" } }],
  };

  it("is rebuilt from content and toolCalls when there is no replay", () => {
    expect(sentBack(message)).toEqual(rebuilt);
  });

  it("ignores another provider's replay, after a model switch", () => {
    const replay = { type: "openai", data: [{ type: "reasoning", id: "rs_1" }] };
    expect(sentBack({ ...message, replay })).toEqual(rebuilt);
  });

  it("ignores a replay that isn't a list of blocks", () => {
    const replay = { type: "anthropic", data: { type: "thinking" } };
    expect(sentBack({ ...message, replay })).toEqual(rebuilt);
  });
});
