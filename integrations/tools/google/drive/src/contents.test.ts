import { describe, expect, it } from "vitest";
import { readPlan, textPart } from "./contents.ts";

describe("readPlan", () => {
  it("exports Google's own files, a Doc as Markdown first, then plain text", () => {
    expect(readPlan("application/vnd.google-apps.document")).toEqual({
      kind: "export",
      formats: ["text/markdown", "text/plain"],
    });
    expect(readPlan("application/vnd.google-apps.spreadsheet")).toEqual({
      kind: "export",
      formats: ["text/csv"],
    });
  });

  it("downloads text files, also JSON, XML and YAML", () => {
    expect(readPlan("text/plain")).toEqual({ kind: "download", format: "text/plain" });
    expect(readPlan("application/json")).toEqual({ kind: "download", format: "application/json" });
    expect(readPlan("application/x-yaml")).toEqual({
      kind: "download",
      format: "application/x-yaml",
    });
    expect(readPlan("application/ld+json")).toEqual({
      kind: "download",
      format: "application/ld+json",
    });
    expect(readPlan("image/svg+xml")).toEqual({ kind: "download", format: "image/svg+xml" });
  });

  it("calls everything else binary, also a missing type and a type named like an object key", () => {
    expect(readPlan("application/pdf")).toEqual({ kind: "binary" });
    const office = "application/vnd.openxmlformats-officedocument";
    expect(readPlan(`${office}.wordprocessingml.document`)).toEqual({ kind: "binary" });
    expect(readPlan(`${office}.spreadsheetml.sheet`)).toEqual({ kind: "binary" });
    expect(readPlan(`${office}.presentationml.presentation`)).toEqual({ kind: "binary" });
    expect(readPlan(undefined)).toEqual({ kind: "binary" });
    expect(readPlan("constructor")).toEqual({ kind: "binary" });
  });
});

describe("textPart", () => {
  it("returns the whole text without nextOffset when it fits", () => {
    expect(textPart("short", 0, 100)).toEqual({ content: "short" });
  });

  it("cuts a long text and says where the next part starts", () => {
    expect(textPart("abcdefgh", 0, 3)).toEqual({ content: "abc", nextOffset: 3 });
    expect(textPart("abcdefgh", 3, 3)).toEqual({ content: "def", nextOffset: 6 });
    expect(textPart("abcdefgh", 6, 3)).toEqual({ content: "gh" });
  });

  it("returns nothing past the end", () => {
    expect(textPart("abc", 10, 3)).toEqual({ content: "" });
  });

  it("doesn't split an emoji between two parts", () => {
    const text = "ab😀cd"; // the emoji is two UTF-16 code units, at 2 and 3
    expect(textPart(text, 0, 3)).toEqual({ content: "ab", nextOffset: 2 });
    expect(textPart(text, 2, 3)).toEqual({ content: "😀c", nextOffset: 5 });
  });

  it("starts after an emoji when the offset lands inside it", () => {
    expect(textPart("ab😀cd", 3, 2)).toEqual({ content: "cd" });
  });

  it("still moves forward when one character is asked for at an emoji", () => {
    expect(textPart("😀", 0, 1).nextOffset).toBe(1);
  });
});
