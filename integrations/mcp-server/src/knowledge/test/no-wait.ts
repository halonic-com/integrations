import type { McpHost } from "@halonicjs/integration-mcp";

/**
 * A `wait` for tests whose servers answer with JSON. The MCP client only
 * waits before resuming an answer stream, so a call here is a bug.
 */
export const noWait: McpHost["wait"] = async () => {
  throw new Error("No answer stream here, so nothing should wait.");
};
