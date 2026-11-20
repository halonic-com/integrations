import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { PaperclipClient } from "../client.ts";
import { type CommentSummary, commentSummary, isDeleted } from "../comment.ts";
import { issueSchema, paperclipIdSchema } from "./arguments.ts";

/** The README's limit: 100 comments of up to 10,000 characters is already a lot of context. */
export const maxComments = 100;

const listCommentsArguments = z.strictObject({
  issue: issueSchema,
  after: paperclipIdSchema
    .optional()
    .describe("nextAfter from the previous call, or a comment id, for the comments after it."),
  maxResults: z
    .int()
    .min(1)
    .max(maxComments)
    .default(50)
    .describe("Comments to return (default 50)."),
});

/** What the tool promises in its description, and nothing more. */
interface ListCommentsResult {
  comments: CommentSummary[];
  /** Set when there are more comments: pass it as `after`. */
  nextAfter?: string;
}

export const listCommentsTool = {
  declaration: {
    name: "issues_list_comments",
    description:
      "Lists one task's comments, oldest first. Returns id, author, time and text per comment. A comment's text is cut after 10,000 characters.",
    parameters: z.toJSONSchema(listCommentsArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: listCommentsArguments,
  // One request.
  async run(client, args, signal): Promise<ListCommentsResult> {
    const listed = await client.listComments(
      { issue: args.issue, after: args.after, limit: pageLimit(args.maxResults, args.after) },
      signal,
    );
    // Paperclip's `after` returns that comment too; it was on the previous page.
    const page = listed.filter((comment) => comment.id !== args.after);
    const kept = page.slice(0, args.maxResults);
    const result: ListCommentsResult = {
      // Paging counts deleted comments, so `nextAfter` never skips one; they aren't returned.
      comments: kept.filter((comment) => !isDeleted(comment)).map(commentSummary),
    };
    const last = kept.at(-1);
    if (page.length > args.maxResults && last !== undefined) result.nextAfter = last.id;
    return result;
  },
} satisfies ToolImplementation<PaperclipClient, typeof listCommentsArguments>;

/**
 * How many comments to ask for: one more than the caller wants, to know
 * whether there are more, and one more again for the `after` comment
 * Paperclip sends back.
 */
function pageLimit(maxResults: number, after: string | undefined): number {
  return after === undefined ? maxResults + 1 : maxResults + 2;
}
