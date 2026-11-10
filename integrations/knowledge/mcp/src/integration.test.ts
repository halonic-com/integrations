import { type Replay, replay } from "@halonicjs/tooling-record/replay";
import { readSheetPolicy } from "@halonicjs/tooling-record/sheet-policy";
import { describe, expect, it } from "vitest";
import getWithoutKey from "../recordings/get-without-key.json" with { type: "json" };
import keyRefused from "../recordings/key-refused.json" with { type: "json" };
import searchText from "../recordings/search-text.json" with { type: "json" };
import searchToolError from "../recordings/search-tool-error.json" with { type: "json" };
import { KnowledgeMcpError, knowledgeMcp } from "./index.ts";

/** No recording here has an answer stream that breaks off, so a call here is a bug. */
async function noWait(): Promise<void> {
  throw new Error("No answer stream breaks off here, so nothing should wait.");
}

/**
 * The `recording` section of integration.yaml. The replay scrubs what is
 * sent with it, the way the recorder did, before it compares it with the
 * recording.
 */
const policy = readSheetPolicy(new URL("../integration.yaml", import.meta.url));

const url = "https://docs.example.com/mcp";

/**
 * A source config with the fields the old source forwarded. `url`,
 * `secret` and `headers` are set to show they are ignored: the setting
 * picks the host, the sheet the key, and no header from config is sent.
 */
const searchOnly = {
  id: "handbook",
  config: {
    searchTool: "search_docs",
    url: "https://elsewhere.example.net/mcp",
    secret: "some-other-secret",
    headers: { "x-forwarded": "from-config" },
  },
};

function connect(recording: Replay, settings: Record<string, unknown> = { url }) {
  return knowledgeMcp.connect({ http: recording.http, wait: noWait, settings });
}

function provider(recording: Replay, settings?: Record<string, unknown>) {
  const connection = connect(recording, settings);
  const source = connection.createKnowledgeProvider?.(searchOnly);
  if (source === undefined) throw new Error("knowledge-mcp builds knowledge providers");
  return { connection, source };
}

describe("knowledge-mcp on recordings", () => {
  it("sends nothing until a source searches", () => {
    const recording = replay(searchText, { policy });
    provider(recording);
    expect(recording.sent).toHaveLength(0);
  });

  it("searches through the search tool and ends the session on close", async () => {
    const recording = replay(searchText, { policy });
    const { connection, source } = provider(recording);
    const hits = await source.search("holiday policy");
    await connection.close();
    recording.assertAllUsed();

    // The recording's text is scrubbed, so it is plain text: one hit that holds it.
    expect(hits).toEqual([
      {
        ref: "handbook:search",
        title: "handbook results",
        snippet: "<scrubbed:content>",
        score: 1,
      },
    ]);
    expect(recording.sent[2]?.body).toMatchObject({
      method: "tools/call",
      params: { name: "search_docs", arguments: { query: "holiday policy", limit: 5 } },
    });
    for (const request of recording.sent) {
      expect(request.url).toBe(url);
      expect(request.init.auth).toEqual({ secret: "mcp-server-key", as: "bearer" });
      expect(request.init.headers).not.toHaveProperty("x-forwarded");
    }
  });

  it("reads a document through the get tool from a server whose key isn't set up", async () => {
    // The key is optional in the sheet, so the kit sends the requests without it.
    const recording = replay(getWithoutKey, { policy, unsetSecrets: ["mcp-server-key"] });
    const source = connect(recording).createKnowledgeProvider?.({
      id: "guides",
      config: { searchTool: "search_docs", getTool: "read_doc", refArg: "path" },
    });
    const doc = await source?.get("guides/setup.md");
    recording.assertAllUsed();

    expect(doc).toEqual({
      ref: "guides/setup.md",
      title: "guides/setup.md",
      content: "<scrubbed:content>",
    });
    expect(recording.sent[2]?.body).toMatchObject({
      params: { name: "read_doc", arguments: { path: "guides/setup.md" } },
    });
    for (const request of recording.sent) {
      expect(request.init.auth).toEqual({ secret: "mcp-server-key", as: "bearer" });
    }
  });

  it("reports a tool's own failure without the server's text", async () => {
    const recording = replay(searchToolError, { policy });
    const search = provider(recording).source.search("holiday policy");
    await expect(search).rejects.toBeInstanceOf(KnowledgeMcpError);
    await expect(search).rejects.toMatchObject({
      code: "tool-failed",
      message: "The MCP server's search tool reported an error.",
    });
    recording.assertAllUsed();
  });

  it("tells the user to check the key when the server refuses it", async () => {
    const recording = replay(keyRefused, { policy });
    const search = provider(recording).source.search("holiday policy");
    await expect(search).rejects.toMatchObject({
      name: "KnowledgeMcpError",
      code: "not-signed-in",
      message: "The MCP server refused the key. Check the key or reconnect.",
    });
    recording.assertAllUsed();
  });
});

describe("knowledge-mcp without a request", () => {
  const noCalls = replay({
    format: "halonic.recording/1",
    integration: "knowledge-mcp",
    scenario: "no-calls",
    exchanges: [],
    scrubReport: [],
  });

  it("answers null for get when the source has no get tool", async () => {
    await expect(provider(noCalls).source.get("doc-1")).resolves.toBeNull();
  });

  it("refuses a query that is too long", async () => {
    const search = provider(noCalls).source.search("q".repeat(1_001));
    await expect(search).rejects.toMatchObject({ code: "bad-arguments" });
  });

  it("refuses to search without a url setting, naming the setting", async () => {
    const search = provider(noCalls, {}).source.search("holiday policy");
    await expect(search).rejects.toMatchObject({ code: "bad-config", message: /: url\.$/ });
  });

  it("refuses a source config without a search tool, naming the fields", () => {
    const connection = connect(noCalls);
    expect(() =>
      connection.createKnowledgeProvider?.({ id: "handbook", config: { queryArg: "limit" } }),
    ).toThrow(/Check the config of knowledge source handbook: searchTool, queryArg\./);
  });

  it("marks its content untrusted and claims no semantic search or ingest", () => {
    const { source } = provider(noCalls);
    expect(source).toMatchObject({
      id: "handbook",
      untrusted: true,
      capabilities: { search: true, semantic: false, ingest: false },
    });
  });

  it("has no tools to call", async () => {
    await expect(connect(noCalls).callTool("anything", {})).rejects.toMatchObject({
      code: "not-found",
    });
    expect(noCalls.sent).toHaveLength(0);
  });

  it("closes without a request when no session was opened, and twice", async () => {
    const connection = connect(noCalls);
    await connection.close();
    await connection.close();
    expect(noCalls.sent).toHaveLength(0);
  });
});
