import { describe, expect, it } from "vitest";
import { EventStream, type ServerSentEvent } from "./event-stream.ts";
import { EventStreamError } from "./event-stream-error.ts";
import { fakeByteStream } from "./test/fake-byte-stream.ts";

async function readAll(stream: EventStream): Promise<ServerSentEvent[]> {
  const events: ServerSentEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function eventsOf(pieces: readonly (string | Uint8Array)[]): Promise<ServerSentEvent[]> {
  return readAll(new EventStream(fakeByteStream(pieces)));
}

const message = (data: string, lastEventId = ""): ServerSentEvent => ({
  type: "message",
  data,
  lastEventId,
});

describe("EventStream", () => {
  it("reads events with type, data and id", async () => {
    const events = await eventsOf(["event: ping\ndata: one\n\nid: 7\ndata: two\n\n"]);
    expect(events).toEqual([{ type: "ping", data: "one", lastEventId: "" }, message("two", "7")]);
  });

  it("joins several data lines with a line feed", async () => {
    expect(await eventsOf(["data: first\ndata:second\ndata\n\n"])).toEqual([
      message("first\nsecond\n"),
    ]);
  });

  it.each([
    ["LF", "data: a\n\ndata: b\n\n"],
    ["CR LF", "data: a\r\n\r\ndata: b\r\n\r\n"],
    ["CR", "data: a\r\rdata: b\r\r"],
  ])("accepts %s line ends", async (_name, text) => {
    expect(await eventsOf([text])).toEqual([message("a"), message("b")]);
  });

  it("reads the same events whatever the pieces are cut into", async () => {
    const text = 'id: 1\r\ndata: héllo 🙂\r\n\r\n: comment\r\ndata: {"a":1}\r\n\r\n';
    const bytes = new TextEncoder().encode(text);
    const whole = await eventsOf([bytes]);
    for (let cut = 1; cut < bytes.length; cut += 1) {
      // Every cut, including inside CR LF and inside a multi-byte character.
      expect(await eventsOf([bytes.subarray(0, cut), bytes.subarray(cut)])).toEqual(whole);
    }
    expect(whole).toEqual([message("héllo 🙂", "1"), message('{"a":1}', "1")]);
  });

  it("reads a stream that arrives one byte at a time", async () => {
    const bytes = new TextEncoder().encode("data: é\r\n\r\n");
    const pieces = [...bytes].map((byte) => new Uint8Array([byte]));
    expect(await eventsOf(pieces)).toEqual([message("é")]);
  });

  it("skips comments, unknown fields and retry", async () => {
    expect(await eventsOf([": keep-alive\nretry: 1000\nfoo: bar\ndata: x\n\n"])).toEqual([
      message("x"),
    ]);
  });

  it("removes only one space after the colon", async () => {
    expect(await eventsOf(["data:  two spaces\n\n"])).toEqual([message(" two spaces")]);
  });

  it("removes a byte order mark at the start of the stream only", async () => {
    expect(await eventsOf(["\uFEFFdata: a\n\ndata: \uFEFFb\n\n"])).toEqual([
      message("a"),
      message("\uFEFFb"),
    ]);
  });

  it("dispatches an event with an empty data line, as MCP servers send to set the id", async () => {
    expect(await eventsOf(["id: start\ndata:\n\n"])).toEqual([message("", "start")]);
  });

  it("keeps the id of an event without data, but doesn't dispatch it", async () => {
    const stream = new EventStream(fakeByteStream(["id: 5\n\n"]));
    expect(await readAll(stream)).toEqual([]);
    expect(stream.lastEventId).toBe("5");
  });

  it("ignores an id that holds a NUL", async () => {
    expect(await eventsOf(["id: 1\n\nid: a\0b\ndata: x\n\n"])).toEqual([message("x", "1")]);
  });

  it("drops an event the stream ends in the middle of, and its id", async () => {
    const stream = new EventStream(fakeByteStream(["id: 1\ndata: done\n\nid: 2\ndata: cut"]));
    expect(await readAll(stream)).toEqual([message("done", "1")]);
    expect(stream.lastEventId).toBe("1");
  });

  it("releases the stream after its end", async () => {
    const body = fakeByteStream(["data: a\n\n"]);
    await readAll(new EventStream(body));
    expect(body.released).toBe(true);
    expect(body.cancelled).toBe(false);
  });

  it("cancels the stream when the caller stops early", async () => {
    const body = fakeByteStream(["data: a\n\n", "data: b\n\n"]);
    for await (const _event of new EventStream(body)) {
      break;
    }
    expect(body.cancelled).toBe(true);
  });

  it("passes a dropped connection through unchanged and keeps the last id to resume from", async () => {
    const drop = new Error("connection reset");
    const stream = new EventStream(fakeByteStream(["id: 3\ndata: a\n\nid: 4\ndata: b"], drop));
    const seen: ServerSentEvent[] = [];
    await expect(async () => {
      for await (const event of stream) seen.push(event);
    }).rejects.toBe(drop);
    expect(seen).toEqual([message("a", "3")]);
    // Event 4 was cut off, so a resume starts after event 3 and gets event 4 again.
    expect(stream.lastEventId).toBe("3");
  });

  it("keeps an id for the next events until a new one comes", async () => {
    expect(await eventsOf(["id: 7\ndata: a\n\ndata: b\n\n"])).toEqual([
      message("a", "7"),
      message("b", "7"),
    ]);
  });

  it("refuses an event larger than the limit and cancels the stream", async () => {
    const body = fakeByteStream(["data: 12345\n", "data: 67890\n\n"]);
    const reading = readAll(new EventStream(body, { maxEventBytes: 16 }));
    await expect(reading).rejects.toMatchObject({ name: "EventStreamError", code: "too-large" });
    expect(body.cancelled).toBe(true);
  });

  it("refuses a line that grows past the limit before it ends", async () => {
    const pieces = Array.from({ length: 10 }, () => "data: xxxxxxxx");
    const reading = readAll(new EventStream(fakeByteStream(pieces), { maxEventBytes: 64 }));
    await expect(reading).rejects.toBeInstanceOf(EventStreamError);
  });

  it("starts the size count again for each event", async () => {
    const pieces = Array.from({ length: 20 }, () => "data: 1234\n\n");
    expect(
      await readAll(new EventStream(fakeByteStream(pieces), { maxEventBytes: 16 })),
    ).toHaveLength(20);
  });

  it("refuses text that isn't UTF-8, without quoting it", async () => {
    const reading = eventsOf([new Uint8Array([0x64, 0x61, 0x74, 0x61, 0x3a, 0xff, 0x0a])]);
    await expect(reading).rejects.toMatchObject({
      code: "bad-encoding",
      message: "The event stream isn't valid UTF-8.",
    });
  });

  it("reads the body of a real Response, which must fit ByteStream", async () => {
    const body = new Response("id: 1\ndata: real\n\n").body;
    if (body === null) throw new Error("The response has no body.");
    expect(await readAll(new EventStream(body))).toEqual([message("real", "1")]);
  });

  it("can be read only once", async () => {
    const stream = new EventStream(fakeByteStream([]));
    await readAll(stream);
    await expect(readAll(stream)).rejects.toThrow("only once");
  });
});
