import { describe, expect, it } from "vitest";
import { errorForStatus } from "./http-status.ts";
import { maxResumes, StreamableHttpTransport } from "./http-transport.ts";
import { McpSession } from "./session.ts";
import { endpoint, type FakeExchange, FakeServer } from "./test/fake-server.ts";

const clientInfo = { name: "halonic", version: "0.1.0" };
const auth = { secret: "mcp-server-key", as: "bearer" } as const;
const session = { "mcp-session-id": "session-1", "mcp-protocol-version": "2025-11-25" };
const json = { "content-type": "application/json" };
const sse = { "content-type": "text/event-stream" };

const initializeExchange: FakeExchange = {
  request: {
    method: "POST",
    headers: { "mcp-session-id": undefined },
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo },
    },
  },
  response: {
    status: 200,
    headers: { ...json, "Mcp-Session-Id": "session-1" },
    body: {
      kind: "json",
      value: {
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-11-25", capabilities: { tools: {} } },
      },
    },
  },
};

const initializedExchange: FakeExchange = {
  request: {
    method: "POST",
    headers: session,
    body: { jsonrpc: "2.0", method: "notifications/initialized" },
  },
  response: { status: 202, body: { kind: "empty" } },
};

const initializeExchanges = [initializeExchange, initializedExchange];

const callRequest = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: { name: "echo", arguments: {} },
};
const callAnswer = { jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "done" }] } };

/** A tool call whose answer stream the server cuts after its first events. */
function cutCall(firstEvents: { id?: string; data?: unknown }[], drop: boolean): FakeExchange {
  return {
    request: { method: "POST", headers: session, body: callRequest },
    response: { status: 200, headers: sse, body: { kind: "sse", events: firstEvents, drop } },
  };
}

function resumeFrom(
  lastEventId: string,
  events: { id?: string; data?: unknown }[],
  drop = false,
): FakeExchange {
  return {
    request: { method: "GET", headers: { ...session, "last-event-id": lastEventId } },
    response: { status: 200, headers: sse, body: { kind: "sse", events, drop } },
  };
}

async function connect(exchanges: FakeExchange[]) {
  const server = new FakeServer([...initializeExchanges, ...exchanges]);
  const mcp = new McpSession(new StreamableHttpTransport(server, { url: endpoint, auth }), {
    clientInfo,
  });
  await mcp.initialize();
  return { server, mcp };
}

