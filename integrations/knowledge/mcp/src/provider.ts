import type { McpClient, McpToolResult } from "@halonicjs/integration-mcp";
import { readSourceConfig, type SourceConfig } from "./config.ts";
import { toDocument } from "./document.ts";
import { KnowledgeMcpError, withKnowledgeErrors } from "./errors.ts";
import { toHits } from "./hits.ts";
import type {
  KnowledgeCapabilities,
  KnowledgeDoc,
  KnowledgeHit,
  KnowledgeProvider,
  KnowledgeSource,
} from "./kit.ts";
import { hitLimit, maxQueryChars, maxRefChars } from "./limits.ts";

/**
 * One knowledge source on the connection's MCP server: `search` calls the
 * configured search tool and `get` the get tool. One tool call each.
 */
export class McpKnowledgeProvider implements KnowledgeProvider {
  readonly id: string;
  /** `semantic` is `false`: we can't know how the server searches. */
  readonly capabilities: KnowledgeCapabilities = { search: true, semantic: false, ingest: false };
  /** Every hit and document is the server's text, so Halonic fences it off. */
  readonly untrusted = true;
  readonly #server: McpClient;
  readonly #config: SourceConfig;

  /** @throws {KnowledgeMcpError} `bad-config` when the source's config is wrong */
  constructor(server: McpClient, source: KnowledgeSource) {
    this.id = source.id;
    this.#server = server;
    this.#config = readSourceConfig(source.id, source.config);
  }

  async search(query: string, options: { limit?: number } = {}): Promise<KnowledgeHit[]> {
    if (query.length > maxQueryChars) {
      throw new KnowledgeMcpError(
        "bad-arguments",
        `The search query is longer than ${maxQueryChars} characters.`,
      );
    }
    const limit = hitLimit(options.limit);
    return withKnowledgeErrors(async () => {
      // `limit` as the old source sent it; the config refuses `limit` as the query's name.
      const result = await this.#server.callTool(this.#config.searchTool, {
        [this.#config.queryArg]: query,
        limit,
      });
      throwIfToolFailed(result, "search");
      return toHits(result, this.id, limit);
    });
  }

  async get(ref: string): Promise<KnowledgeDoc | null> {
    const getTool = this.#config.getTool;
    if (getTool === undefined) {
      return null;
    }
    if (ref.length > maxRefChars) {
      throw new KnowledgeMcpError(
        "bad-arguments",
        `The ref is longer than ${maxRefChars} characters.`,
      );
    }
    return withKnowledgeErrors(async () => {
      const result = await this.#server.callTool(getTool, { [this.#config.refArg]: ref });
      throwIfToolFailed(result, "get");
      return toDocument(result, ref);
    });
  }
}

/**
 * A tool reports its own failure with `isError`. Its text may explain, but
 * it is the server's text, so it never goes into our message.
 */
function throwIfToolFailed(result: McpToolResult, which: "search" | "get"): void {
  if (result.isError) {
    throw new KnowledgeMcpError("tool-failed", `The MCP server's ${which} tool reported an error.`);
  }
}
