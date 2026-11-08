import { z } from "zod";
import type { GmailClient } from "../client.ts";
import { composeArguments, composeMail } from "../compose.ts";
import type { ToolImplementation } from "../kit.ts";

export const sendTool = {
  declaration: {
    name: "gmail_send",
    description:
      "Sends an email from the account; once sent it cannot be undone. To reply in a thread, pass replyToMessageId.",
    parameters: z.toJSONSchema(composeArguments, { io: "input" }),
    // It reaches people outside the account. Halonic asks or refuses on this.
    risk: "send",
    untrusted: false,
  },
  arguments: composeArguments,
  // At most 3 requests: the original of a reply, the signature, then one send, never retried.
  async run(client, args, signal) {
    const sent = await client.sendMessage(await composeMail(client, args, signal), signal);
    return { sent: true, messageId: sent.id, threadId: sent.threadId };
  },
} satisfies ToolImplementation<GmailClient, typeof composeArguments>;
