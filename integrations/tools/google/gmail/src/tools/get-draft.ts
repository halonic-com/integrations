import { z } from "zod";
import type { GmailClient } from "../client.ts";
import type { ToolImplementation } from "../kit.ts";
import { headerValue } from "../message.ts";
import { bodyText, readContent } from "../message-content.ts";
import { bodyOffsetSchema, gmailIdSchema, maxBodyCharsLimit } from "./arguments.ts";

const getDraftArguments = z.strictObject({
  draftId: gmailIdSchema,
  maxBodyChars: z
    .int()
    .min(500)
    .max(maxBodyCharsLimit)
    .default(20_000)
    .describe("Body characters to return (default 20000)."),
  bodyOffset: bodyOffsetSchema.describe(
    "Where to start in the body; use nextBodyOffset from the previous read.",
  ),
});

/** A draft as it will be sent. A header the draft doesn't have is left out. */
interface DraftView {
  draftId: string;
  to: string | undefined;
  cc: string | undefined;
  /** Requirement google.get-draft-returns-bcc: every recipient, for an approval. */
  bcc: string | undefined;
  subject: string | undefined;
  body: string;
  bodyChars: number;
  nextBodyOffset?: number;
  /** File names only, inline images included: all of them go out with the mail. */
  attachments: string[];
}

export const getDraftTool = {
  declaration: {
    name: "gmail_get_draft",
    description:
      "Shows a draft as it will be sent: to, cc, bcc, subject, body and attachment names. Long bodies come in pages: when nextBodyOffset is present, call again with bodyOffset.",
    parameters: z.toJSONSchema(getDraftArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: getDraftArguments,
  // 1 request.
  async run(client, args, signal) {
    const draft = await client.getDraft(args.draftId, signal);
    const headers = draft.message.payload?.headers;
    const content = readContent(draft.message.payload);
    const text = bodyText(content);
    const end = args.bodyOffset + args.maxBodyChars;
    const view: DraftView = {
      draftId: draft.id,
      to: headerValue(headers, "To"),
      cc: headerValue(headers, "Cc"),
      bcc: headerValue(headers, "Bcc"),
      subject: headerValue(headers, "Subject"),
      body: text.slice(args.bodyOffset, end),
      bodyChars: text.length,
      attachments: content.attachments.map((attachment) => attachment.filename),
    };
    if (end < text.length) view.nextBodyOffset = end;
    return view;
  },
} satisfies ToolImplementation<GmailClient, typeof getDraftArguments>;
