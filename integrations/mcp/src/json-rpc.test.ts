import { describe, expect, it } from "vitest";
import { parseIncoming } from "./json-rpc.ts";

describe("parseIncoming", () => {
  it.each([
    [
      { jsonrpc: "2.0", id: 1, result: { ok: true } },
      { kind: "result", id: 1, result: { ok: true } },
    ],
    [
      { jsonrpc: "2.0", id: "a", error: { code: -32600, message: "x" } },
      { kind: "error", id: "a", code: -32600 },
    ],
    [
      { jsonrpc: "2.0", id: null, error: { code: -32700 } },
      { kind: "error", id: null, code: -32700 },
    ],
    [
      { jsonrpc: "2.0", id: 7, method: "ping" },
      { kind: "request", id: 7, method: "ping" },
    ],
    [
      { jsonrpc: "2.0", method: "notifications/progress", params: {} },
      { kind: "notification", method: "notifications/progress" },
    ],
  ])("reads %j", (value, expected) => {
    expect(parseIncoming(value)).toEqual(expected);
  });

  it.each([
    ["a batch", [{ jsonrpc: "2.0", id: 1, result: {} }]],
    ["another version", { jsonrpc: "1.0", id: 1, result: {} }],
    ["both result and error", { jsonrpc: "2.0", id: 1, result: {}, error: { code: 1 } }],
    ["a result without an id", { jsonrpc: "2.0", result: {} }],
    ["a result with a null id", { jsonrpc: "2.0", id: null, result: {} }],
    ["a request with a null id", { jsonrpc: "2.0", id: null, method: "ping" }],
    ["a fractional id", { jsonrpc: "2.0", id: 1.5, result: {} }],
    ["a result that isn't an object", { jsonrpc: "2.0", id: 1, result: "ok" }],
    ["nothing at all", null],
  ])("refuses %s", (_case, value) => {
    expect(() => parseIncoming(value)).toThrow(
      expect.objectContaining({ code: "unexpected-response" }),
    );
  });
});
