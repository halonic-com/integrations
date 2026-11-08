import { z } from "zod";
import type { GmailClient } from "../client.ts";
import { composeArguments, composeMail } from "../compose.ts";
import type { ToolImplementation } from "../kit.ts";
import { gmailIdSchema } from "./arguments.ts";

/**
 * The draft's arguments, except that a reply quotes the original only when
 * asked. An approval shows these arguments, not the quoted text, so a mail
 * sent straight away carries nothing the approver hasn't seen. A draft
 * still quotes by default: gmail_get_draft shows all of it before it's sent.
 */
export const sendArguments = composeArguments.extend({
  replyToMessageId: gmailIdSchema
    .optional()
    .describe(
      "Gmail message id to reply to; keeps the reply in the same thread. The original is quoted below the signature only with quoteOriginal.",
    ),
  quoteOriginal: z
    .boolean()
    .default(false)
    .describe("Include the quoted original when replying (default false)."),
});

export const sendTool = {
  declaration: {
    name: "gmail_send",
    description:
      "Sends an email from the account; once sent it cannot be undone. To reply in a thread, pass replyToMessageId.",
    parameters: z.toJSONSchema(sendArguments, { io: "input" }),
    // It reaches people outside the account. Halonic asks or refuses on this.
    risk: "send",
    untrusted: false,
  },
  arguments: sendArguments,
  // At most 3 requests: the original of a reply, the signature, then one send, never retried.
  async run(client, args, signal) {
    const sent = await client.sendMessage(await composeMail(client, args, signal), signal);
    return { sent: true, messageId: sent.id, threadId: sent.threadId };
  },
} satisfies ToolImplementation<GmailClient, typeof sendArguments>;
