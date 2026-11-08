import { EventStreamError, type ServerSentEvent } from "@halonicjs/integration-shared";
import { describe, expect, it } from "vitest";
import { OpenAiError } from "./errors.ts";
import { fromOpenAiStream } from "./from-stream.ts";
import type { ChatStreamEvent } from "./kit.ts";

/*
 * Hand-written chunks in OpenAI's documented shapes
 * (https://platform.openai.com/docs/api-reference/chat-streaming).
 */

function message(data: string): ServerSentEvent {
  return { type: "message", data, lastEventId: "" };
}

function chunk(choices: unknown[], usage: unknown = null): ServerSentEvent {
  return message(JSON.stringify({ object: "chat.completion.chunk", choices, usage }));
}

function choice(delta: Record<string, unknown>, finishReason: string | null = null) {
  return { index: 0, delta, finish_reason: finishReason };
}

function toolPiece(index: number, piece: Record<string, unknown>) {
  return choice({ tool_calls: [{ index, ...piece }] });
}

const usage = { prompt_tokens: 24, completion_tokens: 9, total_tokens: 33 };
const usageChunk = chunk([], usage);
const done = message("[DONE]");

async function* streamOf(events: readonly ServerSentEvent[]): AsyncGenerator<ServerSentEvent> {
  yield* events;
}

async function readAll(events: readonly ServerSentEvent[]): Promise<ChatStreamEvent[]> {
  const read: ChatStreamEvent[] = [];
  for await (const piece of fromOpenAiStream(streamOf(events))) {
    read.push(piece);
  }
  return read;
}

async function failure(events: readonly ServerSentEvent[]): Promise<unknown> {
  return readAll(events).catch((caught) => caught);
}

describe("fromOpenAiStream", () => {
  it("yields the text as it comes and ends with the whole answer and its usage", async () => {
    const read = await readAll([
      chunk([choice({ role: "assistant", content: "", refusal: null })]),
      chunk([choice({ content: "Hello" })]),
      chunk([choice({ content: " there." })]),
      chunk([choice({}, "stop")]),
      usageChunk,
      done,
    ]);
    expect(read).toEqual([
      { type: "text", delta: "Hello" },
      { type: "text", delta: " there." },
      {
        type: "done",
        response: {
          content: "Hello there.",
          toolCalls: [],
          usage: { inputTokens: 24, outputTokens: 9 },
          finishReason: "stop",
        },
      },
    ]);
  });

  it("yields tool calls in pieces, with the id and name first", async () => {
    const read = await readAll([
      chunk([choice({ role: "assistant", content: null })]),
      chunk([
        toolPiece(0, {
          id: "call_1",
          type: "function",
          function: { name: "weather_forecast", arguments: "" },
        }),
      ]),
      chunk([toolPiece(0, { function: { arguments: '{"city":' } })]),
      chunk([toolPiece(0, { function: { arguments: '"Ghent"}' } })]),
      chunk([
        toolPiece(1, {
          id: "call_2",
          type: "function",
          function: { name: "clock_now", arguments: "{}" },
        }),
      ]),
      chunk([choice({}, "tool_calls")]),
      usageChunk,
      done,
    ]);
    expect(read.slice(0, -1)).toEqual([
      { type: "tool-call", index: 0, id: "call_1", name: "weather_forecast", arguments: "" },
      { type: "tool-call", index: 0, arguments: '{"city":' },
      { type: "tool-call", index: 0, arguments: '"Ghent"}' },
      { type: "tool-call", index: 1, id: "call_2", name: "clock_now", arguments: "{}" },
    ]);
    expect(read.at(-1)).toEqual({
      type: "done",
      response: {
        content: "",
        toolCalls: [
          { id: "call_1", name: "weather_forecast", arguments: { city: "Ghent" } },
          { id: "call_2", name: "clock_now", arguments: {} },
        ],
        usage: { inputTokens: 24, outputTokens: 9 },
        finishReason: "tool_calls",
      },
    });
  });

  it("yields a refusal as the text at the end, like chat shows it", async () => {
    const read = await readAll([
      chunk([choice({ role: "assistant", content: null, refusal: "" })]),
      chunk([choice({ refusal: "I can't " })]),
      chunk([choice({ refusal: "help with that." })]),
      chunk([choice({}, "stop")]),
      usageChunk,
      done,
    ]);
    expect(read).toEqual([
      { type: "text", delta: "I can't help with that." },
      {
        type: "done",
        response: expect.objectContaining({ content: "I can't help with that." }),
      },
    ]);
  });

  it("stops reading at [DONE]", async () => {
    const read = await readAll([
      chunk([choice({ content: "Hi." }, "stop")]),
      usageChunk,
      done,
      message("not json after the end"),
    ]);
    expect(read.at(-1)?.type).toBe("done");
  });
});

