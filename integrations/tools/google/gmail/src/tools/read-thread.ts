import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { GmailClient } from "../client.ts";
import { type MessageView, viewMessage } from "../message-content.ts";
import {
  bodyOffsetSchema,
  gmailIdSchema,
  includeInlineSchema,
  maxBodyCharsLimit,
} from "./arguments.ts";

/**
 * A thread can hold hundreds of messages. The old connector returned them
 * all; the guide asks for a limit on every list, so they come in pages.
 */
const readThreadArguments = z.strictObject({
  threadId: gmailIdSchema.describe("The thread's id, threadId from gmail_search or gmail_triage."),
  maxBodyChars: z
    .int()
    .min(500)
    .max(maxBodyCharsLimit)
    .default(4_000)
    .describe("Body characters to return per message (default 4000)."),
  bodyOffset: bodyOffsetSchema.describe(
    "Where to start in each body; use nextBodyOffset from the previous read.",
  ),
  includeInline: includeInlineSchema,
  maxMessages: z.int().min(1).max(50).default(25).describe("Messages to return (default 25)."),
  messageOffset: z
    .int()
    .min(0)
    .max(10_000)
    .default(0)
    .describe("Where to start in the thread; use nextMessageOffset from the previous read."),
});

interface ThreadResult {
  threadId: string;
  messages: MessageView[];
  nextMessageOffset?: number;
}

export const readThreadTool = {
  declaration: {
    name: "gmail_read_thread",
    description:
      "Reads the messages of a conversation thread, oldest first, with the first 4,000 characters of each body by default. Returns at most maxMessages messages; when nextMessageOffset is present, call again with messageOffset for the rest.",
    parameters: z.toJSONSchema(readThreadArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: readThreadArguments,
  // 1 request: Gmail returns the whole thread at once; the page is cut here.
  async run(client, args, signal) {
    const thread = await client.getThread(args.threadId, signal);
    const end = args.messageOffset + args.maxMessages;
    const result: ThreadResult = {
      threadId: thread.id,
      messages: thread.messages
        .slice(args.messageOffset, end)
        .map((message) => viewMessage(message, args)),
    };
    if (end < thread.messages.length) result.nextMessageOffset = end;
    return result;
  },
} satisfies ToolImplementation<GmailClient, typeof readThreadArguments>;
