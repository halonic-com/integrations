import { EventStreamError, type ServerSentEvent } from "@halonicjs/integration-shared";
import { describe, expect, it } from "vitest";
import { GeminiError } from "./errors.ts";
import { fromGeminiResponse, geminiResponseSchema } from "./from-response.ts";
import { fromGeminiStream } from "./from-stream.ts";
import type { ChatResponse, ChatStreamEvent } from "./kit.ts";

/*
 * Hand-written chunks in Google's documented shapes
 * (https://aistudio.google.com/api-reference/generate-content). The
 * thought signatures are fake: these tests only check where they end up.
 */

const responseId = "fake-response-id";

/** One event of `streamGenerateContent?alt=sse`: a chunk, in an event without a name. */
function event(body: Record<string, unknown>): ServerSentEvent {
  return { type: "message", data: JSON.stringify(body), lastEventId: "" };
}

/** A chunk of this answer, with its `responseId`. */
function chunk(body: Record<string, unknown>): ServerSentEvent {
  return event({ responseId, ...body });
}

/** The one candidate with some of its parts, and its finish reason on the last chunk. */
function candidates(parts: unknown[], finishReason?: string) {
  const candidate = { content: { role: "model", parts }, index: 0 };
  return { candidates: [finishReason === undefined ? candidate : { ...candidate, finishReason }] };
}

function partsChunk(parts: unknown[], finishReason?: string): ServerSentEvent {
  return chunk(candidates(parts, finishReason));
}

function usage(candidatesTokenCount: number, thoughtsTokenCount = 0) {
  return {
    usageMetadata: {
      promptTokenCount: 8,
      candidatesTokenCount,
      ...(thoughtsTokenCount > 0 ? { thoughtsTokenCount } : {}),
    },
  };
}

async function* streamOf(events: readonly ServerSentEvent[]): AsyncGenerator<ServerSentEvent> {
  yield* events;
}

async function readAll(events: readonly ServerSentEvent[]): Promise<ChatStreamEvent[]> {
  const read: ChatStreamEvent[] = [];
  for await (const piece of fromGeminiStream(streamOf(events))) {
    read.push(piece);
  }
  return read;
}

async function failure(events: readonly ServerSentEvent[]): Promise<unknown> {
  return readAll(events).catch((caught) => caught);
}

/** What `chat` returns for the same answer, not streamed. */
function chatAnswer(body: unknown): ChatResponse {
  return fromGeminiResponse(geminiResponseSchema.parse({ responseId, ...(body as object) }));
}

function doneOf(read: readonly ChatStreamEvent[]): ChatResponse | undefined {
  const last = read.at(-1);
  return last?.type === "done" ? last.response : undefined;
}

/** Plain text in several pieces; the usage grows with each chunk. */
const textPieces = [
  chunk({ ...candidates([{ text: "Hello" }]), ...usage(1) }),
  chunk({ ...candidates([{ text: " there," }]), ...usage(3) }),
  chunk({ ...candidates([{ text: " friend." }], "STOP"), ...usage(5) }),
];

