import { describe, expect, it } from "vitest";
import { firstDifference } from "./compare-value.ts";

describe("firstDifference", () => {
  it("finds nothing between equal values", () => {
    const value = { a: [1, { b: "c" }], d: null };
    expect(firstDifference(value, structuredClone(value), "body")).toBeUndefined();
  });

  it("ignores the order of fields", () => {
    expect(firstDifference({ a: 1, b: 2 }, { b: 2, a: 1 }, "body")).toBeUndefined();
  });

  it("names the path of a changed field", () => {
    expect(firstDifference({ a: { b: 1 } }, { a: { b: 2 } }, "request.body")).toEqual({
      path: "request.body.a.b",
      recorded: 1,
      other: 2,
    });
  });

  it("names the index of a changed array item", () => {
    expect(firstDifference({ items: ["x", "y"] }, { items: ["x", "z"] }, "body")).toEqual({
      path: "body.items[1]",
      recorded: "y",
      other: "z",
    });
  });

  it("reports an item that is missing or extra with undefined on that side", () => {
    expect(firstDifference([1, 2], [1], "body")).toEqual({
      path: "body[1]",
      recorded: 2,
      other: undefined,
    });
    expect(firstDifference({ a: 1 }, { a: 1, b: 2 }, "body")).toEqual({
      path: "body.b",
      recorded: undefined,
      other: 2,
    });
  });

  it("reports the first difference in field name order", () => {
    const difference = firstDifference({ b: 1, a: 1 }, { b: 2, a: 2 }, "body");
    expect(difference?.path).toBe("body.a");
  });

  it("treats strings that differ only in stand-in numbers as equal", () => {
    expect(
      firstDifference({ to: "person1@example.com" }, { to: "person4@example.com" }, "body"),
    ).toBeUndefined();
  });

  it("does not treat an array as an object, or a number as its text", () => {
    expect(firstDifference([], {}, "body")).toEqual({ path: "body", recorded: [], other: {} });
    expect(firstDifference(1, "1", "body")).toEqual({ path: "body", recorded: 1, other: "1" });
    expect(firstDifference(null, {}, "body")).toEqual({ path: "body", recorded: null, other: {} });
  });
});
