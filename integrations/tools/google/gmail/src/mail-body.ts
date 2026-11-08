import { htmlToText } from "./html-text.ts";
import { headerValue, type Message } from "./message.ts";
import { readContent } from "./message-content.ts";

/**
 * The body of an outgoing mail as Gmail on the web lays it out: the
 * caller's text, then the account's signature, then the quoted original
 * of a reply. The Gmail API sends a message exactly as given; only Gmail's
 * own compose window adds the signature and the quote, so they are added
 * here, as the old connector did.
 */

/** The plain body and, when there is one, the HTML body. */
export interface MailBodies {
  body: string;
  html?: string | undefined;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain text as HTML lines, without its trailing blank lines. */
function plainAsHtml(text: string): string {
  return escapeHtml(text.trimEnd()).replace(/\r?\n/g, "<br>");
}

/** Adds a block at the end of an HTML body: before `</body>` when it's a whole document. */
function appendToHtml(html: string, block: string): string {
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, (end) => `${block}${end}`)
    : `${html}${block}`;
}

/** Whitespace and case don't matter when looking for the signature in a body. */
const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Appends the signature, in the plain body and in an HTML body (made from
 * the plain one when there is none). Leaves the mail as it is when the
 * signature is empty or the caller already wrote it into the body.
 *
 * @param signatureHtml - the account's signature, as Gmail keeps it: HTML
 */
export function withSignature(mail: MailBodies, signatureHtml: string): MailBodies {
  const signatureText = htmlToText(signatureHtml);
  if (!signatureText || squash(mail.body).includes(squash(signatureText))) {
    return mail;
  }
  const block = `<br clear="all"><div><br></div><div dir="ltr" class="gmail_signature">${signatureHtml}</div>`;
  return {
    body: `${mail.body.trimEnd()}\n\n${signatureText}`,
    html: mail.html
      ? appendToHtml(mail.html, block)
      : `<div dir="ltr">${plainAsHtml(mail.body)}${block}</div>`,
  };
}

/**
 * How the quote's attribution line shows the original's date: "2026-11-02
 * 09:00 UTC". The integration doesn't know the user's time zone, so it says
 * UTC. Built by hand rather than with `Intl`, whose output depends on the
 * runtime's locale data: this is the same in every runtime and in tests.
 */
function utcDateTime(date: Date): string {
  const iso = date.toISOString(); // "2026-11-02T09:00:00.000Z"
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** "On 2026-11-02 09:00 UTC, Billing <billing@example.com> wrote:" */
export function attributionLine(original: Message): string {
  const from = headerValue(original.payload?.headers, "From") ?? "";
  // Gmail always sends internalDate; without a valid one, the line says only who wrote.
  const sent = new Date(
    original.internalDate === undefined ? Number.NaN : Number(original.internalDate),
  );
  return Number.isNaN(sent.getTime())
    ? `${from} wrote:`
    : `On ${utcDateTime(sent)}, ${from} wrote:`;
}

/** The inside of `<body>` when the HTML is a whole document, without its head or styles. */
function htmlFragment(html: string): string {
  const inner = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return inner
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!doctype[^>]*>|<\/?html[^>]*>/gi, "")
    .trim();
}

/** Quotes the original below the mail: "> " lines in the plain body, a blockquote in the HTML one. */
export function withQuote(mail: MailBodies, original: Message): Required<MailBodies> {
  const content = readContent(original.payload);
  const attribution = attributionLine(original);
  const text = (content.text || htmlToText(content.html)).replace(/\r\n/g, "\n").trimEnd();
  const quotedText = text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  const inner = content.html
    ? htmlFragment(content.html)
    : `<div dir="ltr">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
  const quote =
    '<br><div class="gmail_quote">' +
    `<div dir="ltr" class="gmail_attr">${escapeHtml(attribution)}<br></div>` +
    '<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">' +
    `${inner}</blockquote></div>`;
  return {
    body: `${mail.body.trimEnd()}\n\n${attribution}\n${quotedText}`,
    html: mail.html
      ? appendToHtml(mail.html, quote)
      : `<div dir="ltr">${plainAsHtml(mail.body)}</div>${quote}`,
  };
}
