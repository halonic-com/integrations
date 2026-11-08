import { describe, expect, it } from "vitest";
import { RecordingRefused } from "./context.ts";
import { isQueryPath, QueryPaths } from "./query-paths.ts";

describe("QueryPaths", () => {
  it("matches the parameter a path names", () => {
    const paths = new QueryPaths(["request.query.q", "request.query.pageToken"]);
    expect(paths.match("q")).toBe("request.query.q");
    expect(paths.match("pageToken")).toBe("request.query.pageToken");
    expect(paths.match("Q")).toBeUndefined();
  });

  it("leaves body paths to FieldPaths", () => {
    const paths = new QueryPaths(["request.body.q", "response.body.q"]);
    expect(paths.match("q")).toBeUndefined();
  });

  it.each([
    ["no parameter name", "request.query"],
    ["a wildcard", "request.query.*"],
    ["a step after the name", "request.query.q.text"],
    ["a list step", "request.query.q[0]"],
  ])("refuses a path with %s, so a typo can't leave content in the file", (_label, path) => {
    expect(() => new QueryPaths([path])).toThrow(RecordingRefused);
  });
});

describe("isQueryPath", () => {
  it("tells query paths from body paths", () => {
    expect(isQueryPath("request.query.q")).toBe(true);
    expect(isQueryPath("request.query")).toBe(true);
    expect(isQueryPath("request.queryString")).toBe(false);
    expect(isQueryPath("request.body.query")).toBe(false);
  });
});
