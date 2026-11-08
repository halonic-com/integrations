import { type Replay, type ReplayHttpClient, replay } from "@halonicjs/tooling-record/replay";
import { describe, expect, it, vi } from "vitest";
import callCancelled from "../recordings/call-cancelled.json" with { type: "json" };
import callTool from "../recordings/call-tool.json" with { type: "json" };
import callToolError from "../recordings/call-tool-error.json" with { type: "json" };
import listTools from "../recordings/list-tools.json" with { type: "json" };
import missingKey from "../recordings/missing-key.json" with { type: "json" };
import toolsChanged from "../recordings/tools-changed.json" with { type: "json" };
import { McpToolsError, mcpHttp } from "./index.ts";

/**
 * The recordings are invented traffic with a small made-up notes server,
 * scrubbed by the recorder with this sheet's `userContent` paths: tool
 * arguments and results are placeholders, the server's tool list is kept.
 */
const url = "https://tools.example.com/mcp";

function connect(http: ReplayHttpClient, settings: Record<string, unknown> = { url }) {
  return mcpHttp.connect({ http, settings });
}

/** What the integration sent in request `index`, as JSON. */
function sentBody(recording: Replay, index: number): unknown {
  return recording.sent[index]?.body;
}

describe("tool-mcp-http on recordings", () => {
  it("declares no tools and sends nothing until a tool is listed or called", () => {
    const recording = replay(listTools);
    connect(recording.http);
    expect(mcpHttp.tools).toEqual([]);
    expect(recording.sent).toHaveLength(0);
  });

  it("lists the server's tools as write and untrusted, whatever their hints say", async () => {
    const recording = replay(listTools);
    const tools = await connect(recording.http).listTools?.();
    recording.assertAllUsed();
    expect(tools).toEqual([
      {
        name: "search_notes",
        description: "Finds notes whose title or text contains the query. Returns id and title.",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        risk: "write",
        untrusted: true,
      },
      {
        name: "add_note",
        description: "Adds a note with a title and a text. Returns the new note's id.",
        parameters: {
          type: "object",
          properties: { text: { type: "string" }, title: { type: "string" } },
          required: ["title", "text"],
        },
        risk: "write",
        untrusted: true,
      },
    ]);
  });

  it("calls a tool with the caller's arguments and returns its text", async () => {
    const recording = replay(callTool);
    const args = { title: "Garden plan", text: "Plant the tomatoes after the last frost." };
    const result = await connect(recording.http).callTool("add_note", args);
    recording.assertAllUsed();
    // The answer came as an event stream, after a progress notice.
    expect(result).toBe("<scrubbed:content>");
    expect(sentBody(recording, 2)).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "add_note", arguments: args },
    });
  });

  it("fails a call whose tool reports an error, without the server's text", async () => {
    const recording = replay(callToolError);
    const error = await connect(recording.http)
      .callTool("add_note", { title: "Garden plan" })
      .catch((caught: unknown) => caught);
    recording.assertAllUsed();
    expect(error).toBeInstanceOf(McpToolsError);
    expect(error).toMatchObject({
      code: "tool-failed",
      message: "The MCP server's tool add_note reported an error.",
    });
  });

  it("shows the server's new tools on the next list, after it changed them", async () => {
    const recording = replay(toolsChanged);
    const connection = connect(recording.http);
    const names = async () => (await connection.listTools?.())?.map((tool) => tool.name);

    await expect(names()).resolves.toEqual(["search_notes"]);
    // The server says its list changed while it answers this call.
    await expect(connection.callTool("search_notes", { query: "garden" })).resolves.toBe(
      "<scrubbed:content>",
    );
    await expect(names()).resolves.toEqual(["search_notes", "add_note", "archive_note"]);
    recording.assertAllUsed();
  });

  it("tells the user to check the key when the server needs one and none is set up", async () => {
    // Without the optional key, the kit sends the request without it.
    const recording = replay(missingKey, { unsetSecrets: ["mcp-server-key"] });
    await expect(connect(recording.http).listTools?.()).rejects.toMatchObject({
      name: "McpToolsError",
      code: "not-signed-in",
      message: "The MCP server refused the key. Check the key or reconnect.",
    });
    recording.assertAllUsed();
  });

  it("stops a cancelled call and tells the server", async () => {
    const recording = replay(callCancelled);
    const controller = new AbortController();
    const abort = new DOMException("This operation was aborted", "AbortError");
    // The kit aborts the request once the caller's signal fires: here, as
    // soon as the server has the tool call and has sent its progress notice.
    const http: ReplayHttpClient = {
      async fetch(fetchUrl, init) {
        const response = await recording.http.fetch(fetchUrl, init);
        if (init?.body?.includes('"tools/call"') === true) {
          controller.abort();
          throw abort;
        }
        return response;
      },
    };

    const call = connect(http).callTool("search_notes", { query: "garden" }, controller.signal);
    await expect(call).rejects.toBe(abort);

    // The notice goes out without waiting: nobody needs its answer.
    await vi.waitFor(() => recording.assertAllUsed());
    expect(sentBody(recording, 3)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 2, reason: "The caller cancelled the request." },
    });
  });

  it("refuses a wrong url setting before any request", async () => {
    const recording = replay(listTools);
    await expect(
      connect(recording.http, { url: "not an address" }).listTools?.(),
    ).rejects.toMatchObject({
      name: "McpToolsError",
      code: "bad-config",
      message: "Check the tool-mcp-http settings: url.",
    });
    expect(recording.sent).toHaveLength(0);
  });

  it("closes without a request when no session was opened", async () => {
    const recording = replay(listTools);
    const connection = connect(recording.http);
    await connection.close();
    await connection.close();
    await expect(connection.callTool("search_notes", {})).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(recording.sent).toHaveLength(0);
  });
});
