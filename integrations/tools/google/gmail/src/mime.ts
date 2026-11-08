import { encodeBase64, encodeBase64Url, encodeUtf8 } from "./encoding.ts";

/**
 * Builds an outgoing message (RFC 5322 with MIME) and encodes it for
 * Gmail's `raw` field. Gmail sends it exactly as built and fills in `From`
 * with the account's own address.
 */

/** Everything an outgoing message holds. Recipients and subject are as the caller wrote them. */
export interface OutgoingMail {
  to: readonly string[];
  cc: readonly string[];
  bcc: readonly string[];
  subject: string;
  /** The plain-text body. */
  body: string;
  /** The HTML body, sent next to the plain one. */
  html?: string | undefined;
  /** For a reply: the original's `Message-ID`, and the `References` before it. */
  inReplyTo?: string | undefined;
  references?: string | undefined;
}

/**
 * Separates the plain and HTML parts. A fixed value keeps the message the
 * same in tests and in use. It can't appear inside a part, because both
 * parts are base64, whose alphabet has no "_".
 */
export const partBoundary = "halonic_alternative_part";

/**
 * No header injection through a value the model or another sender wrote:
 * a line break would start a new header, such as a `Bcc` nobody asked for.
 */
export function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

const isPrintableAscii = (value: string) => /^[\x20-\x7E]*$/.test(value);

/** RFC 2047: anything outside printable ASCII goes as UTF-8 in base64. */
export function encodeHeaderText(value: string): string {
  return isPrintableAscii(value) ? value : `=?UTF-8?B?${encodeBase64(encodeUtf8(value))}?=`;
}

/**
 * One recipient for a header. A display name outside printable ASCII
 * ("Zoë <zoe@example.com>") is encoded as RFC 2047 asks; the address itself
 * stays as it is.
 */
export function encodeAddress(value: string): string {
  const safe = headerSafe(value);
  const named = /^(.*?)\s*<([^<>]*)>$/.exec(safe);
  if (isPrintableAscii(safe) || named === null) return safe;
  // An encoded word can't sit inside quotes, so the name loses them.
  const name = (named[1] ?? "").replace(/^"(.*)"$/, "$1");
  return `${encodeHeaderText(name)} <${named[2] ?? ""}>`;
}

/** A header's list of recipients, separated by commas. */
const addressList = (addresses: readonly string[]) => addresses.map(encodeAddress).join(", ");

function headerLines(mail: OutgoingMail): string[] {
  const lines = [`To: ${addressList(mail.to)}`];
  if (mail.cc.length > 0) lines.push(`Cc: ${addressList(mail.cc)}`);
  if (mail.bcc.length > 0) lines.push(`Bcc: ${addressList(mail.bcc)}`);
  lines.push(`Subject: ${encodeHeaderText(headerSafe(mail.subject))}`);
  if (mail.inReplyTo) {
    const inReplyTo = headerSafe(mail.inReplyTo);
    const references = mail.references ? `${headerSafe(mail.references)} ${inReplyTo}` : inReplyTo;
    lines.push(`In-Reply-To: ${inReplyTo}`, `References: ${references}`);
  }
  lines.push("MIME-Version: 1.0");
  return lines;
}

/**
 * RFC 2045, section 6.8: base64 bodies in lines of at most 76 characters.
 * One long line would break RFC 5322's limit of 998 characters per line,
 * and a receiving server may refuse or cut it.
 */
export const base64LineLength = 76;

/** Base64 text cut into lines of `base64LineLength`; an empty body is one empty line. */
function base64Lines(base64: string): string[] {
  const lines: string[] = [];
  for (let start = 0; start < base64.length; start += base64LineLength) {
    lines.push(base64.slice(start, start + base64LineLength));
  }
  return lines.length > 0 ? lines : [""];
}

/** One text part's headers and body, in base64 so no line of it can look like a boundary. */
function textPart(type: "plain" | "html", text: string): string[] {
  return [
    `Content-Type: text/${type}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    ...base64Lines(encodeBase64(encodeUtf8(text))),
  ];
}

/** The whole message as MIME text, lines separated by CRLF. */
export function buildMime(mail: OutgoingMail): string {
  const headers = headerLines(mail);
  if (!mail.html) {
    return [...headers, ...textPart("plain", mail.body)].join("\r\n");
  }
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${partBoundary}"`,
    "",
    `--${partBoundary}`,
    ...textPart("plain", mail.body),
    `--${partBoundary}`,
    ...textPart("html", mail.html),
    `--${partBoundary}--`,
  ].join("\r\n");
}

/** The message as Gmail's `raw` field takes it. */
export function encodeRaw(mail: OutgoingMail): string {
  return encodeBase64Url(encodeUtf8(buildMime(mail)));
}
