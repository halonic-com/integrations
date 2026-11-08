import { describe, expect, it } from "vitest";
import { asJsonObject, parseJson, stringField, textsOf } from "./structured.ts";

describe("textsOf", () => {
  it("keeps the text parts in order and leaves the others out", () => {
    const texts = textsOf({
      content: [
        { type: "text", text: "one" },
        { type: "other", kind: "image" },
        { type: "text", text: "two" },
      ],
      isError: false,
    });
    expect(texts).toEqual(["one", "two"]);
  });
});

describe("parseJson", () => {
  it("parses JSON and returns undefined for anything else, without throwing", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson("not json {")).toBeUndefined();
  });
});

describe("asJsonObject", () => {
  it("accepts an object and refuses lists, strings and null", () => {
    expect(asJsonObject({ a: 1 })).toEqual({ a: 1 });
    expect(asJsonObject([1])).toBeUndefined();
    expect(asJsonObject("a")).toBeUndefined();
    expect(asJsonObject(null)).toBeUndefined();
  });
});

describe("stringField", () => {
  it("returns the first named field that holds a non-empty string", () => {
    expect(stringField({ title: "", name: "Setup" }, ["title", "name"])).toBe("Setup");
  });

  it("reads numbers only when asked to", () => {
    expect(stringField({ id: 42 }, ["id"])).toBeUndefined();
    expect(stringField({ id: 42 }, ["id"], true)).toBe("42");
  });

  it("never finds a field on the prototype, such as constructor", () => {
    expect(stringField({}, ["constructor", "toString"])).toBeUndefined();
  });
});
