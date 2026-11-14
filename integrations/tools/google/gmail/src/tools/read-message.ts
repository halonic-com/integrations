import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { GmailClient } from "../client.ts";
import { viewMessage } from "../message-content.ts";
import {
  bodyOffsetSchema,
  gmailIdSchema,
  includeInlineSchema,
  maxBodyCharsLimit,
} from "./arguments.ts";

const readMessageArguments = z.strictObject({
  messageId: gmailIdSchema.describe("The message's id, from gmail_search or gmail_triage."),
  maxBodyChars: z
    .int()
    .min(500)
    .max(maxBodyCharsLimit)
    .default(20_000)
    .describe("Body characters to return (default 20000)."),
  bodyOffset: bodyOffsetSchema.describe(
    "Where to start in the body; use nextBodyOffset from the previous read.",
  ),
  includeInline: includeInlineSchema,
});

export const readMessageTool = {
  declaration: {
    name: "gmail_read_message",
    description:
      "Reads one message: headers, plain-text body (HTML converted to text) and its attachments with name, type, size and partId. Long bodies come in pages: when nextBodyOffset is present, call again with bodyOffset.",
    parameters: z.toJSONSchema(readMessageArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: readMessageArguments,
  // 1 request.
  async run(client, args, signal) {
    const message = await client.getMessage(args.messageId, signal);
    return viewMessage(message, args);
  },
} satisfies ToolImplementation<GmailClient, typeof readMessageArguments>;
