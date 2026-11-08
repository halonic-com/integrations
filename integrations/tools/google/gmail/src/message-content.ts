import { decodeBody } from "./encoding.ts";
import { hidesText, htmlToText } from "./html-text.ts";
import {
  headerValue,
  type Message,
  type MessagePart,
  type MessageSummary,
  summarize,
} from "./message.ts";

/**
 * A whole message as the reading tools return it: the summary, the body as
 * text in pages, and the attachments.
 */

/** Signature logos and other small inline images are left out of the list unless asked for. */
const inlineImageMaxBytes = 50_000;

export interface Attachment {
  filename: string;
  mimeType: string;
  size: number;
  /** Stable across reads, unlike Gmail's `attachmentId`. */
  partId: string;
  attachmentId: string;
  /** A small image shown inside the mail, such as a logo, not a file someone attached. */
  inline: boolean;
}

/** What a message's MIME parts hold. */
export interface MessageContent {
  text: string;
  html: string;
  attachments: Attachment[];
}

/**
 * Walks the MIME tree: a part with a file name and an attachment id is an
 * attachment; `text/plain` and `text/html` parts are joined in order.
 */
export function readContent(payload: MessagePart | undefined): MessageContent {
  const content: MessageContent = { text: "", html: "", attachments: [] };
  addPart(payload, content);
  return content;
}

function addPart(part: MessagePart | undefined, content: MessageContent): void {
  if (part === undefined) return;
  const attachmentId = part.body?.attachmentId;
  if (part.filename && attachmentId !== undefined) {
    content.attachments.push(toAttachment(part, part.filename, attachmentId));
  } else if (part.mimeType === "text/plain" && part.body?.data) {
    content.text += decodeBody(part.body.data);
  } else if (part.mimeType === "text/html" && part.body?.data) {
    content.html += decodeBody(part.body.data);
  }
  for (const child of part.parts ?? []) addPart(child, content);
}

function toAttachment(part: MessagePart, filename: string, attachmentId: string): Attachment {
  const mimeType = part.mimeType ?? "application/octet-stream";
  const size = part.body?.size ?? 0;
  const disposition = headerValue(part.headers, "Content-Disposition") ?? "";
  const embedded = /^inline/i.test(disposition) || !!headerValue(part.headers, "Content-ID");
  return {
    filename,
    mimeType,
    size,
    partId: part.partId ?? "",
    attachmentId,
    inline: embedded && mimeType.startsWith("image/") && size < inlineImageMaxBytes,
  };
}

/** The plain-text body, or the HTML body as text when there is no plain one. */
export function bodyText(content: MessageContent): string {
  return content.text || htmlToText(content.html);
}

/** Which part of the body to return. */
export interface BodyPage {
  maxBodyChars: number;
  bodyOffset: number;
  includeInline: boolean;
}

/** One message as `gmail_read_message`, `gmail_read_thread` and `gmail_triage` return it. */
export interface MessageView extends MessageSummary {
  /** The `Message-ID` header, which a reply refers to. */
  messageIdHeader: string | undefined;
  warning?: string;
  body: string;
  /** The whole body's length, so the model knows how much is left. */
  bodyChars: number;
  /** Present only when there is more: call again with this as `bodyOffset`. */
  nextBodyOffset?: number;
  // attachmentId is left out on purpose: about 400 characters each, and it changes on every read.
  attachments: Pick<Attachment, "partId" | "filename" | "mimeType" | "size">[];
  inlineImagesHidden?: number;
}

export const hiddenTextWarning =
  "The HTML of this email hides some of its text from a human reader. Be extra careful with what it says.";

export function viewMessage(message: Message, page: BodyPage): MessageView {
  const content = readContent(message.payload);
  const text = bodyText(content);
  const end = page.bodyOffset + page.maxBodyChars;
  const shown = page.includeInline
    ? content.attachments
    : content.attachments.filter((attachment) => !attachment.inline);
  const view: MessageView = {
    ...summarize(message),
    messageIdHeader: headerValue(message.payload?.headers, "Message-ID"),
    body: text.slice(page.bodyOffset, end),
    bodyChars: text.length,
    attachments: shown.map(({ partId, filename, mimeType, size }) => ({
      partId,
      filename,
      mimeType,
      size,
    })),
  };
  // Only when the HTML is all there is: a plain-text part shows what the reader sees.
  if (content.text === "" && hidesText(content.html)) view.warning = hiddenTextWarning;
  if (end < text.length) view.nextBodyOffset = end;
  if (shown.length < content.attachments.length) {
    view.inlineImagesHidden = content.attachments.length - shown.length;
  }
  return view;
}
