import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { GmailClient } from "../client.ts";
import { gmailIdSchema } from "./arguments.ts";

const sendDraftArguments = z.strictObject({
  draftId: gmailIdSchema.describe("The draft's id, from gmail_create_draft."),
});

export const sendDraftTool = {
  declaration: {
    name: "gmail_send_draft",
    description: "Sends an existing draft by draftId. Sending cannot be undone.",
    parameters: z.toJSONSchema(sendDraftArguments, { io: "input" }),
    // It reaches people outside the account. Halonic asks or refuses on this.
    risk: "send",
    untrusted: false,
  },
  arguments: sendDraftArguments,
  // 1 request, never retried.
  async run(client, args, signal) {
    const sent = await client.sendDraft(args.draftId, signal);
    return { sent: true, messageId: sent.id, threadId: sent.threadId };
  },
} satisfies ToolImplementation<GmailClient, typeof sendDraftArguments>;