describe("fromGeminiStream", () => {
  it("yields plain text piece by piece and ends with chat's answer", async () => {
    const read = await readAll(textPieces);
    expect(read.slice(0, -1)).toEqual([
      { type: "text", delta: "Hello" },
      { type: "text", delta: " there," },
      { type: "text", delta: " friend." },
    ]);
    const expected = chatAnswer({
      candidates: [
        { content: { parts: [{ text: "Hello there, friend." }] }, finishReason: "STOP" },
      ],
      ...usage(5),
    });
    expect(doneOf(read)).toEqual(expected);
    expect(expected).toMatchObject({ content: "Hello there, friend.", finishReason: "stop" });
  });

  it("yields a function call whole, with chat's id and signature", async () => {
    const call = {
      functionCall: { id: "call-1", name: "weather_forecast", args: { city: "Ghent" } },
      thoughtSignature: "fake-signature-1",
    };
    const read = await readAll([
      partsChunk([{ text: "Let me check." }]),
      chunk({ ...candidates([call], "STOP"), ...usage(12) }),
    ]);
    expect(read.slice(0, -1)).toEqual([
      { type: "text", delta: "Let me check." },
      {
        type: "tool-call",
        index: 0,
        id: "call-1",
        name: "weather_forecast",
        arguments: '{"city":"Ghent"}',
      },
    ]);
    const done = doneOf(read);
    expect(done).toEqual(
      chatAnswer({
        candidates: [
          { content: { parts: [{ text: "Let me check." }, call] }, finishReason: "STOP" },
        ],
        ...usage(12),
      }),
    );
    expect(done?.toolCalls).toEqual([
      {
        id: "call-1",
        name: "weather_forecast",
        arguments: { city: "Ghent" },
        signature: "fake-signature-1",
      },
    ]);
    expect(done?.finishReason).toBe("tool_calls");
  });

  it("makes up the same ids as chat for calls that came without one", async () => {
    const read = await readAll([
      partsChunk([{ functionCall: { name: "clock_now" } }]),
      partsChunk([{ functionCall: { name: "weather_forecast", args: { city: "Ghent" } } }], "STOP"),
    ]);
    const pieces = read.filter((piece) => piece.type === "tool-call");
    expect(pieces.map((piece) => [piece.index, piece.id, piece.arguments])).toEqual([
      [0, "gemini-call-fake-response-id-0", "{}"],
      [1, "gemini-call-fake-response-id-1", '{"city":"Ghent"}'],
    ]);
    expect(doneOf(read)?.toolCalls.map((call) => call.id)).toEqual(pieces.map((piece) => piece.id));
  });

  it("yields the thought summary as reasoning and keeps the signature where chat has it", async () => {
    // With `includeThoughts`, Gemini 3 streams the summary, then the answer,
    // and may send the signature last, on a part with empty text.
    const read = await readAll([
      partsChunk([{ text: "The user wants ", thought: true }]),
      partsChunk([{ text: "a greeting.", thought: true }]),
      partsChunk([{ text: "Hello" }]),
      partsChunk([{ text: " there." }]),
      chunk({
        ...candidates([{ text: "", thoughtSignature: "fake-signature-1" }], "STOP"),
        ...usage(4, 30),
      }),
    ]);
    expect(read.slice(0, -1)).toEqual([
      { type: "reasoning", delta: "The user wants " },
      { type: "reasoning", delta: "a greeting." },
      { type: "text", delta: "Hello" },
      { type: "text", delta: " there." },
    ]);
    const done = doneOf(read);
    expect(done).toEqual(
      chatAnswer({
        candidates: [
          {
            content: {
              parts: [
                { text: "The user wants a greeting.", thought: true },
                { text: "Hello there.", thoughtSignature: "fake-signature-1" },
              ],
            },
            finishReason: "STOP",
          },
        ],
        ...usage(4, 30),
      }),
    );
    expect(done).toMatchObject({
      content: "Hello there.",
      reasoning: "The user wants a greeting.",
      usage: { inputTokens: 8, outputTokens: 34 },
    });
  });

  it("never moves a signature ahead of text that came after it", async () => {
    const read = await readAll([
      partsChunk([{ text: "Hello", thoughtSignature: "fake-signature-1" }]),
      partsChunk([{ text: " there." }], "STOP"),
    ]);
    expect(doneOf(read)?.replay?.data).toEqual([
      { text: "Hello", thoughtSignature: "fake-signature-1" },
      { text: " there." },
    ]);
    expect(doneOf(read)?.content).toBe("Hello there.");
  });

  it("takes the usage from the last chunk", async () => {
    const read = await readAll([
      chunk({ ...candidates([{ text: "Hi." }]), ...usage(1) }),
      partsChunk([], "MAX_TOKENS"),
      chunk({
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 9, thoughtsTokenCount: 2 },
      }),
    ]);
    expect(doneOf(read)).toMatchObject({
      usage: { inputTokens: 8, outputTokens: 11 },
      finishReason: "length",
    });
  });

  it("answers a blocked prompt as chat does", async () => {
    const read = await readAll([chunk({ promptFeedback: { blockReason: "SAFETY" }, ...usage(0) })]);
    expect(read).toEqual([
      {
        type: "done",
        response: chatAnswer({ promptFeedback: { blockReason: "SAFETY" }, ...usage(0) }),
      },
    ]);
    expect(doneOf(read)).toMatchObject({ content: "", finishReason: "other" });
  });

  it("keeps a part type it doesn't read for replay", async () => {
    const code = { executableCode: { language: "PYTHON", code: "print(1)" } };
    const read = await readAll([partsChunk([code]), partsChunk([{ text: "1" }], "STOP")]);
    expect(doneOf(read)?.replay?.data).toEqual([code, { text: "1" }]);
  });
});

