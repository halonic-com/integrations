import { describe, expect, it } from "vitest";
import { cutText } from "./text.ts";

describe("cutText", () => {
  it("leaves a short text as it is", () => {
    expect(cutText("abc", 3)).toBe("abc");
  });

  it("cuts a long text to the limit, ending with an ellipsis", () => {
    const cut = cutText("abcdef", 4);
    expect(cut).toBe("abc…");
    expect(cut.length).toBe(4);
  });

  it("never leaves half of a two-unit character", () => {
    // "a😀b": the emoji is two UTF-16 units, at index 1 and 2.
    expect(cutText("a😀bcd", 3)).toBe("a…");
  });

  it("refuses a limit below one character", () => {
    expect(() => cutText("abc", 0)).toThrow(RangeError);
    expect(() => cutText("", -1)).toThrow(RangeError);
    expect(() => cutText("abc", Number.NaN)).toThrow(RangeError);
  });

  it("cuts to the ellipsis alone at a limit of one", () => {
    expect(cutText("abc", 1)).toBe("…");
  });
});
