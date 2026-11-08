import { describe, expect, it } from "vitest";
import { cutText, defaultHits, hitLimit, maxHits } from "./limits.ts";

describe("hitLimit", () => {
  it("uses the default when the caller doesn't say", () => {
    expect(hitLimit(undefined)).toBe(defaultHits);
    expect(hitLimit(Number.NaN)).toBe(defaultHits);
  });

  it("keeps a limit in range, whole", () => {
    expect(hitLimit(3)).toBe(3);
    expect(hitLimit(3.7)).toBe(3);
  });

  it("never asks for fewer than one or more than the maximum", () => {
    expect(hitLimit(0)).toBe(1);
    expect(hitLimit(-5)).toBe(1);
    expect(hitLimit(1_000)).toBe(maxHits);
    expect(hitLimit(Number.POSITIVE_INFINITY)).toBe(maxHits);
  });
});

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
});
