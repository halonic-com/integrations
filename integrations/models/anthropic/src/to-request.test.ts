import { describe, expect, it } from "vitest";
import type { ChatRequest } from "./kit.ts";
import { toAnthropicMessages, toAnthropicRequest } from "./to-request.ts";

const question: ChatRequest = { model: "claude-test", messages: [{ role: "user", content: "hi" }] };

describe("toAnthropicMessages", () => {
  it("puts system apart and joins tool results into one user turn", () => {
    const request = toAnthropicRequest({
      model: "claude-test",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "t1", name: "a", arguments: {} },
            { id: "t2", name: "b", arguments: { n: 1 } },
          ],
        },
        { role: "tool", toolCallId: "t1", name: "a", content: "1" },
        { role: "tool", toolCallId: "t2", name: "b", content: "2" },
      ],
    });
    expect(request.system).toBe("Be brief.");
    expect(request.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "a", input: {} },
          { type: "tool_use", id: "t2", name: "b", input: { n: 1 } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "1" },
          { type: "tool_result", tool_use_id: "t2", content: "2" },
        ],
      },
    ]);
  });

  it("keeps the assistant's text before its tool calls", () => {
    const messages = toAnthropicMessages([
      {
        role: "assistant",
        content: "Looking it up.",
        toolCalls: [{ id: "t1", name: "a", arguments: {} }],
      },
    ]);
    expect(messages[0]?.content.map((block) => block.type)).toEqual(["text", "tool_use"]);
  });

  it("drops an empty message instead of sending an empty text block", () => {
    const messages = toAnthropicMessages([
      { role: "user", content: "hi" },
      { role: "assistant", content: "" },
      { role: "user", content: "still there?" },
    ]);
    expect(messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "hi" },
          { type: "text", text: "still there?" },
        ],
      },
    ]);
  });
});

describe("toAnthropicRequest", () => {
  it("joins several system messages with a blank line", () => {
    const request = toAnthropicRequest({
      model: "claude-test",
      messages: [
        { role: "system", content: "One." },
        { role: "user", content: "hi" },
        { role: "system", content: "Two." },
      ],
    });
    expect(request.system).toBe("One.\n\nTwo.");
  });

  it("sends no system prompt when there is none", () => {
    expect(toAnthropicRequest(question)).not.toHaveProperty("system");
  });

  it("maps tools to input_schema", () => {
    const parameters = { type: "object", properties: { city: { type: "string" } } };
    const request = toAnthropicRequest({
      ...question,
      tools: [{ name: "weather_forecast", description: "Forecast.", parameters }],
    });
    expect(request.tools).toEqual([
      { name: "weather_forecast", description: "Forecast.", input_schema: parameters },
    ]);
  });

  it("maps the sampling settings and sets a default limit", () => {
    expect(toAnthropicRequest(question).max_tokens).toBe(16_000);
    const request = toAnthropicRequest({
      ...question,
      params: { maxTokens: 100, temperature: 0, topP: 0.5, stop: ["END"] },
    });
    expect(request).toMatchObject({
      max_tokens: 100,
      temperature: 0,
      top_p: 0.5,
      stop_sequences: ["END"],
    });
  });

  it("asks for JSON in the system prompt", () => {
    const request = toAnthropicRequest({
      ...question,
      messages: [{ role: "system", content: "Be brief." }, ...question.messages],
      responseFormat: "json",
    });
    expect(request.system).toBe("Be brief.\n\nReply with a single JSON value and nothing else.");
  });

  it("never sends meta, reasoningEffort or extra", () => {
    const request = toAnthropicRequest({
      ...question,
      meta: { agentId: "agent-1", runId: "run-1" },
      params: { reasoningEffort: "high", extra: { metadata: { user_id: "x" } } },
    });
    expect(Object.keys(request).sort()).toEqual(["max_tokens", "messages", "model"]);
  });
});
