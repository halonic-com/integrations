import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { PaperclipClient } from "../client.ts";
import { type InboxTaskSummary, inboxTaskSummary } from "../task.ts";
import { maxTasks } from "./list-issues.ts";

const listInboxArguments = z.strictObject({});

/** What the tool promises in its description, and nothing more. */
interface ListInboxResult {
  tasks: InboxTaskSummary[];
  /** Set when the inbox has more than 50 tasks: how many aren't returned. */
  notShown?: number;
}

export const listInboxTool = {
  declaration: {
    name: "issues_list_inbox",
    description:
      "Lists the tasks assigned to the agent whose key this is: id, identifier, title, status, priority, whether its blockers are done and last change per task. Returns at most 50 tasks, and how many more there are.",
    parameters: z.toJSONSchema(listInboxArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: listInboxArguments,
  // One request. Paperclip sends the whole inbox at once, with no pages.
  async run(client, _args, signal): Promise<ListInboxResult> {
    const inbox = await client.listInbox(signal);
    const result: ListInboxResult = { tasks: inbox.slice(0, maxTasks).map(inboxTaskSummary) };
    if (inbox.length > maxTasks) result.notShown = inbox.length - maxTasks;
    return result;
  },
} satisfies ToolImplementation<PaperclipClient, typeof listInboxArguments>;
