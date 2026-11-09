import { describe, expect, it } from "vitest";
import { McpError } from "./errors.ts";
import { errorForStatus } from "./http-status.ts";
import {
  maxResumePauseMs,
  maxResumesPerRequest,
  maxResumesWithoutProgress,
  minResumePauseMs,
  StreamableHttpTransport,
} from "./http-transport.ts";
import { McpSession } from "./session.ts";
import { endpoint, type FakeEvent, type FakeExchange, FakeServer } from "./test/fake-server.ts";
import { type FakeWait, fakeWait } from "./test/fake-wait.ts";

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
const progress = { jsonrpc: "2.0", method: "notifications/progress", params: {} };

/** A tool call whose answer stream the server cuts after its first events. */
function cutCall(firstEvents: FakeEvent[], drop: boolean): FakeExchange {
  return {
    request: { method: "POST", headers: session, body: callRequest },
    response: { status: 200, headers: sse, body: { kind: "sse", events: firstEvents, drop } },
  };
}

function resumeFrom(lastEventId: string, events: FakeEvent[], drop = false): FakeExchange {
  return {
    request: { method: "GET", headers: { ...session, "last-event-id": lastEventId } },
    response: { status: 200, headers: sse, body: { kind: "sse", events, drop } },
  };
}

async function connect(exchanges: FakeExchange[], { wait, waits, asked }: FakeWait = fakeWait()) {
  const server = new FakeServer([...initializeExchanges, ...exchanges]);
  const transport = new StreamableHttpTransport({ http: server, wait }, { url: endpoint, auth });
  const mcp = new McpSession(transport, { clientInfo });
  await mcp.initialize();
  return { server, mcp, waits, asked };
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
      const { server, mcp } = await connect([
        cutCall([{ id: "e1" }], true),
        resumeFrom("e1", [{ id: "e2", data: progress }], true),
        resumeFrom("e2", [{ id: "e3", data: callAnswer }]),
      ]);
      await mcp.callTool("echo", {});
      server.assertAllUsed();
    });

    it("asks again for an answer the connection dropped in the middle of", async () => {
      const { server, mcp } = await connect([
        {
          request: { method: "POST", headers: session, body: callRequest },
          response: {
            status: 200,
            headers: sse,
            body: {
              kind: "sse",
              events: [{ id: "e1", data: progress }],
              cutEvent: { id: "e2", data: callAnswer },
            },
          },
        },
        resumeFrom("e1", [{ id: "e2", data: callAnswer }]),
      ]);
      expect((await mcp.callTool("echo", {})).isError).toBe(false);
      server.assertAllUsed();
    });

    it("keeps resuming a long call as long as each stream brings a new event", async () => {
      const closes = Array.from({ length: maxResumesWithoutProgress + 2 }, (_, index) =>
        resumeFrom(`e${index}`, [{ id: `e${index + 1}` }]),
      );
      const { server, mcp } = await connect([
        cutCall([{ id: "e0" }], false),
        ...closes,
        resumeFrom(`e${closes.length}`, [{ id: "last", data: callAnswer }]),
      ]);
      expect((await mcp.callTool("echo", {})).isError).toBe(false);
      server.assertAllUsed();
    });

    it(`gives up after ${maxResumesWithoutProgress} resumes in a row without a new event`, async () => {
      const resumes = [
        resumeFrom("e1", [], true),
        ...Array.from({ length: maxResumesWithoutProgress - 1 }, () =>
          resumeFrom("e1", [{ id: "e1" }], true),
        ),
      ];
      const { server, mcp } = await connect([cutCall([{ id: "e1" }], true), ...resumes]);
      await expect(mcp.callTool("echo", {})).rejects.toThrow("connection reset");
      server.assertAllUsed();
    });

    it(`stops after ${maxResumesPerRequest} resumes even when each brings a new event`, async () => {
      const closes = Array.from({ length: maxResumesPerRequest }, (_, index) =>
        resumeFrom(`e${index}`, [{ id: `e${index + 1}` }]),
      );
      const { server, mcp } = await connect([cutCall([{ id: "e0" }], false), ...closes]);
      await expect(mcp.callTool("echo", {})).rejects.toThrow("stopped before it answered");
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

    it("waits as long as the server's retry asks before it resumes", async () => {
      const { server, mcp, waits } = await connect([
        cutCall([{ id: "e1", retry: "2000" }], true),
        resumeFrom("e1", [{ id: "e2", data: callAnswer }]),
      ]);
      await mcp.callTool("echo", {});
      expect(waits).toEqual([2_000]);
      server.assertAllUsed();
    });

    it("keeps the server's retry for the later resumes of the call", async () => {
      const { mcp, waits } = await connect([
        cutCall([{ id: "e1", retry: "2000" }], true),
        resumeFrom("e1", [{ id: "e2" }], true),
        resumeFrom("e2", [{ id: "e3", retry: "3000" }], true),
        resumeFrom("e3", [{ id: "e4", data: callAnswer }]),
      ]);
      await mcp.callTool("echo", {});
      expect(waits).toEqual([2_000, 2_000, 3_000]);
    });

    it.each([
      ["no retry", undefined],
      ["a retry shorter than the minimum", "0"],
      ["an invalid retry", "soon"],
    ])("waits the minimum pause after %s", async (_, retry) => {
      const { mcp, waits } = await connect([
        cutCall([{ id: "e1", ...(retry === undefined ? {} : { retry }) }], true),
        resumeFrom("e1", [{ id: "e2", data: callAnswer }]),
      ]);
      await mcp.callTool("echo", {});
      expect(waits).toEqual([minResumePauseMs]);
    });

    it("never asks the host to wait longer than its limit", async () => {
      const { mcp, asked } = await connect([
        cutCall([{ id: "e1", retry: "600000" }], true),
        resumeFrom("e1", [{ id: "e2", data: callAnswer }]),
      ]);
      await mcp.callTool("echo", {});
      // `asked`, not `waits`: the host would cut 600 000 ms down by itself.
      expect(asked).toEqual([maxResumePauseMs]);
    });

    it("ends the call without resuming when it is cancelled during the pause", async () => {
      const controller = new AbortController();
      const cancelled = new Error("cancelled by the caller");
      const pause = fakeWait(() => controller.abort(cancelled));
      // No resume exchange: the fake server fails on a `GET` it doesn't expect.
      const { server, mcp } = await connect([cutCall([{ id: "e1" }], true)], pause);
      await expect(mcp.callTool("echo", {}, controller.signal)).rejects.toBe(cancelled);
      expect(pause.waits).toEqual([minResumePauseMs]);
      server.assertAllUsed();
      server.assertNoBodyLeftOpen();
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

  describe("freeing the connection of an answer it doesn't read", () => {
    const html = {
      status: 200,
      headers: { "content-type": "text/html" },
    } as const;

    it("cancels the confirmation of a notification", async () => {
      const { server } = await connect([]);
      server.assertNoBodyLeftOpen();
    });

    it.each([
      [
        "an error status",
        [
          {
            request: { method: "POST", headers: session, body: callRequest },
            response: { status: 500, body: { kind: "text", text: "busy" } },
          },
        ],
      ],
      [
        "an unknown content type",
        [
          {
            request: { method: "POST", headers: session, body: callRequest },
            response: { ...html, body: { kind: "text", text: "<html>" } },
          },
        ],
      ],
      [
        "a refused resume",
        [
          cutCall([{ id: "e1" }], true),
          {
            request: { method: "GET" },
            response: { status: 405, body: { kind: "text", text: "no" } },
          },
        ],
      ],
      [
        "a resume answered without a stream",
        [
          cutCall([{ id: "e1" }], true),
          {
            request: { method: "GET" },
            response: { ...html, body: { kind: "text", text: "<html>" } },
          },
        ],
      ],
    ] as const satisfies readonly (readonly [string, readonly FakeExchange[]])[])(
      "cancels %s",
      async (_case, exchanges) => {
        const { server, mcp } = await connect([...exchanges]);
        await expect(mcp.callTool("echo", {})).rejects.toBeInstanceOf(McpError);
        server.assertAllUsed();
        server.assertNoBodyLeftOpen();
      },
    );

    it.each([
      [200, "resolves"],
      [404, "resolves"],
      [410, "resolves"],
      [500, "rejects"],
    ] as const)("cancels the answer to DELETE (%i)", async (status, outcome) => {
      const { server, mcp } = await connect([
        {
          request: { method: "DELETE", headers: session },
          response: { status, body: { kind: "text", text: "bye" } },
        },
      ]);
      if (outcome === "resolves") {
        await expect(mcp.close()).resolves.toBeUndefined();
      } else {
        await expect(mcp.close()).rejects.toBeInstanceOf(McpError);
      }
      server.assertAllUsed();
      server.assertNoBodyLeftOpen();
    });
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
    const transport = new StreamableHttpTransport(
      { http: server, wait: fakeWait().wait },
      { url: endpoint },
    );
    const mcp = new McpSession(transport, { clientInfo });
    await expect(mcp.initialize()).rejects.toMatchObject({ code: "unexpected-response" });
    server.assertNoBodyLeftOpen();
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

  it.each([200, 404, 405, 410])("ends the session with DELETE and accepts %i", async (status) => {
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
    const transport = new StreamableHttpTransport(
      { http: server, wait: fakeWait().wait },
      { url: endpoint },
    );
    await transport.close();
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
    [410, false, "not-found"],
    [410, true, "not-found"],
    [408, false, "rate-limited"],
    [429, false, "rate-limited"],
    [500, false, "unavailable"],
    [503, true, "unavailable"],
  ])("maps %i (session: %s) to %s", (status, hasSession, code) => {
    expect(errorForStatus(status, hasSession).code).toBe(code);
  });
});
