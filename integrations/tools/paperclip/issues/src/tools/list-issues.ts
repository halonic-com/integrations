import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { PaperclipClient } from "../client.ts";
import { type TaskSummary, taskSummary } from "../task.ts";
import { paperclipIdSchema } from "./arguments.ts";

/** The README's limit: a list of tasks stays small in the model's context. */
export const maxTasks = 50;

/** Far beyond any board we know; it only keeps a made-up offset bounded. */
const maxOffset = 10_000;

const listIssuesArguments = z.strictObject({
  status: z
    .string()
    .max(200)
    // Paperclip's statuses are lower case with underscores, such as `in_review`.
    .regex(/^[a-z_]+(,[a-z_]+)*$/)
    .optional()
    .describe(
      'Only tasks with these statuses, separated by commas, such as "todo,in_progress,blocked".',
    ),
  assigneeAgentId: paperclipIdSchema.optional().describe("Only tasks assigned to this agent id."),
  text: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Words to find in titles, identifiers and descriptions."),
  maxResults: z.int().min(1).max(maxTasks).default(25).describe("Tasks to return (default 25)."),
  offset: z
    .int()
    .min(0)
    .max(maxOffset)
    .default(0)
    .describe("nextOffset from the previous call, for more tasks."),
});

/** What the tool promises in its description, and nothing more. */
interface ListIssuesResult {
  tasks: TaskSummary[];
  /** Set when there are more tasks: pass it as `offset`. */
  nextOffset?: number;
}

export const listIssuesTool = {
  declaration: {
    name: "issues_list",
    description:
      "Lists the company's tasks, most recently changed first. Returns id, identifier, title, status, priority, assignee and last change per task, without descriptions. Read a whole task with issues_get.",
    parameters: z.toJSONSchema(listIssuesArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: listIssuesArguments,
  // One request. It asks for one task more than it returns, to know whether there are more.
  async run(client, args, signal): Promise<ListIssuesResult> {
    const page = await client.listTasks(
      {
        status: args.status,
        assigneeAgentId: args.assigneeAgentId,
        text: args.text,
        limit: args.maxResults + 1,
        offset: args.offset,
      },
      signal,
    );
    const tasks = page.slice(0, args.maxResults).map(taskSummary);
    const result: ListIssuesResult = { tasks };
    if (page.length > args.maxResults) result.nextOffset = args.offset + args.maxResults;
    return result;
  },
} satisfies ToolImplementation<PaperclipClient, typeof listIssuesArguments>;
