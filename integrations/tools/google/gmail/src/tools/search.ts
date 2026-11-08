import { z } from "zod";
import type { GmailClient } from "../client.ts";
import type { ToolImplementation } from "../kit.ts";
import { type MessageSummary, summarize } from "../message.ts";
import { pageTokenSchema } from "./arguments.ts";

/**
 * At most 25 messages: each one costs a request, and the result goes into
 * the model's context. The old connector allowed 50; the guide asks for a
 * small, fixed number of requests per call.
 */
export const maxSearchResults = 25;

const searchArguments = z.strictObject({
  query: z
    .string()
    .max(2_000)
    .default("in:inbox")
    .describe("Gmail search query (default: in:inbox)."),
  maxResults: z
    .int()
    .min(1)
    .max(maxSearchResults)
    .default(15)
    .describe("Messages to return (default 15)."),
  pageToken: pageTokenSchema
    .optional()
    .describe("nextPageToken from the previous search, for more results."),
});

/** What the tool promises in its description, and nothing more. */
interface SearchResult {
  resultSizeEstimate: number | undefined;
  messages: MessageSummary[];
  nextPageToken?: string;
}

export const searchTool = {
  declaration: {
    name: "gmail_search",
    description:
      'Searches mail with Gmail search syntax (e.g. "from:bank is:unread newer_than:7d", "subject:invoice has:attachment"). Returns id, threadId, from, to, cc, subject, date, labels and snippet per message, and an estimate of how many messages match.',
    parameters: z.toJSONSchema(searchArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: searchArguments,
  // At most 26 requests: one list, then one per message.
  async run(client, args, signal) {
    const list = await client.listMessages(args, signal);
    const messages = await Promise.all(
      list.messages.map((message) => client.getMessageSummary(message.id, signal)),
    );
    const result: SearchResult = {
      resultSizeEstimate: list.resultSizeEstimate,
      messages: messages.map(summarize),
    };
    if (list.nextPageToken !== undefined) result.nextPageToken = list.nextPageToken;
    return result;
  },
} satisfies ToolImplementation<GmailClient, typeof searchArguments>;
