import type { IntegrationHost } from "@halonicjs/adapters/integration-kit";

/**
 * The part of the kit's integration host our MCP client uses: its HTTP
 * client and its `wait`. Tests pass `{ http, wait }`; the kit's whole host
 * fits as it is.
 */
export type McpHost = Pick<IntegrationHost, "http" | "wait">;
