import { describe, expect, it, vi } from "vitest";
import { McpSession, maxToolPages } from "./session.ts";
import { FakeTransport, initialized, result, type ScriptedAnswer } from "./test/fake-transport.ts";

const clientInfo = { name: "halonic", version: "0.1.0" };
const tool = (name: string) => ({
  name,
  description: "Echoes text.",
  inputSchema: { type: "object" },
});

async function connected(answers: ScriptedAnswer[], onToolsChanged?: () => void) {
  const transport = new FakeTransport([initialized(), ...answers]);
  const session = new McpSession(
    transport,
    onToolsChanged ? { clientInfo, onToolsChanged } : { clientInfo },
  );
  await session.initialize();
  return { transport, session };
}

describe("McpSession.initialize", () => {
  it("asks for our newest version, then sends notifications/initialized", async () => {
    const transport = new FakeTransport([initialized()]);
    const agreement = await new McpSession(transport, { clientInfo }).initialize();
    expect(agreement).toEqual({
      protocolVersion: "2025-11-25",
      offersTools: true,
      announcesToolChanges: true,
    });
    expect(transport.sent).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]);
    expect(transport.protocolVersion).toBe("2025-11-25");
  });

  it("accepts an older version we also speak", async () => {
    const transport = new FakeTransport([initialized("2025-03-26")]);
    await new McpSession(transport, { clientInfo }).initialize();
    expect(transport.protocolVersion).toBe("2025-03-26");
  });

  it("refuses a version we don't speak, without repeating it", async () => {
    const transport = new FakeTransport([initialized("2024-11-05 <script>")]);
    const error = await new McpSession(transport, { clientInfo })
      .initialize()
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "unsupported-version" });
    expect(String(error)).not.toContain("2024");
    expect(transport.sent).toHaveLength(1);
  });

  it("refuses to be used before initialize", async () => {
    const session = new McpSession(new FakeTransport([]), { clientInfo });
    await expect(session.listTools()).rejects.toThrow("initialize");
  });
});

describe("McpSession.listTools", () => {
  it("follows nextCursor until the last page", async () => {
    const { transport, session } = await connected([
      result({ tools: [tool("one")], nextCursor: "page-2" }),
      result({ tools: [tool("two")] }),
    ]);
    expect((await session.listTools()).map((found) => found.name)).toEqual(["one", "two"]);
    expect(transport.requests.slice(1).map((request) => request.params)).toEqual([
      {},
      { cursor: "page-2" },
    ]);
  });

  it("returns no tools, without asking, when the server offers none", async () => {
    const transport = new FakeTransport([initialized("2025-11-25", null)]);
    const session = new McpSession(transport, { clientInfo });
    await session.initialize();
    expect(await session.listTools()).toEqual([]);
    expect(transport.requests).toHaveLength(1);
  });

  it("stops after the page limit instead of looping", async () => {
    const pages = Array.from({ length: maxToolPages }, () =>
      result({ tools: [], nextCursor: "again" }),
    );
    const { session } = await connected(pages);
    await expect(session.listTools()).rejects.toMatchObject({ code: "unexpected-response" });
  });

  it("refuses more tools than the limit", async () => {
    const many = Array.from({ length: 201 }, (_, index) => tool(`tool_${index}`));
    const { session } = await connected([result({ tools: many })]);
    await expect(session.listTools()).rejects.toThrow("more than 200 tools");
  });

  it.each([
    ["a tool name with a space", { tools: [tool("two words")] }],
    ["a schema that isn't an object", { tools: [{ name: "x", inputSchema: { type: "string" } }] }],
    ["no tools field", {}],
  ])("refuses %s", async (_case, value) => {
    const { session } = await connected([result(value)]);
    await expect(session.listTools()).rejects.toMatchObject({ code: "unexpected-response" });
  });
});

describe("McpSession.callTool", () => {
  it("sends the name and arguments and reads the content", async () => {
    const { transport, session } = await connected([
      result({
        content: [
          { type: "text", text: "hello" },
          { type: "image", data: "", mimeType: "image/png" },
        ],
      }),
    ]);
    const answer = await session.callTool("echo", { text: "hello" });
    expect(answer).toEqual({
      content: [
        { type: "text", text: "hello" },
        { type: "other", kind: "image" },
      ],
      isError: false,
    });
    expect(transport.requests[1]).toMatchObject({
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hello" } },
    });
  });

  it("passes on a tool's own failure as isError", async () => {
    const { session } = await connected([
      result({ content: [{ type: "text", text: "no such city" }], isError: true }),
    ]);
    expect((await session.callTool("weather", {})).isError).toBe(true);
  });

  it.each([
    [-32602, "bad-arguments"],
    [-32601, "not-found"],
    [-32603, "unavailable"],
  ])("maps JSON-RPC error %i to %s, without the server's text", async (code, expected) => {
    const { session } = await connected([
      (id) => [{ jsonrpc: "2.0", id, error: { code, message: "secret detail from the server" } }],
    ]);
    const error = await session.callTool("echo", {}).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "McpError", code: expected });
    expect(String(error)).not.toContain("secret detail");
  });

  it("matches the answer by id and ignores answers to other ids", async () => {
    const { session } = await connected([
      (id) => [
        {
          jsonrpc: "2.0",
          id: id + 100,
          result: { content: [{ type: "text", text: "not yours" }] },
        },
        { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "yours" }] } },
      ],
    ]);
    expect((await session.callTool("echo", {})).content).toEqual([{ type: "text", text: "yours" }]);
  });

  it("answers the server's ping and refuses its other requests while waiting", async () => {
    const { transport, session } = await connected([
      (id) => [
        { jsonrpc: "2.0", id: "ping-1", method: "ping" },
        { jsonrpc: "2.0", id: "ask-1", method: "sampling/createMessage", params: {} },
        { jsonrpc: "2.0", id, result: { content: [] } },
      ],
    ]);
    await session.callTool("echo", {});
    expect(transport.sent.slice(-2)).toEqual([
      { jsonrpc: "2.0", id: "ping-1", result: {} },
      { jsonrpc: "2.0", id: "ask-1", error: { code: -32601, message: "Method not found" } },
    ]);
  });

  it("tells the caller when the tool list changed", async () => {
    const onToolsChanged = vi.fn();
    const { session } = await connected(
      [
        (id) => [
          { jsonrpc: "2.0", method: "notifications/tools/list_changed" },
          { jsonrpc: "2.0", id, result: { content: [] } },
        ],
      ],
      onToolsChanged,
    );
    await session.callTool("echo", {});
    expect(onToolsChanged).toHaveBeenCalledOnce();
  });

  it("says so when the server stops without an answer", async () => {
    const { session } = await connected([
      () => [{ jsonrpc: "2.0", method: "notifications/message", params: {} }],
    ]);
    await expect(session.callTool("echo", {})).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses a result that doesn't fit the schema", async () => {
    const { session } = await connected([result({ content: "not a list" })]);
    await expect(session.callTool("echo", {})).rejects.toMatchObject({
      code: "unexpected-response",
    });
  });
});

describe("McpSession.close", () => {
  it("closes the transport", async () => {
    const { transport, session } = await connected([]);
    await session.close();
    expect(transport.closed).toBe(true);
  });
});
