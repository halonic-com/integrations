import { replay } from "@halonicjs/tooling-record/replay";
import { describe, expect, it } from "vitest";
import { McpServer } from "./server.ts";

/**
 * In-test traffic for what the recordings don't show: calls that share one
 * handshake, and a new session after a failed one. The content is invented.
 */
const url = "https://docs.example.com/mcp";
const withKey = { authorization: "Bearer <scrubbed:secret>" };
const inSession = { ...withKey, "mcp-session-id": "scrubbed-secret-1" };

function post(
  requestHeaders: Record<string, string>,
  status: number,
  value?: unknown,
  responseHeaders: Record<string, string> = {},
) {
  return {
    transport: "http",
    request: { method: "POST", url, headers: requestHeaders, body: { kind: "empty" } },
    response: {
      status,
      headers:
        value === undefined
          ? responseHeaders
          : { "content-type": "application/json", ...responseHeaders },
      body: value === undefined ? { kind: "empty" } : { kind: "json", value },
    },
  };
}

const handshake = [
  post(
    withKey,
    200,
    {
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2025-11-25", capabilities: { tools: {} } },
    },
    { "mcp-session-id": "scrubbed-secret-1" },
  ),
  post(inSession, 202),
];

function toolAnswer(id: number, text: string) {
  return post(inSession, 200, {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text }] },
  });
}

function recording(exchanges: unknown[]) {
  return replay({
    format: "halonic.recording/1",
    integration: "knowledge-mcp",
    scenario: "in-test",
    exchanges,
    scrubReport: [],
  });
}

describe("McpServer", () => {
  it("opens one session for calls that come in together", async () => {
    const traffic = recording([...handshake, toolAnswer(2, "first"), toolAnswer(3, "second")]);
    const server = new McpServer(traffic.http, { url });
    const [first, second] = await Promise.all([
      server.callTool("search_docs", { query: "a" }),
      server.callTool("search_docs", { query: "b" }),
    ]);
    traffic.assertAllUsed();
    expect(first.content).toEqual([{ type: "text", text: "first" }]);
    expect(second.content).toEqual([{ type: "text", text: "second" }]);
  });

  it("opens a new session after one that failed to open", async () => {
    const traffic = recording([post(withKey, 503), ...handshake, toolAnswer(2, "found")]);
    const server = new McpServer(traffic.http, { url });
    await expect(server.callTool("search_docs", {})).rejects.toMatchObject({ code: "unavailable" });
    await expect(server.callTool("search_docs", {})).resolves.toMatchObject({ isError: false });
    traffic.assertAllUsed();
  });

  it("opens a new session after the server ended the old one", async () => {
    const traffic = recording([
      ...handshake,
      post(inSession, 404),
      ...handshake,
      toolAnswer(2, "x"),
    ]);
    const server = new McpServer(traffic.http, { url });
    await expect(server.callTool("search_docs", {})).rejects.toMatchObject({
      code: "session-expired",
    });
    await expect(server.callTool("search_docs", {})).resolves.toMatchObject({ isError: false });
    traffic.assertAllUsed();
  });

  it("refuses a server that offers no tools", async () => {
    const traffic = recording([
      post(withKey, 200, {
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-11-25", capabilities: {} },
      }),
      post(withKey, 202),
    ]);
    const server = new McpServer(traffic.http, { url });
    await expect(server.callTool("search_docs", {})).rejects.toMatchObject({
      name: "KnowledgeMcpError",
      code: "not-found",
    });
  });
});
