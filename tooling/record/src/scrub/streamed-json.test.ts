import { describe, expect, it } from "vitest";
import { RecordingRefused } from "./context.ts";
import type { CapturedExchange, JsonValue, RecordedBody, StreamEvent } from "./exchange.ts";
import { definePolicy, type ScrubPolicyInput } from "./policy.ts";
import { scrubExchanges } from "./scrubber.ts";
import { StreamedJson } from "./streamed-json.ts";

const ANTHROPIC_PIECES = "response.body[*].data.delta.partial_json";
const OPENAI_PIECES = "response.body[*].data.choices[*].delta.tool_calls[*].function.arguments";

/** An Anthropic stream: a text block, then two tool calls whose arguments come in pieces. */
function anthropicEvents(): StreamEvent[] {
  const delta = (index: number, partial_json: string): StreamEvent => ({
    event: "content_block_delta",
    data: { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json } },
  });
  return [
    {
      event: "content_block_delta",
      data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
    },
    delta(1, ""),
    delta(1, '{"city": "Gh'),
    delta(1, 'ent"}'),
    delta(2, '{"from": "Ghent", '),
    delta(2, '"to": "Bruges"}'),
  ];
}

/** An OpenAI stream: two tool calls, each piece in its own chunk at list position 0. */
function openAiEvents(): StreamEvent[] {
  const chunk = (index: number, call: { [key: string]: JsonValue }): StreamEvent => ({
    event: "message",
    data: { choices: [{ index: 0, delta: { tool_calls: [{ index, ...call }] } }] },
  });
  return [
    chunk(0, { id: "call_1", function: { name: "weather_forecast", arguments: "" } }),
    chunk(0, { function: { arguments: '{"city":' } }),
    chunk(1, { id: "call_2", function: { name: "clock_now", arguments: "{}" } }),
    chunk(0, { function: { arguments: '"Ghent"}' } }),
    { event: "message", data: "[DONE]" },
  ];
}

/** The pieces at `path` in each event's data, in stream order. */
function pieces(body: RecordedBody, path: readonly (string | number)[]): unknown[] {
  if (body.kind !== "sse") {
    throw new Error("expected an event stream");
  }
  return body.value.map((event) => valueAt(event.data, path));
}

function valueAt(value: unknown, path: readonly (string | number)[]): unknown {
  return path.reduce<unknown>(
    (current, step) =>
      current !== null && typeof current === "object"
        ? (current as Record<string | number, unknown>)[step]
        : undefined,
    value,
  );
}

const anthropicPiece = ["delta", "partial_json"];
const openAiPiece = ["choices", 0, "delta", "tool_calls", 0, "function", "arguments"];

describe("StreamedJson", () => {
  it("joins each Anthropic block's pieces into its first piece, by the event's index", () => {
    const joined = new StreamedJson([ANTHROPIC_PIECES]).join({
      kind: "sse",
      value: anthropicEvents(),
    });
    expect(pieces(joined, anthropicPiece)).toEqual([
      undefined,
      '{"city": "Ghent"}',
      "",
      "",
      '{"from": "Ghent", "to": "Bruges"}',
      "",
    ]);
  });

  it("joins each OpenAI tool call's pieces by its index, not its list position", () => {
    const joined = new StreamedJson([OPENAI_PIECES]).join({ kind: "sse", value: openAiEvents() });
    expect(pieces(joined, openAiPiece)).toEqual(['{"city":"Ghent"}', "", "{}", "", undefined]);
  });

  it("leaves everything else in the events as it was", () => {
    const joined = new StreamedJson([OPENAI_PIECES]).join({ kind: "sse", value: openAiEvents() });
    expect(joined).toMatchObject({
      value: [
        { data: { choices: [{ delta: { tool_calls: [{ id: "call_1" }] } }] } },
        {},
        { data: { choices: [{ delta: { tool_calls: [{ id: "call_2", index: 1 }] } }] } },
        {},
        { event: "message", data: "[DONE]" },
      ],
    });
  });

  it("leaves bodies that aren't event streams alone", () => {
    const body: RecordedBody = { kind: "json", value: { delta: { partial_json: "{" } } };
    expect(new StreamedJson([ANTHROPIC_PIECES]).join(body)).toBe(body);
  });

  it("refuses a path that doesn't start at an event's data", () => {
    const paths = [
      "request.body.arguments",
      "response.body.delta.partial_json",
      "response.body[*].dataset.partial_json",
    ];
    for (const path of paths) {
      expect(() => new StreamedJson([path])).toThrow(RecordingRefused);
    }
  });
});

describe("scrubbing streamed JSON", () => {
  function streamCall(events: StreamEvent[]): CapturedExchange {
    const body = events
      .map((event) => `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)
      .join("");
    return {
      request: { method: "POST", url: "https://api.example.com/v1/messages", headers: [] },
      response: { status: 200, headers: [["content-type", "text/event-stream"]], body },
    };
  }

  function scrubStream(events: StreamEvent[], input: ScrubPolicyInput): RecordedBody {
    const policy = definePolicy(input);
    const { exchanges } = scrubExchanges([streamCall(events)], { policy });
    const body = exchanges[0]?.response.body;
    if (body === undefined) {
      throw new Error("expected one exchange");
    }
    return body;
  }

  it("keeps the field names with a path that goes on inside the arguments", () => {
    const body = scrubStream(anthropicEvents(), {
      streamedJson: [ANTHROPIC_PIECES],
      userContent: [`${ANTHROPIC_PIECES}.*`],
    });
    const scrubbed = pieces(body, anthropicPiece);
    expect(scrubbed).toEqual([
      undefined,
      '{"city":"<scrubbed:content>"}',
      "",
      "",
      '{"from":"<scrubbed:content>","to":"<scrubbed:content>"}',
      "",
    ]);
  });

  it("numbers the field names when the pieces themselves are declared", () => {
    const body = scrubStream(openAiEvents(), {
      streamedJson: [OPENAI_PIECES],
      userContent: [OPENAI_PIECES],
    });
    expect(pieces(body, openAiPiece)).toEqual([
      '{"field-1":"<scrubbed:content>"}',
      "",
      "{}",
      "",
      undefined,
    ]);
  });

  it("makes arguments that don't parse one placeholder, with the other pieces still empty", () => {
    // Arguments cut off at the token limit.
    const events = anthropicEvents().slice(0, 3);
    const body = scrubStream(events, {
      streamedJson: [ANTHROPIC_PIECES],
      userContent: [`${ANTHROPIC_PIECES}.*`],
    });
    expect(pieces(body, anthropicPiece)).toEqual([undefined, "<scrubbed:content>", ""]);
  });

  it("without streamedJson, still makes each piece a placeholder", () => {
    const body = scrubStream(anthropicEvents(), { userContent: [ANTHROPIC_PIECES] });
    expect(pieces(body, anthropicPiece)).toEqual([
      undefined,
      "",
      "<scrubbed:content>",
      "<scrubbed:content>",
      "<scrubbed:content>",
      "<scrubbed:content>",
    ]);
  });
});
