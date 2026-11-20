import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { PaperclipClient } from "../client.ts";
import { type TaskDetail, taskDetail } from "../task.ts";
import { issueSchema } from "./arguments.ts";

const getIssueArguments = z.strictObject({
  issue: issueSchema,
});

export const getIssueTool = {
  declaration: {
    name: "issues_get",
    description:
      "Returns one task: id, identifier, title, description, status, priority, assignee, last change, parent, the tasks that block it and that it blocks, and the keys of its documents. A description is cut after 20,000 characters. Read its comments with issues_list_comments and a document with issues_get_document.",
    parameters: z.toJSONSchema(getIssueArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: getIssueArguments,
  // One request.
  async run(client, args, signal): Promise<TaskDetail> {
    return taskDetail(await client.getTask(args.issue, signal));
  },
} satisfies ToolImplementation<PaperclipClient, typeof getIssueArguments>;
