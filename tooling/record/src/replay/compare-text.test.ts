import { describe, expect, it } from "vitest";
import { sameText, shown, userContentHint } from "./compare-text.ts";

describe("sameText", () => {
  it("matches equal texts", () => {
    expect(sameText("hello", "hello")).toBe(true);
  });

  it("matches two missing texts and nothing else against a missing one", () => {
    expect(sameText(undefined, undefined)).toBe(true);
    expect(sameText("hello", undefined)).toBe(false);
    expect(sameText(undefined, "hello")).toBe(false);
  });

  it("ignores the number of a secret stand-in", () => {
    expect(sameText("token scrubbed-secret-1", "token scrubbed-secret-27")).toBe(true);
  });

  it("ignores the number of an address stand-in, plain or percent-encoded", () => {
    expect(sameText("to person1@example.com", "to person9@example.com")).toBe(true);
    expect(sameText("to=person1%40example.com", "to=person9%40example.com")).toBe(true);
  });

  it("ignores the last digits of a phone stand-in, plain or percent-encoded", () => {
    expect(sameText("+447700900123", "+447700900456")).toBe(true);
    expect(sameText("%2B447700900123", "%2B447700900456")).toBe(true);
  });

  it("keeps the letter case of an escape, so %2B and %2b are different texts", () => {
    expect(sameText("%2B447700900123", "%2b447700900123")).toBe(false);
  });

  it("still tells apart texts that differ in anything else", () => {
    expect(sameText("scrubbed-secret-1", "scrubbed-token-1")).toBe(false);
    expect(sameText("person1@example.com", "person1@example.org")).toBe(false);
    expect(sameText("hello", "Hello")).toBe(false);
  });
});

describe("shown", () => {
  it("writes a missing value as nothing and any other value as JSON", () => {
    expect(shown(undefined)).toBe("nothing");
    expect(shown("a")).toBe('"a"');
    expect(shown(null)).toBe("null");
    expect(shown({ a: [1] })).toBe('{"a":[1]}');
  });
});

describe("userContentHint", () => {
  const hint = "pass the integration's recording policy to replay";

  it("suggests the recording policy when the recording has the placeholder", () => {
    expect(userContentHint("<scrubbed:content>", "my own text")).toContain(hint);
  });

  it("also recognises the placeholder percent-encoded, as in a URL query", () => {
    expect(userContentHint("q=%3Cscrubbed%3Acontent%3E", "q=hello")).toContain(hint);
  });

  it("stays quiet when nothing was sent", () => {
    expect(userContentHint("<scrubbed:content>", undefined)).toBe("");
  });

  it("stays quiet when the recording has no placeholder or is not text", () => {
    expect(userContentHint("plain", "other")).toBe("");
    expect(userContentHint(42, "other")).toBe("");
  });
});
