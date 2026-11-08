import { describe, expect, it } from "vitest";
import { FAKE, testContext } from "../test/fakes.ts";
import { parseBody, scrubBody } from "./body.ts";
import { RecordingRefused } from "./context.ts";
import { FieldPaths } from "./field-paths.ts";

const json: [string, string][] = [["Content-Type", "application/json; charset=utf-8"]];
const form: [string, string][] = [["content-type", "application/x-www-form-urlencoded"]];
const html: [string, string][] = [["content-type", "text/html"]];

describe("parseBody", () => {
  it("reads an absent or empty body as empty", () => {
    expect(parseBody(undefined, json, [], "body")).toEqual({ type: "empty" });
    expect(parseBody("", html, [], "body")).toEqual({ type: "empty" });
  });

  it("reads JSON, including +json types", () => {
    expect(parseBody('{"a":1}', json, [], "body")).toEqual({ type: "json", value: { a: 1 } });
    expect(parseBody("[1]", [["content-type", "application/problem+json"]], [], "body")).toEqual({
      type: "json",
      value: [1],
    });
  });

  it("reads form data", () => {
    expect(parseBody("a=1&b=two", form, [], "body")).toEqual({
      type: "form",
      fields: [
        ["a", "1"],
        ["b", "two"],
      ],
    });
  });

  it("refuses a body it can't parse", () => {
    expect(() => parseBody("<p>hi</p>", html, [], "body")).toThrow(RecordingRefused);
    expect(() => parseBody("raw", [], [], "body")).toThrow(RecordingRefused);
  });

  it("refuses JSON that doesn't parse", () => {
    expect(() => parseBody("{oops", json, [], "body")).toThrow(RecordingRefused);
  });

  it("keeps an allowed text type as text", () => {
    expect(parseBody("<p>hi</p>", html, ["text/html"], "body")).toEqual({
      type: "text",
      contentType: "text/html",
      text: "<p>hi</p>",
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
    expect(scrubBody(body, "body", new FieldPaths([]), testContext())).toEqual({
      type: "form",
      fields: [
        ["grant_type", "refresh_token"],
        ["refresh_token", "scrubbed-secret-1"],
        ["client_secret", "scrubbed-secret-2"],
        ["code", "scrubbed-secret-3"],
      ],
    });
  });

  it("replaces declared user content in form data", () => {
    const body = parseBody("channel=C1&text=Hello%20there", form, [], "body");
    expect(scrubBody(body, "body", new FieldPaths(["text"]), testContext())).toEqual({
      type: "form",
      fields: [
        ["channel", "C1"],
        ["text", "scrubbed user content"],
      ],
    });
  });

  it("applies the text rules to an allowed text body", () => {
    const body = parseBody(`<p>${FAKE.email}</p>`, html, ["text/html"], "body");
    expect(scrubBody(body, "body", new FieldPaths([]), testContext())).toEqual({
      type: "text",
      contentType: "text/html",
      text: "<p>person-1@example.com</p>",
    });
  });

  it("replaces a whole text body declared as user content with $", () => {
    const body = parseBody("Dear diary", [["content-type", "text/plain"]], ["text/plain"], "b");
    expect(scrubBody(body, "b", new FieldPaths(["$"]), testContext())).toEqual({
      type: "text",
      contentType: "text/plain",
      text: "scrubbed user content",
    });
  });
});
