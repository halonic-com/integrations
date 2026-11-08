import { describe, expect, it } from "vitest";
import { decodeUtf8 } from "./utf8.ts";

const encode = (text: string) => new TextEncoder().encode(text);

describe("decodeUtf8", () => {
  it.each([
    ["", "empty"],
    ["plain ascii", "one byte"],
    ["café", "two bytes"],
    ["€ and ✓", "three bytes"],
    ["🙂 smile", "four bytes, a surrogate pair in JavaScript"],
  ])("decodes %j (%s) like TextDecoder", (text) => {
    expect(decodeUtf8(encode(text))).toBe(text);
  });

  it("decodes text longer than one piece of code points", () => {
    const text = "é".repeat(10_000);
    expect(decodeUtf8(encode(text))).toBe(text);
  });

  it.each([
    [[0x80], "a stray continuation byte"],
    [[0xc3], "a sequence cut short"],
    [[0xc3, 0x41], "a lead byte followed by a non-continuation byte"],
    [[0xc0, 0xaf], "an overlong two-byte form"],
    [[0xe0, 0x80, 0xaf], "an overlong three-byte form"],
    [[0xed, 0xa0, 0x80], "an encoded surrogate"],
    [[0xf4, 0x90, 0x80, 0x80], "a value above U+10FFFF"],
    [[0xff], "a byte that is never valid"],
  ])("refuses %j (%s)", (bytes) => {
    expect(decodeUtf8(new Uint8Array(bytes))).toBeUndefined();
  });
});
