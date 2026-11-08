import { z } from "zod";

/**
 * A Gmail message as the API returns it, and the summary the tools build
 * from it. Only the fields we read are checked; Gmail adds fields over time,
 * and they pass through unchecked.
 *
 * https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages
 */

const headerSchema = z.object({ name: z.string(), value: z.string() });
export type Header = z.infer<typeof headerSchema>;

/** One MIME part. A multipart part holds more parts; the payload is the top one. */
export interface MessagePart {
  partId?: string | undefined;
  mimeType?: string | undefined;
  filename?: string | undefined;
  headers?: Header[] | undefined;
  body?:
    | { attachmentId?: string | undefined; size?: number | undefined; data?: string | undefined }
    | undefined;
  parts?: MessagePart[] | undefined;
}

export const messagePartSchema: z.ZodType<MessagePart> = z.object({
  partId: z.string().optional(),
  mimeType: z.string().optional(),
  filename: z.string().optional(),
  headers: z.array(headerSchema).optional(),
  body: z
    .object({
      attachmentId: z.string().optional(),
      size: z.number().optional(),
      data: z.string().optional(),
    })
    .optional(),
  parts: z.lazy(() => z.array(messagePartSchema)).optional(),
});

export const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).default([]),
  snippet: z.string().optional(),
  /** Milliseconds since 1970, as a string. */
  internalDate: z.string().optional(),
  payload: messagePartSchema.optional(),
});
export type Message = z.infer<typeof messageSchema>;

/** The headers a summary shows. `gmail_search` asks Gmail for only these. */
export const summaryHeaders = ["From", "To", "Cc", "Subject", "Date"] as const;

/** What every tool that lists messages returns per message. */
export interface MessageSummary {
  id: string;
  threadId: string;
  from: string | undefined;
  to: string | undefined;
  cc: string | undefined;
  subject: string | undefined;
  date: string | undefined;
  labels: string[];
  snippet: string | undefined;
}

/**
 * A header's value by name, ignoring case, as mail headers do. `undefined`
 * when the message doesn't have it, so the field is left out of the JSON.
 */
export function headerValue(
  headers: readonly Header[] | undefined,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  return headers?.find((header) => header.name.toLowerCase() === wanted)?.value;
}

export function summarize(message: Message): MessageSummary {
  const headers = message.payload?.headers;
  return {
    id: message.id,
    threadId: message.threadId,
    from: headerValue(headers, "From"),
    to: headerValue(headers, "To"),
    cc: headerValue(headers, "Cc"),
    subject: headerValue(headers, "Subject"),
    date: headerValue(headers, "Date"),
    labels: message.labelIds,
    snippet: message.snippet,
  };
}
