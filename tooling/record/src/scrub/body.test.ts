import { describe, expect, it } from "vitest";
import { FAKE, testContext } from "../test/fakes.ts";
import { parseBody, scrubBody } from "./body.ts";
import { RecordingRefused } from "./context.ts";
import { FieldPaths } from "./field-paths.ts";

const json: [string, string][] = [["Content-Type", "application/json; charset=utf-8"]];
const form: [string, string][] = [["content-type", "application/x-www-form-urlencoded"]];
const html: [string, string][] = [["content-type", "text/html"]];
const sse: [string, string][] = [["content-type", "text/event-stream"]];
const noUserContent = new FieldPaths([], "request");

describe("parseBody", () => {
  it("reads an absent or empty body as empty", () => {
    expect(parseBody(undefined, json, [], "body")).toEqual({ kind: "empty" });
    expect(parseBody("", html, [], "body")).toEqual({ kind: "empty" });
  });

  it("reads JSON, including +json types", () => {
    expect(parseBody('{"a":1}', json, [], "body")).toEqual({ kind: "json", value: { a: 1 } });
    expect(parseBody("[1]", [["content-type", "application/problem+json"]], [], "body")).toEqual({
      kind: "json",
      value: [1],
    });
  });

  it("reads form data", () => {
    expect(parseBody("a=1&b=two", form, [], "body")).toEqual({
      kind: "form",
      value: [
        ["a", "1"],
        ["b", "two"],
      ],
    });
  });

  it("refuses a body it can't parse", () => {
    expect(() => parseBody("<p>hi</p>", html, [], "body")).toThrow(RecordingRefused);
    expect(() => parseBody("raw", [], [], "body")).toThrow(RecordingRefused);
  });

  it("reads an event stream", () => {
    expect(parseBody('data: {"a":1}\n\n', sse, [], "body")).toEqual({
      kind: "sse",
      value: [{ event: "message", data: { a: 1 } }],
    });
  });

  it("refuses JSON that doesn't parse", () => {
    expect(() => parseBody("{oops", json, [], "body")).toThrow(RecordingRefused);
  });

  it("keeps an allowed text type as text", () => {
    expect(parseBody("<p>hi</p>", html, ["text/html"], "body")).toEqual({
      kind: "text",
      contentType: "text/html",
      value: "<p>hi</p>",
    });
  });
});

describe("scrubBody", () => {
  it("replaces secret form fields, as in an OAuth token request", () => {
    const body = parseBody(
      `grant_type=refresh_token&refresh_token=${FAKE.plainKey}&client_secret=abc&code=xyz`,
      form,
      [],
      "body",
    );
    expect(scrubBody(body, "body", noUserContent, testContext())).toEqual({
      kind: "form",
      value: [
        ["grant_type", "refresh_token"],
        ["refresh_token", "scrubbed-secret-1"],
        ["client_secret", "scrubbed-secret-2"],
        ["code", "scrubbed-secret-3"],
      ],
    });
  });

  it("replaces declared user content in form data", () => {
    const body = parseBody("channel=C1&text=Hello%20there", form, [], "body");
    const paths = new FieldPaths(["request.body.text"], "request");
    expect(scrubBody(body, "body", paths, testContext())).toEqual({
      kind: "form",
      value: [
        ["channel", "C1"],
        ["text", "<scrubbed:content>"],
      ],
    });
  });

  it("applies the text rules to an allowed text body", () => {
    const body = parseBody(`<p>${FAKE.email}</p>`, html, ["text/html"], "body");
    expect(scrubBody(body, "body", noUserContent, testContext())).toEqual({
      kind: "text",
      contentType: "text/html",
      value: "<p>person1@example.com</p>",
    });
  });

  it("replaces a whole text body declared as user content", () => {
    const body = parseBody("Dear diary", [["content-type", "text/plain"]], ["text/plain"], "b");
    const paths = new FieldPaths(["request.body"], "request");
    expect(scrubBody(body, "b", paths, testContext())).toEqual({
      kind: "text",
      contentType: "text/plain",
      value: "<scrubbed:content>",
    });
  });

  it("scrubs inside every stream event and replaces declared streamed text", () => {
    const stream = [
      "event: message_start",
      `data: {"message":{"id":"msg_1","user":"${FAKE.email}"}}`,
      "",
      "event: content_block_delta",
      'data: {"delta":{"type":"text_delta","text":"Dinner on Friday?"}}',
      "",
      "event: content_block_delta",
      'data: {"delta":{"type":"text_delta","text":" See you there"}}',
      "",
    ].join("\n");
    const body = parseBody(stream, sse, [], "body");
    const paths = new FieldPaths(["response.body[*].data.delta.text"], "response");
    expect(scrubBody(body, "body", paths, testContext())).toEqual({
      kind: "sse",
      value: [
        { event: "message_start", data: { message: { id: "msg_1", user: "person1@example.com" } } },
        {
          event: "content_block_delta",
          data: { delta: { type: "text_delta", text: "<scrubbed:content>" } },
        },
        {
          event: "content_block_delta",
          data: { delta: { type: "text_delta", text: "<scrubbed:content>" } },
        },
      ],
    });
  });

  it("applies the text rules to stream data that isn't JSON", () => {
    const body = parseBody(`data: token ${FAKE.openAiKey}\n\ndata: [DONE]\n\n`, sse, [], "b");
    expect(scrubBody(body, "b", noUserContent, testContext())).toEqual({
      kind: "sse",
      value: [
        { event: "message", data: "token scrubbed-secret-1" },
        { event: "message", data: "[DONE]" },
      ],
    });
  });
});
