import {
  type Integration,
  runTool,
  type ToolImplementation,
} from "@halonicjs/adapters/integration-kit";
import { PaperclipClient } from "./client.ts";
import { PaperclipError } from "./errors.ts";
import { getDocumentTool } from "./tools/get-document.ts";
import { getIssueTool } from "./tools/get-issue.ts";
import { listCommentsTool } from "./tools/list-comments.ts";
import { listInboxTool } from "./tools/list-inbox.ts";
import { listIssuesTool } from "./tools/list-issues.ts";

/** The tools, in the same order as in integration.yaml. */
const tools: readonly ToolImplementation<PaperclipClient>[] = [
  listIssuesTool,
  getIssueTool,
  listCommentsTool,
  getDocumentTool,
  listInboxTool,
];

export const paperclipIssues: Integration = {
  name: "tool-paperclip-issues",
  version: "0.1.0",
  tools: tools.map((tool) => tool.declaration),
  connect(host) {
    // No request here: Paperclip is only called when a tool is, and the
    // settings are read then, so a wrong one fails that call with `bad-config`.
    const client = new PaperclipClient(host);
    return {
      callTool: (name, args, signal) =>
        runTool(
          tools,
          client,
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
