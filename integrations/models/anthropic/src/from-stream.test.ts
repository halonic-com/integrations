import { EventStreamError, type ServerSentEvent } from "@halonicjs/integration-shared";
import { describe, expect, it } from "vitest";
import { AnthropicError } from "./errors.ts";
import { anthropicResponseSchema, fromAnthropicResponse } from "./from-response.ts";
import { fromAnthropicStream } from "./from-stream.ts";
import type { ChatStreamEvent } from "./kit.ts";

/*
 * Hand-written events in Anthropic's documented shapes
 * (https://docs.anthropic.com/en/docs/build-with-claude/streaming). The
 * thinking signature is fake: these tests only check it is kept.
 */

function event(type: string, data: Record<string, unknown>): ServerSentEvent {
  return { type, data: JSON.stringify({ type, ...data }), lastEventId: "" };
}

const messageStart = event("message_start", {
  message: {
    id: "msg_1",
    type: "message",
    role: "assistant",
    content: [],
    stop_reason: null,
    usage: { input_tokens: 25, output_tokens: 1, cache_read_input_tokens: 5 },
  },
});

function blockStart(index: number, block: Record<string, unknown>): ServerSentEvent {
  return event("content_block_start", { index, content_block: block });
}

function delta(index: number, value: Record<string, unknown>): ServerSentEvent {
  return event("content_block_delta", { index, delta: value });
}

function blockStop(index: number): ServerSentEvent {
  return event("content_block_stop", { index });
}

function messageEnd(stopReason: string, outputTokens: number): ServerSentEvent[] {
  return [
    event("message_delta", {
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens },
    }),
    event("message_stop", {}),
  ];
}

async function* streamOf(events: readonly ServerSentEvent[]): AsyncGenerator<ServerSentEvent> {
  yield* events;
}

async function readAll(events: readonly ServerSentEvent[]): Promise<ChatStreamEvent[]> {
  const read: ChatStreamEvent[] = [];
  for await (const piece of fromAnthropicStream(streamOf(events))) {
    read.push(piece);
  }
  return read;
}

async function failure(events: readonly ServerSentEvent[]): Promise<unknown> {
  return readAll(events).catch((caught) => caught);
}

const textAnswer = [
  messageStart,
  blockStart(0, { type: "text", text: "" }),
  event("ping", {}),
  delta(0, { type: "text_delta", text: "Hello" }),
  delta(0, { type: "text_delta", text: " there." }),
  blockStop(0),
  ...messageEnd("end_turn", 12),
];

