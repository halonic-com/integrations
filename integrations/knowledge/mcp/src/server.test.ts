import { type ReplayHttpClient, replay } from "@halonicjs/tooling-record/replay";
import { describe, expect, it } from "vitest";
import { connectToServer } from "./server.ts";
import { noWait } from "./test/no-wait.ts";

/**
 * In-test traffic for what the recordings don't show: calls that share one
 * handshake, a new session after a failed one, and answers that arrive late.
 * The content is invented.
 */
const url = "https://docs.example.com/mcp";
const withKey = { authorization: "Bearer <scrubbed:secret>" };
const firstSession = "scrubbed-secret-1";
const secondSession = "scrubbed-secret-2";
const inSession = inSessionOf(firstSession);

function inSessionOf(sessionId: string) {
  return { ...withKey, "mcp-session-id": sessionId };
}

function post(
  requestHeaders: Record<string, string>,
  status: number,
  value?: unknown,
  responseHeaders: Record<string, string> = {},
) {
  return exchange("POST", requestHeaders, status, value, responseHeaders);
}

/** The request that ends a session on the server. */
function endSession(sessionId: string, status: number) {
  return exchange("DELETE", inSessionOf(sessionId), status);
}

function exchange(
  method: string,
  requestHeaders: Record<string, string>,
  status: number,
  value?: unknown,
  responseHeaders: Record<string, string> = {},
) {
  return {
    transport: "http",
    request: { method, url, headers: requestHeaders, body: { kind: "empty" } },
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

function handshake(sessionId = firstSession, capabilities: object = { tools: {} }) {
  return [
    post(
      withKey,
      200,
      { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-11-25", capabilities } },
      { "mcp-session-id": sessionId },
    ),
    post(inSessionOf(sessionId), 202),
  ];
}

function toolAnswer(id: number, text: string, sessionId = firstSession) {
  return post(inSessionOf(sessionId), 200, {
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

/**
 * Passes `http`'s calls through, but holds the answers to the calls numbered
 * in `held` (counting from 1) until the test releases them.
 */
function holdAnswers(http: ReplayHttpClient, held: readonly number[]) {
  const gates = new Map(held.map((call) => [call, { arrived: signal(), released: signal() }]));
  let calls = 0;
  const holding: ReplayHttpClient = {
    async fetch(fetchUrl, init) {
      calls += 1;
      const gate = gates.get(calls);
      const response = await http.fetch(fetchUrl, init);
      if (gate !== undefined) {
        gate.arrived.fire();
        await gate.released.fired;
      }
      return response;
    },
  };
  return {
    http: holding,
    /** Waits until call `call` was sent. */
    arrived: (call: number) => gateOf(gates, call).arrived.fired,
    /** Lets the answer to call `call` through. */
    release: (call: number) => gateOf(gates, call).released.fire(),
  };
}

function gateOf<Gate>(gates: Map<number, Gate>, call: number): Gate {
  const gate = gates.get(call);
  if (gate === undefined) {
    throw new Error(`Call ${call} isn't held.`);
  }
  return gate;
}

/** A promise the test fires by hand. */
function signal() {
  let fire = () => {};
  const fired = new Promise<void>((resolve) => {
    fire = resolve;
  });
  return { fired, fire };
}

describe("connectToServer", () => {
  it("opens one session for calls that come in together", async () => {
    const traffic = recording([...handshake(), toolAnswer(2, "first"), toolAnswer(3, "second")]);
    const server = connectToServer({ http: traffic.http, wait: noWait }, { url });
    const [first, second] = await Promise.all([
      server.callTool("search_docs", { query: "a" }),
      server.callTool("search_docs", { query: "b" }),
    ]);
    traffic.assertAllUsed();
    expect(first.content).toEqual([{ type: "text", text: "first" }]);
    expect(second.content).toEqual([{ type: "text", text: "second" }]);
  });

  it("opens a new session after one that failed to open", async () => {
    const traffic = recording([post(withKey, 503), ...handshake(), toolAnswer(2, "found")]);
    const server = connectToServer({ http: traffic.http, wait: noWait }, { url });
    await expect(server.callTool("search_docs", {})).rejects.toMatchObject({ code: "unavailable" });
    await expect(server.callTool("search_docs", {})).resolves.toMatchObject({ isError: false });
    traffic.assertAllUsed();
  });

  it("opens a new session after the server ended the old one", async () => {
    const traffic = recording([
      ...handshake(),
      post(inSession, 404),
      ...handshake(),
      toolAnswer(2, "x"),
    ]);
    const server = connectToServer({ http: traffic.http, wait: noWait }, { url });
    await expect(server.callTool("search_docs", {})).rejects.toMatchObject({
      code: "session-expired",
    });
    await expect(server.callTool("search_docs", {})).resolves.toMatchObject({ isError: false });
    traffic.assertAllUsed();
  });

  it("keeps the new session when a late answer says the old one ended", async () => {
    const traffic = recording([
      ...handshake(),
      post(inSession, 404),
      post(inSession, 404),
      ...handshake(secondSession),
      toolAnswer(2, "third", secondSession),
      toolAnswer(3, "fourth", secondSession),
      endSession(secondSession, 200),
    ]);
    const held = holdAnswers(traffic.http, [3, 4]);
    const server = connectToServer({ http: held.http, wait: noWait }, { url });

    // Two calls on the first session, which the server ends while they run.
    const first = server.callTool("search_docs", { query: "a" });
    const second = server.callTool("search_docs", { query: "b" });
    await held.arrived(4);
    held.release(3);
    await expect(first).rejects.toMatchObject({ code: "session-expired" });

    // The next call opens the second session; then the late answer arrives.
    await expect(server.callTool("search_docs", { query: "c" })).resolves.toMatchObject({
      content: [{ type: "text", text: "third" }],
    });
    held.release(4);
    await expect(second).rejects.toMatchObject({ code: "session-expired" });

    // The second session is still the one in use, and the one close ends.
    await expect(server.callTool("search_docs", { query: "d" })).resolves.toMatchObject({
      content: [{ type: "text", text: "fourth" }],
    });
    await server.close();
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
    const server = connectToServer({ http: traffic.http, wait: noWait }, { url });
    await expect(server.callTool("search_docs", {})).rejects.toMatchObject({
      name: "KnowledgeMcpError",
      code: "not-found",
    });
  });

  it("ends the session of a server that offers no tools, and reports that first", async () => {
    const traffic = recording([...handshake(firstSession, {}), endSession(firstSession, 503)]);
    const server = connectToServer({ http: traffic.http, wait: noWait }, { url });
    await expect(server.callTool("search_docs", {})).rejects.toMatchObject({
      name: "KnowledgeMcpError",
      code: "not-found",
    });
    traffic.assertAllUsed();
  });

  it("refuses calls after close, without opening a session", async () => {
    const traffic = recording([]);
    const server = connectToServer({ http: traffic.http, wait: noWait }, { url });
    await server.close();
    await expect(server.callTool("search_docs", {})).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(traffic.sent).toEqual([]);
  });
});