describe("fromGeminiStream errors", () => {
  it("refuses a stream cut off before the finish reason", async () => {
    const read: ChatStreamEvent[] = [];
    const error = await (async () => {
      for await (const piece of fromGeminiStream(streamOf(textPieces.slice(0, 2)))) {
        read.push(piece);
      }
    })().catch((caught) => caught);
    expect(read.map((piece) => piece.type)).toEqual(["text", "text"]);
    expect(error).toBeInstanceOf(GeminiError);
    expect(error).toMatchObject({ code: "unexpected-response" });
  });

  it("refuses an empty stream", async () => {
    expect(await failure([])).toMatchObject({ code: "unexpected-response" });
  });

  it("maps an error chunk mid-answer by Google's status, without its text", async () => {
    const error = await failure([
      textPieces[0] as ServerSentEvent,
      chunk({ error: { code: 503, message: "my private text", status: "UNAVAILABLE" } }),
    ]);
    expect(error).toMatchObject({ code: "unavailable", name: "GeminiError" });
    expect((error as Error).message).toBe(
      "Gemini is having trouble right now. Try again later (UNAVAILABLE).",
    );
  });

  it.each([
    ["has two candidates", [chunk({ candidates: [{}, {}] })]],
    [
      "changes its response id",
      [partsChunk([{ text: "a" }]), event({ responseId: "other", ...candidates([], "STOP") })],
    ],
    [
      "sends a response id only after a call got a made-up id",
      [event(candidates([{ functionCall: { name: "clock_now" } }])), partsChunk([], "STOP")],
    ],
    ["sends a function call it can't read", [partsChunk([{ functionCall: { args: {} } }], "STOP")]],
    [
      "sends usage that isn't usage",
      [chunk({ ...candidates([], "STOP"), usageMetadata: { promptTokenCount: -1 } })],
    ],
  ])("refuses a stream that %s", async (_case, events) => {
    const error = await failure(events);
    expect(error).toMatchObject({ code: "unexpected-response", name: "GeminiError" });
  });

  it("refuses chunk data that isn't JSON, without quoting it", async () => {
    const error = await failure([{ type: "message", data: "my private text", lastEventId: "" }]);
    expect(error).toMatchObject({ code: "unexpected-response" });
    expect((error as Error).message).not.toContain("private");
    expect((error as Error).cause).toBeUndefined();
  });

  it("turns the reader's own refusal into unexpected-response", async () => {
    async function* tooLarge(): AsyncGenerator<ServerSentEvent> {
      yield textPieces[0] as ServerSentEvent;
      throw new EventStreamError("too-large", "An event in the event stream is too large.");
    }
    const error = await (async () => {
      for await (const _piece of fromGeminiStream(tooLarge())) {
        // read on
      }
    })().catch((caught) => caught);
    expect(error).toMatchObject({ code: "unexpected-response", name: "GeminiError" });
  });

  it("lets a dropped connection through unchanged", async () => {
    const dropped = new Error("connection reset");
    async function* drops(): AsyncGenerator<ServerSentEvent> {
      yield textPieces[0] as ServerSentEvent;
      throw dropped;
    }
    const error = await (async () => {
      for await (const _piece of fromGeminiStream(drops())) {
        // read on
      }
    })().catch((caught) => caught);
    expect(error).toBe(dropped);
  });
});
