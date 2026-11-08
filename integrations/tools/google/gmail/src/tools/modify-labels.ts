import { z } from "zod";
import type { GmailClient } from "../client.ts";
import type { ToolImplementation } from "../kit.ts";
import { gmailIdSchema } from "./arguments.ts";

/** Label ids are short: system ones such as "UNREAD", user ones such as "Label_12". */
const labelIdsSchema = z.array(z.string().min(1).max(200)).max(100).default([]);

const modifyLabelsArguments = z.strictObject({
  // Gmail's batchModify takes at most 1,000 messages.
  messageIds: z.array(gmailIdSchema).min(1).max(1_000),
  addLabelIds: labelIdsSchema,
  removeLabelIds: labelIdsSchema,
});

export const modifyLabelsTool = {
  declaration: {
    name: "gmail_modify_labels",
    description:
      'Adds or removes labels on messages. Mark read: remove "UNREAD". Archive: remove "INBOX". Star: add "STARRED". Use label ids from gmail_list_labels for custom labels.',
    parameters: z.toJSONSchema(modifyLabelsArguments, { io: "input" }),
    // Labels only change what the account itself sees: nobody else is told.
    risk: "write",
    untrusted: false,
  },
  arguments: modifyLabelsArguments,
  // 1 request.
  async run(client, args, signal) {
    await client.modifyLabels(args, signal);
    return { modified: args.messageIds.length };
  },
} satisfies ToolImplementation<GmailClient, typeof modifyLabelsArguments>;
