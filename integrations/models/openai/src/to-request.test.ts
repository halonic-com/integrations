import type { ChatRequest } from "@halonicjs/adapters/integration-kit";
import { describe, expect, it } from "vitest";
import { toOpenAiMessage, toOpenAiRequest } from "./to-request.ts";

const question: ChatRequest = { model: "gpt-test", messages: [{ role: "user", content: "hi" }] };

describe("toOpenAiMessage", () => {
  it("keeps system and user messages as they are", () => {
    expect(toOpenAiMessage({ role: "system", content: "Be brief." })).toEqual({
      role: "system",
      content: "Be brief.",
    });
    expect(toOpenAiMessage({ role: "user", content: "hi" })).toEqual({
      role: "user",
      content: "hi",
    });
  });

  it("sends tool calls with their arguments as JSON text and no empty content", () => {
    const message = toOpenAiMessage({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "c1", name: "search", arguments: { q: "x", limit: 2 } }],
    });
    expect(message).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: { name: "search", arguments: '{"q":"x","limit":2}' },
        },
      ],
    });
  });

  it("keeps the assistant's text next to its tool calls", () => {
    const message = toOpenAiMessage({
      role: "assistant",
      content: "Looking it up.",
      toolCalls: [{ id: "c1", name: "search", arguments: {} }],
    });
    expect(message).toMatchObject({ content: "Looking it up." });
  });

  it("sends a plain answer as text, even an empty one", () => {
    expect(toOpenAiMessage({ role: "assistant", content: "" })).toEqual({
      role: "assistant",
      content: "",
    });
  });

  it("answers a tool call with its id", () => {
    expect(
      toOpenAiMessage({ role: "tool", toolCallId: "c1", name: "search", content: "3 results" }),
    ).toEqual({ role: "tool", tool_call_id: "c1", content: "3 results" });
  });
});

describe("toOpenAiRequest", () => {
  it("maps messages, tools and the sampling settings", () => {
    const parameters = { type: "object" };
    const request = toOpenAiRequest({
      model: "gpt-test",
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "u" },
      ],
      tools: [{ name: "search", description: "d", parameters }],
      params: { temperature: 0, topP: 0.5, maxTokens: 100, stop: ["END"], reasoningEffort: "low" },
    });
    expect(request).toEqual({
      model: "gpt-test",
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "u" },
      ],
      tools: [{ type: "function", function: { name: "search", description: "d", parameters } }],
      max_completion_tokens: 100,
      temperature: 0,
      top_p: 0.5,
      stop: ["END"],
      reasoning_effort: "low",
    });
  });

  it("asks for JSON mode with the instruction it needs", () => {
    const request = toOpenAiRequest({ ...question, responseFormat: "json" });
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.messages[0]).toEqual({
      role: "system",
      content: "Reply with a single JSON object and nothing else.",
    });
  });

  it("sends only what is set, and never meta or extra", () => {
    const request = toOpenAiRequest({
      ...question,
      responseFormat: "text",
      meta: { agentId: "agent-1", runId: "run-1" },
      params: { extra: { user: "x" } },
    });
    expect(Object.keys(request).sort()).toEqual(["messages", "model"]);
  });
});
