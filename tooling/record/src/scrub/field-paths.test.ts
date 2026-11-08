import { describe, expect, it } from "vitest";
import { FieldPaths, formatPath } from "./field-paths.ts";

describe("FieldPaths", () => {
  it("matches a field inside every item of a list", () => {
    const paths = new FieldPaths(["messages[].snippet"]);
    expect(paths.match(["messages", 3, "snippet"])).toBe("messages[].snippet");
    expect(paths.match(["messages", 3, "id"])).toBeUndefined();
    expect(paths.match(["messages", "snippet"])).toBeUndefined();
  });

  it("matches any field name with *", () => {
    const paths = new FieldPaths(["files.*.content"]);
    expect(paths.match(["files", "notes.txt", "content"])).toBe("files.*.content");
  });

  it("matches lists of lists", () => {
    expect(new FieldPaths(["rows[][]"]).match(["rows", 0, 2])).toBe("rows[][]");
  });

  it("matches the whole body with $", () => {
    expect(new FieldPaths(["$"]).match([])).toBe("$");
    expect(new FieldPaths(["$"]).match(["text"])).toBeUndefined();
  });

  it("formats a position for reports", () => {
    expect(formatPath(["messages", 0, "snippet"])).toBe("messages[0].snippet");
    expect(formatPath([2, "id"])).toBe("[2].id");
  });
});
