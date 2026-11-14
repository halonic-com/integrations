import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { GmailClient } from "../client.ts";
import { composeArguments, composeMail } from "../compose.ts";

export const createDraftTool = {
  declaration: {
    name: "gmail_create_draft",
    description:
      "Creates a draft (not sent) in the account's Drafts folder. Prefer this when a person should review before sending; send it later with gmail_send_draft.",
    parameters: z.toJSONSchema(composeArguments, { io: "input" }),
    // A draft stays in the account: nobody else sees it until someone sends it.
    risk: "write",
    untrusted: false,
  },
  arguments: composeArguments,
  // At most 3 requests: the original of a reply, the signature, then the draft.
  async run(client, args, signal) {
    const draft = await client.createDraft(await composeMail(client, args, signal), signal);
    return { draftId: draft.id, messageId: draft.message.id, threadId: draft.message.threadId };
  },
} satisfies ToolImplementation<GmailClient, typeof composeArguments>;
