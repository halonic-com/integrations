import type { AbortSignalLike } from "@halonicjs/integration-tool-google-shared";
import { z } from "zod";
import type { GmailClient, RawMessage } from "./client.ts";
import { type MailBodies, withQuote, withSignature } from "./mail-body.ts";
import { headerValue, type Message } from "./message.ts";
import { encodeRaw } from "./mime.ts";
import { gmailIdSchema } from "./tools/arguments.ts";

/**
 * The arguments `gmail_create_draft` and `gmail_send` share, and the mail
 * they make from them. Both tools write the same mail; one saves it, the
 * other sends it.
 */

/** One address, with or without a name: "Name <someone@example.com>". */
const addressSchema = z.string().min(1).max(400);

export const composeArguments = z.strictObject({
  // At least one: a mail with only Bcc recipients would go out with an empty To.
  to: z
    .array(addressSchema)
    .min(1)
    .max(50)
    .describe('Recipient addresses, e.g. "Name <someone@example.com>".'),
  cc: z
    .array(addressSchema)
    .max(50)
    .default([])
    .describe("Copy recipients; every recipient sees them."),
  bcc: z
    .array(addressSchema)
    .max(50)
    .default([])
    .describe("Hidden recipients: they get the mail, and the other recipients don't see them."),
  // 998 characters is the longest line RFC 5322 allows.
  subject: z
    .string()
    .max(998)
    .optional()
    .describe('Subject. When replying and left empty, "Re: <original subject>" is used.'),
  body: z
    .string()
    .max(100_000)
    .describe(
      "Plain-text body. End it with the last sentence of the message: no closing line, name or signature. The account's Gmail signature is appended, and it already carries the closing.",
    ),
  html: z
    .string()
    .max(500_000)
    .optional()
    .describe("Optional HTML body, sent alongside the plain-text body."),
  replyToMessageId: gmailIdSchema
    .optional()
    .describe(
      "Gmail message id to reply to; keeps the reply in the same thread and quotes the original below the signature, so do not paste the original into the body.",
    ),
  quoteOriginal: z
    .boolean()
    .default(true)
    .describe("Include the quoted original when replying (default true)."),
  signature: z
    .boolean()
    .default(true)
    .describe("Append the account's Gmail signature (default true)."),
});
export type ComposeArguments = z.infer<typeof composeArguments>;

/** "Re: " before the original's subject, unless it already starts with it. */
export function replySubject(original: Message): string {
  const subject = headerValue(original.payload?.headers, "Subject") ?? "";
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

/**
 * The caller's mail as Gmail's `raw`, with the signature and the quoted
 * original. Only the recipients the caller named: never anyone else.
 *
 * At most 2 requests: the original of a reply, then the signature. A
 * signature that can't be read stops the call before anything is saved or
 * sent; pass `signature: false` to go without.
 */
export async function composeMail(
  client: GmailClient,
  args: ComposeArguments,
  signal?: AbortSignalLike,
): Promise<RawMessage> {
  const original =
    args.replyToMessageId === undefined
      ? undefined
      : await client.getMessage(args.replyToMessageId, signal);
  let bodies: MailBodies = { body: args.body, html: args.html };
  if (args.signature) bodies = withSignature(bodies, await client.getSignature(signal));
  if (original !== undefined && args.quoteOriginal) bodies = withQuote(bodies, original);

  const headers = original?.payload?.headers;
  const raw = encodeRaw({
    to: args.to,
    cc: args.cc,
    bcc: args.bcc,
    subject:
      !args.subject && original !== undefined ? replySubject(original) : (args.subject ?? ""),
    ...bodies,
    inReplyTo: headerValue(headers, "Message-ID"),
    references: headerValue(headers, "References"),
  });
  return original === undefined ? { raw } : { raw, threadId: original.threadId };
}
