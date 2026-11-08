import { describe, expect, it } from "vitest";
import { McpClient } from "./client.ts";
import { McpError } from "./errors.ts";
import { FakeTransport, initialized, result, type ScriptedAnswer } from "./test/fake-transport.ts";

const clientInfo = { name: "halonic", version: "0.1.0" };

const textAnswer = (text: string) => result({ content: [{ type: "text", text }] });

/** The server forgot the session, as the HTTP transport reports a `404`. */
const sessionEnded: ScriptedAnswer = () => {
  throw new McpError("session-expired", "The MCP server ended the session. Connect again.");
};

/** A client whose sessions get the transports in `sessions`, one per session it opens. */
function clientOn(...sessions: FakeTransport[]) {
  const waiting = [...sessions];
  let opened = 0;
  const client = new McpClient({
    clientInfo,
    openTransport: () => {
      const transport = waiting.shift();
      if (transport === undefined) {
        throw new Error("The test has no transport for another session.");
      }
      opened += 1;
      return transport;
    },
  });
  return { client, opened: () => opened };
}

/** An answer the test lets through by hand. */
function heldAnswer(answer: ScriptedAnswer) {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held: ScriptedAnswer = async (id) => {
    await released;
    return answer(id);
  };
  return { held, release };
}

describe("McpClient", () => {
  it("opens one session for calls that come in together", async () => {
    const transport = new FakeTransport([initialized(), textAnswer("first"), textAnswer("second")]);
    const { client, opened } = clientOn(transport);
    const [first, second] = await Promise.all([
      client.callTool("echo", { text: "a" }),
      client.callTool("echo", { text: "b" }),
    ]);
    expect(first.content).toEqual([{ type: "text", text: "first" }]);
    expect(second.content).toEqual([{ type: "text", text: "second" }]);
    expect(opened()).toBe(1);
  });

  it("lists the server's tools in the open session", async () => {
    const tool = { name: "echo", inputSchema: { type: "object" } };
    const transport = new FakeTransport([initialized(), result({ tools: [tool] })]);
    const { client } = clientOn(transport);
    await expect(client.listTools()).resolves.toEqual([tool]);
  });

  it("opens a new session after one that failed to open", async () => {
    const refused: ScriptedAnswer = () => {
      throw new McpError("unavailable", "The MCP server is having trouble.");
    };
    const { client, opened } = clientOn(
      new FakeTransport([refused]),
      new FakeTransport([initialized(), textAnswer("x")]),
    );
    await expect(client.callTool("echo", {})).rejects.toMatchObject({ code: "unavailable" });
    await expect(client.callTool("echo", {})).resolves.toMatchObject({ isError: false });
    expect(opened()).toBe(2);
  });

  it("tries again when the transport couldn't be built", async () => {
    let attempts = 0;
    const client = new McpClient({
      clientInfo,
      openTransport: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new McpError("bad-arguments", "Check the settings: url.");
        }
        return new FakeTransport([initialized(), textAnswer("x")]);
      },
    });
    await expect(client.callTool("echo", {})).rejects.toMatchObject({ code: "bad-arguments" });
    await expect(client.callTool("echo", {})).resolves.toMatchObject({ isError: false });
  });

  it("opens a new session after the server ended the old one, for lists and calls", async () => {
    const { client, opened } = clientOn(
      new FakeTransport([initialized(), sessionEnded]),
      new FakeTransport([initialized(), sessionEnded]),
      new FakeTransport([initialized(), result({ tools: [] })]),
    );
    await expect(client.listTools()).rejects.toMatchObject({ code: "session-expired" });
    await expect(client.callTool("echo", {})).rejects.toMatchObject({ code: "session-expired" });
    await expect(client.listTools()).resolves.toEqual([]);
    expect(opened()).toBe(3);
  });

  it("keeps the new session when a late answer says the old one ended", async () => {
    const late = heldAnswer(sessionEnded);
    const firstSession = new FakeTransport([initialized(), sessionEnded, late.held]);
    const secondSession = new FakeTransport([initialized(), textAnswer("c"), textAnswer("d")]);
    const { client, opened } = clientOn(firstSession, secondSession);

    // Two calls on the first session, which the server ends while they run.
    const first = client.callTool("echo", { text: "a" });
    const second = client.callTool("echo", { text: "b" });
    await expect(first).rejects.toMatchObject({ code: "session-expired" });

    // The next call opens the second session; then the late answer arrives.
    await expect(client.callTool("echo", { text: "c" })).resolves.toMatchObject({
      content: [{ type: "text", text: "c" }],
    });
    late.release();
    await expect(second).rejects.toMatchObject({ code: "session-expired" });

    // The second session is still the one in use, and the one close ends.
    await expect(client.callTool("echo", { text: "d" })).resolves.toMatchObject({
      content: [{ type: "text", text: "d" }],
    });
    await client.close();
    expect(opened()).toBe(2);
    expect(firstSession.closed).toBe(false);
    expect(secondSession.closed).toBe(true);
  });

  it("ends a session the agreement check refuses, and reports the check's error", async () => {
    const transport = new FakeTransport([initialized("2025-11-25", null)]);
    const client = new McpClient({
      clientInfo,
      openTransport: () => transport,
      checkAgreement: (agreement) => {
        if (!agreement.offersTools) {
          throw new McpError("not-found", "The MCP server offers no tools.");
        }
      },
    });
    await expect(client.callTool("echo", {})).rejects.toMatchObject({ code: "not-found" });
    expect(transport.closed).toBe(true);
  });

  it("ends the open session on close, and is safe to close twice", async () => {
    const transport = new FakeTransport([initialized(), textAnswer("x")]);
    const { client } = clientOn(transport);
    await client.callTool("echo", {});
    await client.close();
    await client.close();
    expect(transport.closed).toBe(true);
  });

  it("refuses calls after close, without opening a session", async () => {
    const { client, opened } = clientOn();
    await client.close();
    await expect(client.callTool("echo", {})).rejects.toMatchObject({
      name: "McpError",
      code: "unavailable",
    });
    await expect(client.listTools()).rejects.toMatchObject({ code: "unavailable" });
    expect(opened()).toBe(0);
  });
});