describe("StreamableHttpTransport", () => {
  it("keeps the session id and the version, and lets the kit add the key", async () => {
    const { server, mcp } = await connect([
      {
        request: {
          method: "POST",
          headers: { ...session, accept: "application/json, text/event-stream" },
          body: callRequest,
        },
        response: {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: { kind: "json", value: callAnswer },
        },
      },
    ]);
    expect(await mcp.callTool("echo", {})).toEqual({
      content: [{ type: "text", text: "done" }],
      isError: false,
    });
    expect(server.calls.every((call) => call.init?.auth === auth)).toBe(true);
    server.assertAllUsed();
  });

  it("reads an answer stream and answers the server's ping on the way", async () => {
    const { server, mcp } = await connect([
      {
        request: { method: "POST", headers: session, body: callRequest },
        response: {
          status: 200,
          headers: sse,
          body: {
            kind: "sse",
            events: [{ data: { jsonrpc: "2.0", id: "p", method: "ping" } }, { data: callAnswer }],
          },
        },
      },
      {
        request: {
          method: "POST",
          headers: session,
          body: { jsonrpc: "2.0", id: "p", result: {} },
        },
        response: { status: 202, body: { kind: "empty" } },
      },
    ]);
    expect((await mcp.callTool("echo", {})).content).toHaveLength(1);
    server.assertAllUsed();
  });

  describe("resuming an answer stream", () => {
    it("resumes after a dropped connection from the last event id", async () => {
      const { server, mcp } = await connect([
        cutCall([{ id: "e1" }], true),
        resumeFrom("e1", [{ id: "e2", data: callAnswer }]),
      ]);
      expect((await mcp.callTool("echo", {})).isError).toBe(false);
      server.assertAllUsed();
    });

    it("resumes when the server closes the stream before the answer", async () => {
      const { server, mcp } = await connect([
        cutCall([{ id: "e1" }], false),
        resumeFrom("e1", [{ id: "e2", data: callAnswer }]),
      ]);
      await mcp.callTool("echo", {});
      server.assertAllUsed();
    });

    it("resumes from the newest id each time", async () => {
      const progress = { jsonrpc: "2.0", method: "notifications/progress", params: {} };
      const { server, mcp } = await connect([
        cutCall([{ id: "e1" }], true),
        resumeFrom("e1", [{ id: "e2", data: progress }], true),
        resumeFrom("e2", [{ id: "e3", data: callAnswer }]),
      ]);
      await mcp.callTool("echo", {});
      server.assertAllUsed();
    });

    it(`gives up after ${maxResumes} resumes and passes the drop through`, async () => {
      const resumes = Array.from({ length: maxResumes }, () =>
        resumeFrom("e1", [{ id: "e1" }], true),
      );
      const { server, mcp } = await connect([cutCall([{ id: "e1" }], true), ...resumes]);
      await expect(mcp.callTool("echo", {})).rejects.toThrow("connection reset");
      server.assertAllUsed();
    });

    it("can't resume a stream without ids: the drop passes through unchanged", async () => {
      const { server, mcp } = await connect([
        cutCall([{ data: { jsonrpc: "2.0", method: "notifications/progress" } }], true),
      ]);
      await expect(mcp.callTool("echo", {})).rejects.toThrow("connection reset");
      server.assertAllUsed();
    });

    it("never resumes a call the caller aborted", async () => {
      const { server, mcp } = await connect([cutCall([{ id: "e1" }], true)]);
      await expect(mcp.callTool("echo", {}, { aborted: true })).rejects.toThrow("connection reset");
      server.assertAllUsed();
    });

    it("says the server stopped when a stream without ids ends early", async () => {
      const { mcp } = await connect([cutCall([], false)]);
      await expect(mcp.callTool("echo", {})).rejects.toMatchObject({ code: "unavailable" });
    });

    it("refuses a resume the server answers without a stream", async () => {
      const { mcp } = await connect([
        cutCall([{ id: "e1" }], true),
        {
          request: { method: "GET" },
          response: { status: 200, headers: json, body: { kind: "json", value: callAnswer } },
        },
      ]);
      await expect(mcp.callTool("echo", {})).rejects.toMatchObject({ code: "unexpected-response" });
    });

    it("maps a refused resume like any other status", async () => {
      const { mcp } = await connect([
        cutCall([{ id: "e1" }], true),
        { request: { method: "GET" }, response: { status: 405, body: { kind: "empty" } } },
      ]);
      await expect(mcp.callTool("echo", {})).rejects.toMatchObject({ code: "unavailable" });
    });
  });

  it.each([
    [
      "an unknown content type",
      {
        status: 200,
        headers: { "content-type": "text/html" },
        body: { kind: "text", text: "<html>" },
      },
    ],
    [
      "JSON that doesn't parse",
      { status: 200, headers: json, body: { kind: "text", text: "{ secret detail" } },
    ],
    [
      "an event that isn't JSON",
      { status: 200, headers: sse, body: { kind: "text", text: "data: { secret detail\n\n" } },
    ],
  ] as const)("refuses %s without quoting it", async (_case, response) => {
    const { mcp } = await connect([{ request: { method: "POST", body: callRequest }, response }]);
    const error = await mcp.callTool("echo", {}).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "unexpected-response" });
    expect(String(error)).not.toContain("secret detail");
  });

  it("refuses a session id with characters a header can't carry", async () => {
    const server = new FakeServer([
      {
        ...initializeExchange,
        response: {
          ...initializeExchange.response,
          headers: { ...json, "mcp-session-id": "bad id" },
        },
      },
    ]);
    const mcp = new McpSession(new StreamableHttpTransport(server, { url: endpoint }), {
      clientInfo,
    });
    await expect(mcp.initialize()).rejects.toMatchObject({ code: "unexpected-response" });
  });

  it("reports an expired session when the server forgets it", async () => {
    const { mcp } = await connect([
      {
        request: { method: "POST", body: callRequest },
        response: { status: 404, body: { kind: "empty" } },
      },
    ]);
    await expect(mcp.callTool("echo", {})).rejects.toMatchObject({ code: "session-expired" });
  });

  it.each([200, 404, 405])("ends the session with DELETE and accepts %i", async (status) => {
    const { server, mcp } = await connect([
      {
        request: { method: "DELETE", headers: session },
        response: { status, body: { kind: "empty" } },
      },
    ]);
    await mcp.close();
    server.assertAllUsed();
  });

  it("sends no DELETE when the server gave no session", async () => {
    const server = new FakeServer([]);
    await new StreamableHttpTransport(server, { url: endpoint }).close();
    expect(server.calls).toEqual([]);
  });
});

describe("errorForStatus", () => {
  it.each([
    [400, false, "bad-arguments"],
    [422, false, "bad-arguments"],
    [401, false, "not-signed-in"],
    [403, false, "not-allowed"],
    [404, false, "not-found"],
    [404, true, "session-expired"],
    [408, false, "rate-limited"],
    [429, false, "rate-limited"],
    [500, false, "unavailable"],
    [503, true, "unavailable"],
  ])("maps %i (session: %s) to %s", (status, hasSession, code) => {
    expect(errorForStatus(status, hasSession).code).toBe(code);
  });
});
