import { describe, expect, it } from "vitest";
import {
  formatRecording,
  RECORDING_FORMAT,
  type RecordingFile,
  recordingFileSchema,
} from "./format.ts";

/** A small file with every body kind, as the recorder saves it. */
function sampleFile(): RecordingFile {
  return {
    format: RECORDING_FORMAT,
    integration: "fake-mail",
    scenario: "list-and-send",
    exchanges: [
      {
        transport: "http",
        request: {
          method: "GET",
          url: "https://mail.example.com/v1/messages?pageToken=scrubbed-secret-1",
          headers: { authorization: "Bearer <scrubbed:secret>" },
          body: { kind: "empty" },
        },
        response: {
          status: 200,
          headers: { "content-type": "application/json" },
          body: {
            kind: "json",
            value: { messages: [{ id: "m1", subject: "<scrubbed:content>" }] },
          },
        },
      },
      {
        transport: "http",
        request: {
          method: "POST",
          url: "https://mail.example.com/v1/send",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: { kind: "form", value: [["to", "person1@example.com"]] },
        },
        response: {
          status: 200,
          headers: { "content-type": "text/event-stream" },
          body: { kind: "sse", value: [{ event: "done", data: { ok: true } }] },
        },
      },
      {
        transport: "http",
        request: {
          method: "GET",
          url: "https://mail.example.com/readme",
          headers: {},
          body: { kind: "empty" },
        },
        response: {
          status: 404,
          headers: { "content-type": "text/plain" },
          body: { kind: "text", contentType: "text/plain", value: "Fake page not found" },
        },
      },
    ],
    scrubReport: [
      { rule: "secret-header", path: "exchanges[0].request.headers.authorization", count: 1 },
    ],
  };
}

/** Reads a recording file's text the way the conformance suite does. */
function readRecording(text: string) {
  return recordingFileSchema.safeParse(JSON.parse(text));
}

describe("formatRecording", () => {
  it("sorts keys at every level, indents by 2 and ends with a line break", () => {
    const text = formatRecording(sampleFile());
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.split("\n")[1]).toBe('  "exchanges": [');
    const topLevelKeys = [...text.matchAll(/^ {2}"(\w+)":/gm)].map((match) => match[1]);
    expect(topLevelKeys).toEqual(["exchanges", "format", "integration", "scenario", "scrubReport"]);
    expect(text.indexOf('"request"')).toBeLessThan(text.indexOf('"response"'));
    expect(text.indexOf('"body"')).toBeLessThan(text.indexOf('"headers"'));
  });

  it("gives the same text whatever order the keys were added in", () => {
    const file = sampleFile();
    const reversed = JSON.parse(JSON.stringify(file), (_key, value: unknown) =>
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ) as RecordingFile;
    expect(formatRecording(reversed)).toBe(formatRecording(file));
  });

  it("keeps lists in their order", () => {
    const text = formatRecording(sampleFile());
    const urls = [...text.matchAll(/"url": "([^"]+)"/g)].map((match) => match[1]);
    expect(urls).toEqual([
      "https://mail.example.com/v1/messages?pageToken=scrubbed-secret-1",
      "https://mail.example.com/v1/send",
      "https://mail.example.com/readme",
    ]);
  });

  it("sorts by character code, the same on every machine", () => {
    // `localeCompare` would put `apple` first on most machines.
    const file = sampleFile();
    const first = file.exchanges[0];
    if (first === undefined) {
      throw new Error("expected an exchange");
    }
    const withKeys: RecordingFile = {
      ...file,
      exchanges: [
        {
          ...first,
          response: {
            ...first.response,
            body: { kind: "json", value: { apple: 1, Zebra: 2, _id: 3 } },
          },
        },
      ],
    };
    const text = formatRecording(withKeys);
    expect(text.indexOf('"Zebra"')).toBeLessThan(text.indexOf('"_id"'));
    expect(text.indexOf('"_id"')).toBeLessThan(text.indexOf('"apple"'));
  });

  it("writes text that reads back to the same file", () => {
    const text = formatRecording(sampleFile());
    const read = readRecording(text);
    expect(read.success).toBe(true);
    expect(read.data).toEqual(sampleFile());
    expect(read.data && formatRecording(read.data)).toBe(text);
  });
});

describe("recordingFileSchema", () => {
  it("accepts a file with every body kind", () => {
    expect(recordingFileSchema.safeParse(sampleFile()).success).toBe(true);
  });

  it("refuses text that isn't JSON", () => {
    const text = formatRecording(sampleFile());
    expect(() => readRecording(text.slice(0, -10))).toThrow(SyntaxError);
  });

  /** A field to change, and the value that must make the file invalid. */
  const malformed: [string, (file: RecordingFile) => unknown][] = [
    ["another format version", (file) => ({ ...file, format: "halonic.recording/2" })],
    ["an unknown top-level field", (file) => ({ ...file, recordedBy: "fake" })],
    [
      "an integration name that isn't kebab-case",
      (file) => ({ ...file, integration: "Fake_Mail" }),
    ],
    ["a scenario name with a path in it", (file) => ({ ...file, scenario: "../list" })],
    ["no exchanges list", ({ exchanges: _, ...rest }) => rest],
    ["an unknown transport", (file) => withExchange(file, { transport: "stdio" })],
    ["a lower-case method", (file) => withRequest(file, { method: "get" })],
    ["a URL that isn't one", (file) => withRequest(file, { url: "not a url" })],
    [
      "a header name with upper case",
      (file) => withRequest(file, { headers: { Authorization: "x" } }),
    ],
    ["an unknown body kind", (file) => withRequest(file, { body: { kind: "html", value: "<p>" } })],
    [
      "a body with extra fields",
      (file) => withRequest(file, { body: { kind: "empty", raw: "x" } }),
    ],
    [
      "a form field that isn't a pair",
      (file) => withRequest(file, { body: { kind: "form", value: [["to"]] } }),
    ],
    [
      "a text body without its content type",
      (file) => withRequest(file, { body: { kind: "text", value: "x" } }),
    ],
    [
      "a stream event with extra fields",
      (file) =>
        withResponse(file, { body: { kind: "sse", value: [{ event: "x", data: 1, id: "1" }] } }),
    ],
    ["a status below 100", (file) => withResponse(file, { status: 99 })],
    ["a status above 599", (file) => withResponse(file, { status: 600 })],
    ["a status that isn't whole", (file) => withResponse(file, { status: 200.5 })],
    [
      "a report entry with a count of 0",
      (file) => ({ ...file, scrubReport: [{ rule: "email", path: "x", count: 0 }] }),
    ],
    // The report names rules and places, never values: a value field is refused.
    [
      "a report entry with a value",
      (file) => ({ ...file, scrubReport: [{ rule: "email", path: "x", count: 1, value: "fake" }] }),
    ],
  ];

  it.each(malformed)("refuses a file with %s", (_name, change) => {
    const text = JSON.stringify(change(sampleFile()));
    expect(readRecording(text).success).toBe(false);
  });
});

function withExchange(file: RecordingFile, change: object): unknown {
  const [first, ...rest] = file.exchanges;
  return { ...file, exchanges: [{ ...first, ...change }, ...rest] };
}

function withRequest(file: RecordingFile, change: object): unknown {
  const [first, ...rest] = file.exchanges;
  return { ...file, exchanges: [{ ...first, request: { ...first?.request, ...change } }, ...rest] };
}

function withResponse(file: RecordingFile, change: object): unknown {
  const [first, ...rest] = file.exchanges;
  return {
    ...file,
    exchanges: [{ ...first, response: { ...first?.response, ...change } }, ...rest],
  };
}
