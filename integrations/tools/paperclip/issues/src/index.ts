import {
  type Integration,
  runTool,
  type ToolImplementation,
} from "@halonicjs/adapters/integration-kit";
import { PaperclipError } from "./errors.ts";

/**
 * The same tools, in the same order, as in integration.yaml. The sheet
 * comes first (guide, section 3); the tools follow in the next pull
 * request.
 */
const tools: readonly ToolImplementation<undefined>[] = [];

export const paperclipIssues: Integration = {
  name: "tool-paperclip-issues",
  version: "0.1.0",
  tools: tools.map((tool) => tool.declaration),
  connect() {
    // No request here: Paperclip is only called when a tool is.
    return {
      callTool: (name, args, signal) =>
        runTool(
          tools,
          undefined,
          { name, args, signal },
          (code, message) => new PaperclipError(code, message),
        ),
      close: async () => {},
    };
  },
};

export type {
  Integration,
  IntegrationHost,
  IntegrationTool,
} from "@halonicjs/adapters/integration-kit";
export type { PaperclipErrorCode } from "./errors.ts";
export { PaperclipError } from "./errors.ts";
