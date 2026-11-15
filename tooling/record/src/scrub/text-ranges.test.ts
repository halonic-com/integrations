import { describe, expect, it } from "vitest";
import { mergeRanges, replaceRanges } from "./text-ranges.ts";

describe("mergeRanges", () => {
  it("sorts ranges by start", () => {
    expect(
      mergeRanges([
        { start: 10, end: 12 },
        { start: 0, end: 2 },
      ]),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 10, end: 12 },
    ]);
  });

  it("merges overlapping ranges", () => {
    expect(
      mergeRanges([
        { start: 0, end: 5 },
        { start: 3, end: 8 },
      ]),
    ).toEqual([{ start: 0, end: 8 }]);
  });

  it("merges touching ranges", () => {
    expect(
      mergeRanges([
        { start: 0, end: 4 },
        { start: 4, end: 6 },
      ]),
    ).toEqual([{ start: 0, end: 6 }]);
  });

  it("keeps the longer end when one range lies inside another", () => {
    expect(
      mergeRanges([
        { start: 0, end: 10 },
        { start: 2, end: 4 },
      ]),
    ).toEqual([{ start: 0, end: 10 }]);
  });

  it("keeps ranges with a gap between them apart", () => {
    expect(
      mergeRanges([
        { start: 0, end: 2 },
        { start: 3, end: 5 },
      ]),
    ).toHaveLength(2);
  });

  it("returns nothing for no ranges, and doesn't change its input", () => {
    expect(mergeRanges([])).toEqual([]);
    const input = [
      { start: 5, end: 6 },
      { start: 0, end: 1 },
    ];
    mergeRanges(input);
    expect(input[0]).toEqual({ start: 5, end: 6 });
  });
});

describe("replaceRanges", () => {
  const upper = (piece: string) => piece.toUpperCase();

  it("replaces each range and keeps the text between", () => {
    const ranges = [
      { start: 0, end: 1 },
      { start: 7, end: 8 },
    ];
    expect(replaceRanges("a bcde f", ranges, upper)).toBe("A bcde F");
  });

  it("replaces a value found twice only once", () => {
    const seen: string[] = [];
    const result = replaceRanges(
      "key=abcdef;",
      [
        { start: 4, end: 8 },
        { start: 6, end: 10 },
      ],
      (piece) => {
        seen.push(piece);
        return "***";
      },
    );
    expect(result).toBe("key=***;");
    expect(seen).toEqual(["abcdef"]);
  });

  it("works when the ranges come out of order", () => {
    const ranges = [
      { start: 4, end: 5 },
      { start: 0, end: 1 },
    ];
    expect(replaceRanges("abcde", ranges, upper)).toBe("AbcdE");
  });

  it("returns the text as it is when there are no ranges", () => {
    expect(replaceRanges("unchanged", [], upper)).toBe("unchanged");
  });

  it("can replace the whole text", () => {
    expect(replaceRanges("secret", [{ start: 0, end: 6 }], () => "x")).toBe("x");
  });
});