describe("fromOpenAiStream errors", () => {
  it("maps an error chunk by OpenAI's error type, without its text", async () => {
    const error = await failure([
      chunk([choice({ content: "Hel" })]),
      message(JSON.stringify({ error: { type: "server_error", message: "my private text" } })),
    ]);
    expect(error).toBeInstanceOf(OpenAiError);
    expect(error).toMatchObject({ code: "unavailable" });
    expect((error as Error).message).toBe(
      "OpenAI is having trouble right now. Try again later (server_error).",
    );
  });

  it("maps a rate limit error chunk to rate-limited", async () => {
    const error = await failure([
      message(JSON.stringify({ error: { code: "rate_limit_exceeded", type: "requests" } })),
    ]);
    expect(error).toMatchObject({ code: "rate-limited" });
  });

  it.each([
    ["ends before [DONE]", [chunk([choice({ content: "Hi." }, "stop")]), usageChunk]],
    ["has no usage, as without include_usage", [chunk([choice({ content: "Hi." }, "stop")]), done]],
    ["has a second choice", [chunk([{ index: 1, delta: { content: "Hi." } }])]],
    [
      "skips a tool call index",
      [
        chunk([toolPiece(1, { id: "call_1", function: { name: "clock_now", arguments: "{}" } })]),
        usageChunk,
        done,
      ],
    ],
    [
      "renames a tool call it already started",
      [
        chunk([toolPiece(0, { id: "call_1", function: { name: "clock_now", arguments: "" } })]),
        chunk([toolPiece(0, { function: { name: "weather_forecast", arguments: "{}" } })]),
      ],
    ],
    [
      "sends tool arguments that aren't a JSON object",
      [
        chunk([toolPiece(0, { id: "call_1", function: { name: "clock_now", arguments: '["x"' } })]),
        chunk([choice({}, "tool_calls")]),
        usageChunk,
        done,
      ],
    ],
    [
      "sends a chunk without choices",
      [message(JSON.stringify({ object: "chat.completion.chunk" }))],
    ],
  ])("refuses a stream that %s", async (_case, events) => {
    const error = await failure(events);
    expect(error).toMatchObject({ code: "unexpected-response", name: "OpenAiError" });
  });

  it("refuses data that isn't JSON, without quoting it", async () => {
    const error = await failure([message("my private text")]);
    expect(error).toMatchObject({ code: "unexpected-response" });
    expect((error as Error).message).not.toContain("private");
    expect((error as Error).cause).toBeUndefined();
  });

  it("turns the reader's own refusal into unexpected-response", async () => {
    async function* tooLarge(): AsyncGenerator<ServerSentEvent> {
      yield chunk([choice({ content: "Hi" })]);
      throw new EventStreamError("too-large", "An event in the event stream is too large.");
    }
    const error = await (async () => {
      for await (const _piece of fromOpenAiStream(tooLarge())) {
        // read on
      }
    })().catch((caught) => caught);
    expect(error).toMatchObject({ code: "unexpected-response", name: "OpenAiError" });
  });

  it("lets a dropped connection through unchanged", async () => {
    const dropped = new Error("connection reset");
    async function* drops(): AsyncGenerator<ServerSentEvent> {
      yield chunk([choice({ content: "Hi" })]);
      throw dropped;
    }
    const error = await (async () => {
      for await (const _piece of fromOpenAiStream(drops())) {
        // read on
      }
    })().catch((caught) => caught);
    expect(error).toBe(dropped);
  });
});
