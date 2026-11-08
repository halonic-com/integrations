import { describe, expect, it } from "vitest";
import { LineSplitter } from "./line-splitter.ts";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function splitAll(splitter: LineSplitter, pieces: readonly string[]): string[] {
  return pieces.flatMap((piece) => [...splitter.split(encode(piece))].map(decode));
}

describe("LineSplitter", () => {
  it("joins a line that spans several pieces", () => {
    expect(splitAll(new LineSplitter(100), ["ab", "cd", "e\nf"])).toEqual(["abcde"]);
  });

  it("treats CR LF cut between two pieces as one line end", () => {
    expect(splitAll(new LineSplitter(100), ["a\r", "\nb\r", "\n"])).toEqual(["a", "b"]);
  });

  it("treats CR CR as two line ends", () => {
    expect(splitAll(new LineSplitter(100), ["a\r\rb\n"])).toEqual(["a", "", "b"]);
  });

  it("returns lines that don't change when the stream reuses its buffer", () => {
    const splitter = new LineSplitter(100);
    const buffer = encode("abc");
    [...splitter.split(buffer)];
    buffer.fill(0x7a); // "zzz"
    expect([...splitter.split(encode("\n"))].map(decode)).toEqual(["abc"]);
  });

  it("refuses a line longer than the limit, even before it ends", () => {
    const splitter = new LineSplitter(4);
    expect(splitAll(splitter, ["abcd\n"])).toEqual(["abcd"]);
    expect(() => splitAll(splitter, ["abc", "de"])).toThrow("too long");
  });
});
