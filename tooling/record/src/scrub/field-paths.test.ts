import { describe, expect, it } from "vitest";
import { RecordingRefused } from "./context.ts";
import { FieldPaths, formatPath } from "./field-paths.ts";

describe("FieldPaths", () => {
  it("matches a field inside every item of a list", () => {
    const declared = "response.body.messages[*].snippet";
    const paths = new FieldPaths([declared], "response");
    expect(paths.match(["messages", 3, "snippet"])).toBe(declared);
    expect(paths.match(["messages", 3, "id"])).toBeUndefined();
    expect(paths.match(["messages", "snippet"])).toBeUndefined();
  });

  it("matches one item with [n]", () => {
    const paths = new FieldPaths(["response.body.parts[1].data"], "response");
    expect(paths.match(["parts", 1, "data"])).toBeDefined();
    expect(paths.match(["parts", 0, "data"])).toBeUndefined();
  });

  it("matches any field name with *", () => {
    const paths = new FieldPaths(["response.body.files.*.content"], "response");
    expect(paths.match(["files", "notes.txt", "content"])).toBeDefined();
  });

  it("matches lists of lists", () => {
    const paths = new FieldPaths(["request.body.rows[*][*]"], "request");
    expect(paths.match(["rows", 0, 2])).toBeDefined();
  });

  it("matches the data of every stream event", () => {
    const paths = new FieldPaths(["response.body[*].data.delta.text"], "response");
    expect(paths.match([4, "data", "delta", "text"])).toBeDefined();
  });

  it("matches the whole body with just the side", () => {
    const paths = new FieldPaths(["request.body"], "request");
    expect(paths.match([])).toBe("request.body");
    expect(paths.match(["text"])).toBeUndefined();
  });

  it("keeps only the paths for its own side", () => {
    const paths = new FieldPaths(["request.body.raw"], "response");
    expect(paths.match(["raw"])).toBeUndefined();
  });

  it.each([
    ["no side", "messages[*].snippet"],
    ["an old-style list", "response.body.messages[].snippet"],
    ["an empty name", "response.body..snippet"],
  ])("refuses a path with %s, so a typo can't leave content in the file", (_label, path) => {
    expect(() => new FieldPaths([path], "response")).toThrow(RecordingRefused);
  });

  it("formats a position for reports", () => {
    expect(formatPath(["messages", 0, "snippet"])).toBe("messages[0].snippet");
    expect(formatPath([2, "id"])).toBe("[2].id");
  });
});
