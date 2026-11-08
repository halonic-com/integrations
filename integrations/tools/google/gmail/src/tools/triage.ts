import { z } from "zod";
import type { GmailClient } from "../client.ts";
import type { ToolImplementation } from "../kit.ts";
import { type MessageView, viewMessage } from "../message-content.ts";
import { includeInlineSchema, pageTokenSchema } from "./arguments.ts";

/** All bodies together stay under this, so many messages still fit the model's context. */
const totalBodyChars = 40_000;

/** Each message keeps at least this much body, however many there are. */
const minBodyCharsPerMessage = 300;

const triageArguments = z.strictObject({
  query: z
    .string()
    .max(2_000)
    .default("is:unread in:inbox")
    .describe("Gmail search query (default: is:unread in:inbox)."),
  maxMessages: z.int().min(1).max(25).default(10),
  bodyChars: z
    .int()
    .min(minBodyCharsPerMessage)
    .max(5_000)
    .default(2_000)
    .describe("Body characters per message (lowered automatically for many messages)."),
  includeInline: includeInlineSchema,
  pageToken: pageTokenSchema
    .optional()
    .describe("nextPageToken from the previous call, for more results."),
});

type TriageMessage = Omit<MessageView, "messageIdHeader">;

interface TriageResult {
  query: string;
  resultSizeEstimate: number | undefined;
  bodyCharsPerMessage: number;
  note: string;
  messages: TriageMessage[];
  nextPageToken?: string;
}

const note =
  "Bodies are cut at bodyCharsPerMessage; when a message has nextBodyOffset, read the rest with gmail_read_message.";

export const triageTool = {
  declaration: {
    name: "gmail_triage",
    description:
      "For mailbox checks: searches mail (default: unread mail in the inbox) and reads every match in one call. Returns each message's sender, recipients, subject, date, labels, the first part of its body and its attachments. Read a long body in full with gmail_read_message.",
    parameters: z.toJSONSchema(triageArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: triageArguments,
  // At most 26 requests: one list, then one per message (maxMessages is at most 25).
  async run(client, args, signal) {
    const list = await client.listMessages(
      { query: args.query, maxResults: args.maxMessages, pageToken: args.pageToken },
      signal,
    );
    const bodyChars = bodyCharsPerMessage(args.bodyChars, list.messages.length);
    const messages = await Promise.all(
      list.messages.map(async ({ id }) => {
        const message = await client.getMessage(id, signal);
        const page = { maxBodyChars: bodyChars, bodyOffset: 0, includeInline: args.includeInline };
        const { messageIdHeader: _, ...view } = viewMessage(message, page);
        return view;
      }),
    );
    const result: TriageResult = {
      query: args.query,
      resultSizeEstimate: list.resultSizeEstimate,
      bodyCharsPerMessage: bodyChars,
      note,
      messages,
    };
    if (list.nextPageToken !== undefined) result.nextPageToken = list.nextPageToken;
    return result;
  },
} satisfies ToolImplementation<GmailClient, typeof triageArguments>;

/** The body each message gets: what was asked for, lowered so all bodies together fit. */
export function bodyCharsPerMessage(asked: number, messageCount: number): number {
  const fairShare = Math.floor(totalBodyChars / Math.max(1, messageCount));
  return Math.max(minBodyCharsPerMessage, Math.min(asked, fairShare));
}
