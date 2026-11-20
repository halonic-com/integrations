import { cutText } from "@halonicjs/integration-shared";
import { z } from "zod";

/** A comment as Paperclip lists it, only the fields we read. */
export const listedCommentSchema = z.object({
  id: z.string(),
  // "agent", "user" or "system"; kept as text, so a new kind doesn't break the tool.
  authorType: z.string(),
  authorAgentId: z.string().nullable(),
  authorUserId: z.string().nullable(),
  // A deleted comment may have no text left.
  body: z.string().nullable(),
  createdAt: z.string(),
  // A deleted comment stays in the list with this set. Older servers leave it out.
  deletedAt: z.string().nullable().optional(),
});
export type ListedComment = z.infer<typeof listedCommentSchema>;

/** Who wrote a comment: its kind, and the agent's or person's id when Paperclip names one. */
export interface CommentAuthor {
  type: string;
  agentId?: string;
  userId?: string;
}

/** One comment, as `issues_list_comments` returns it. */
export interface CommentSummary {
  id: string;
  author: CommentAuthor;
  createdAt: string;
  text: string;
}

/** The sheet's promise: a comment's text is cut after 10,000 characters. */
export const maxCommentChars = 10_000;

export function isDeleted(comment: ListedComment): boolean {
  return comment.deletedAt !== undefined && comment.deletedAt !== null;
}

export function commentSummary(comment: ListedComment): CommentSummary {
  return {
    id: comment.id,
    author: authorOf(comment),
    createdAt: comment.createdAt,
    text: cutText(comment.body ?? "", maxCommentChars),
  };
}

function authorOf(comment: ListedComment): CommentAuthor {
  const author: CommentAuthor = { type: comment.authorType };
  if (comment.authorAgentId !== null) author.agentId = comment.authorAgentId;
  if (comment.authorUserId !== null) author.userId = comment.authorUserId;
  return author;
}