describe("fromAnthropicStream", () => {
  it("yields the text as it comes and ends with the whole answer", async () => {
    expect(await readAll(textAnswer)).toEqual([
      { type: "text", delta: "Hello" },
      { type: "text", delta: " there." },
      {
        type: "done",
        response: {
          content: "Hello there.",
          toolCalls: [],
          replay: { type: "anthropic", data: [{ type: "text", text: "Hello there." }] },
          usage: { inputTokens: 25, outputTokens: 12, cacheReadTokens: 5 },
          finishReason: "stop",
        },
      },
    ]);
  });

  it("yields tool calls in pieces, counted by tool call, not by block", async () => {
    const read = await readAll([
      messageStart,
      blockStart(0, { type: "text", text: "" }),
      delta(0, { type: "text_delta", text: "Checking." }),
      blockStop(0),
      blockStart(1, { type: "tool_use", id: "toolu_1", name: "weather_forecast", input: {} }),
      delta(1, { type: "input_json_delta", partial_json: "" }),
      delta(1, { type: "input_json_delta", partial_json: '{"city": "Gh' }),
      delta(1, { type: "input_json_delta", partial_json: 'ent"}' }),
      blockStop(1),
      ...messageEnd("tool_use", 40),
    ]);
    expect(read.slice(0, -1)).toEqual([
      { type: "text", delta: "Checking." },
      { type: "tool-call", index: 0, id: "toolu_1", name: "weather_forecast", arguments: "" },
      { type: "tool-call", index: 0, arguments: '{"city": "Gh' },
      { type: "tool-call", index: 0, arguments: 'ent"}' },
    ]);
    expect(read.at(-1)).toMatchObject({
      type: "done",
      response: {
        content: "Checking.",
        toolCalls: [{ id: "toolu_1", name: "weather_forecast", arguments: { city: "Ghent" } }],
        finishReason: "tool_calls",
      },
    });
  });

  it("sends {} for a tool call whose arguments came as no JSON at all", async () => {
    const read = await readAll([
      messageStart,
      blockStart(0, { type: "tool_use", id: "toolu_1", name: "clock_now", input: {} }),
      blockStop(0),
      ...messageEnd("tool_use", 10),
    ]);
    const pieces = read.filter((piece) => piece.type === "tool-call");
    expect(pieces.map((piece) => piece.arguments).join("")).toBe("{}");
    expect(read.at(-1)).toMatchObject({
      response: { toolCalls: [{ id: "toolu_1", name: "clock_now", arguments: {} }] },
    });
  });

  it("gives the same answer as chat, thinking and signature included", async () => {
    const read = await readAll([
      messageStart,
      blockStart(0, { type: "thinking", thinking: "", signature: "" }),
      delta(0, { type: "thinking_delta", thinking: "The user wants " }),
      delta(0, { type: "thinking_delta", thinking: "the weather." }),
      delta(0, { type: "signature_delta", signature: "fake-signature-1" }),
      blockStop(0),
      blockStart(1, { type: "redacted_thinking", data: "fake-redacted-data-1" }),
      blockStop(1),
      blockStart(2, { type: "tool_use", id: "toolu_1", name: "weather_forecast", input: {} }),
      delta(2, { type: "input_json_delta", partial_json: '{"city":"Ghent"}' }),
      blockStop(2),
      ...messageEnd("tool_use", 50),
    ]);
    const chatAnswer = fromAnthropicResponse(
      anthropicResponseSchema.parse({
        content: [
          {
            type: "thinking",
            thinking: "The user wants the weather.",
            signature: "fake-signature-1",
          },
          { type: "redacted_thinking", data: "fake-redacted-data-1" },
          { type: "tool_use", id: "toolu_1", name: "weather_forecast", input: { city: "Ghent" } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 25, output_tokens: 50, cache_read_input_tokens: 5 },
      }),
    );
    expect(read.at(-1)).toEqual({ type: "done", response: chatAnswer });
    // chat keeps thinking only in `replay`, so the stream doesn't yield it either.
    expect(read.some((piece) => piece.type === "reasoning")).toBe(false);
  });

  it("takes the latest usage counts from message_delta", async () => {
    const read = await readAll([
      messageStart,
      blockStart(0, { type: "text", text: "" }),
      blockStop(0),
      event("message_delta", {
        delta: { stop_reason: "max_tokens" },
        usage: { input_tokens: 40, output_tokens: 7, cache_read_input_tokens: null },
      }),
      event("message_stop", {}),
    ]);
    expect(read.at(-1)).toMatchObject({
      response: {
        usage: { inputTokens: 40, outputTokens: 7, cacheReadTokens: 5 },
        finishReason: "length",
      },
    });
  });

  it("reads the 5-minute and 1-hour cache writes from message_start", async () => {
    const read = await readAll([
      event("message_start", {
        message: {
          content: [],
          stop_reason: null,
          usage: {
            input_tokens: 25,
            output_tokens: 1,
            cache_creation_input_tokens: 300,
            cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
          },
        },
      }),
      blockStart(0, { type: "text", text: "" }),
      blockStop(0),
      ...messageEnd("end_turn", 4),
    ]);
    expect(read.at(-1)).toMatchObject({
      response: {
        usage: {
          inputTokens: 25,
          outputTokens: 4,
          cacheWriteTokens: 100,
          cacheWrite1hTokens: 200,
        },
      },
    });
  });

  it("stops reading at message_stop", async () => {
    const read = await readAll([...textAnswer, event("not-json-after-the-end", {})]);
    expect(read.at(-1)?.type).toBe("done");
  });

  it("skips event and delta types added later", async () => {
    const read = await readAll([
      messageStart,
      event("some_new_event", { anything: true }),
      blockStart(0, { type: "text", text: "" }),
      delta(0, { type: "some_new_delta", value: 1 }),
      delta(0, { type: "text_delta", text: "Hi." }),
      blockStop(0),
      ...messageEnd("end_turn", 3),
    ]);
    expect(read.at(-1)).toMatchObject({ response: { content: "Hi." } });
  });
});

describe("fromAnthropicStream errors", () => {
  it("maps an error event by Anthropic's error type, without its text", async () => {
    const error = await failure([
      messageStart,
      event("error", { error: { type: "overloaded_error", message: "my private text" } }),
    ]);
    expect(error).toBeInstanceOf(AnthropicError);
    expect(error).toMatchObject({ code: "unavailable" });
    expect((error as Error).message).toBe(
      "Anthropic is having trouble right now. Try again later (overloaded_error).",
    );
  });

  it("maps a rate limit error event to rate-limited", async () => {
    const error = await failure([
      event("error", { error: { type: "rate_limit_error", message: "Slow down" } }),
    ]);
    expect(error).toMatchObject({ code: "rate-limited" });
  });

  it.each([
    ["ends before message_stop", [messageStart, blockStart(0, { type: "text", text: "" })]],
    [
      "has a block that never stopped",
      [messageStart, blockStart(0, { type: "text", text: "" }), ...messageEnd("end_turn", 1)],
    ],
    ["skips a block index", [messageStart, blockStart(1, { type: "text", text: "" })]],
    [
      "sends a delta for an unknown block",
      [messageStart, delta(0, { type: "text_delta", text: "x" })],
    ],
    ["starts a block before the message", [blockStart(0, { type: "text", text: "" })]],
    ["starts the message twice", [messageStart, messageStart]],
    [
      "sends tool arguments that aren't an object",
      [
        messageStart,
        blockStart(0, { type: "tool_use", id: "toolu_1", name: "weather_forecast", input: {} }),
        delta(0, { type: "input_json_delta", partial_json: '["Ghent"]' }),
        blockStop(0),
      ],
    ],
  ])("refuses a stream that %s", async (_case, events) => {
    const error = await failure(events);
    expect(error).toMatchObject({ code: "unexpected-response", name: "AnthropicError" });
  });

  it("refuses event data that isn't JSON, without quoting it", async () => {
    const notJson = { type: "content_block_delta", data: "my private text", lastEventId: "" };
    const error = await failure([messageStart, notJson]);
    expect(error).toMatchObject({ code: "unexpected-response" });
    expect((error as Error).message).not.toContain("private");
    expect((error as Error).cause).toBeUndefined();
  });

  it("turns the reader's own refusal into unexpected-response", async () => {
    async function* tooLarge(): AsyncGenerator<ServerSentEvent> {
      yield messageStart;
      throw new EventStreamError("too-large", "An event in the event stream is too large.");
    }
    const error = await (async () => {
      for await (const _piece of fromAnthropicStream(tooLarge())) {
        // read on
      }
    })().catch((caught) => caught);
    expect(error).toMatchObject({ code: "unexpected-response", name: "AnthropicError" });
  });

  it("lets a dropped connection through unchanged", async () => {
    const dropped = new Error("connection reset");
    async function* drops(): AsyncGenerator<ServerSentEvent> {
      yield messageStart;
      throw dropped;
    }
    const error = await (async () => {
      for await (const _piece of fromAnthropicStream(drops())) {
        // read on
      }
    })().catch((caught) => caught);
    expect(error).toBe(dropped);
  });
});
