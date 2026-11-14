import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { GmailClient } from "../client.ts";
import { gmailIdSchema } from "./arguments.ts";

/** Label ids are short: system ones such as "UNREAD", user ones such as "Label_12". */
const labelIdSchema = z.string().min(1).max(200);

/**
 * Labels this tool never adds. Adding "TRASH" moves mail to the trash, which
 * Gmail empties for good after 30 days, and adding "SPAM" reports the mail to
 * Google. Neither is a label change the description promises. Removing them
 * (taking mail back out) is allowed.
 */
export const refusedLabelIds: ReadonlySet<string> = new Set(["TRASH", "SPAM"]);

const addableLabelIdSchema = labelIdSchema.refine(
  (labelId) => !refusedLabelIds.has(labelId.toUpperCase()),
  "This tool doesn't move mail to Trash or Spam.",
);

const modifyLabelsArguments = z.strictObject({
  // Gmail's batchModify takes at most 1,000 messages.
  messageIds: z
    .array(gmailIdSchema)
    .min(1)
    .max(1_000)
    .describe("Ids of the messages to change (at most 1000)."),
  addLabelIds: z
    .array(addableLabelIdSchema)
    .max(100)
    .default([])
    .describe('Label ids to add. "TRASH" and "SPAM" are refused.'),
  removeLabelIds: z.array(labelIdSchema).max(100).default([]).describe("Label ids to remove."),
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
    // batchModify answers with an empty body, so this is the count asked for:
    // Gmail changes every message or fails the whole request.
    return { modified: args.messageIds.length };
  },
} satisfies ToolImplementation<GmailClient, typeof modifyLabelsArguments>;
