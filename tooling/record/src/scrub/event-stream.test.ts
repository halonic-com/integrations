import { describe, expect, it } from "vitest";
import { parseEventStream } from "./event-stream.ts";

describe("parseEventStream", () => {
  it("reads named events and parses JSON data", () => {
    const text = 'event: ping\ndata: {"n":1}\n\nevent: done\ndata: [1,2]\n\n';
    expect(parseEventStream(text)).toEqual([
      { event: "ping", data: { n: 1 } },
      { event: "done", data: [1, 2] },
    ]);
  });

  it("names an event without an event line 'message'", () => {
    expect(parseEventStream("data: hello\n\n")).toEqual([{ event: "message", data: "hello" }]);
  });

  it("joins several data lines with a line break", () => {
    expect(parseEventStream("data: one\ndata: two\n\n")).toEqual([
      { event: "message", data: "one\ntwo" },
    ]);
  });

  it("accepts CRLF and CR line endings", () => {
    expect(parseEventStream("data: a\r\n\r\ndata: b\r\rdata: c")).toEqual([
      { event: "message", data: "a" },
      { event: "message", data: "b" },
      { event: "message", data: "c" },
    ]);
  });

  it("leaves out comments, ids, retries and events without data", () => {
    const text = ": keep-alive\n\nid: 7\nretry: 1000\ndata: x\n\nevent: empty\n\n";
    expect(parseEventStream(text)).toEqual([{ event: "message", data: "x" }]);
  });

  it("keeps data as text when it only looks like JSON", () => {
    expect(parseEventStream("data: {oops\n\n")).toEqual([{ event: "message", data: "{oops" }]);
  });
});
