/**
 * Base64 and UTF-8 for mail bodies. Gmail sends every body as base64url
 * (RFC 4648, section 5) and takes an outgoing message the same way. The
 * integration preset has no `TextDecoder`, `TextEncoder`, `atob` or `btoa`
 * types (no DOM, no Node), so they are written out here; they are
 * candidates for the kit.
 */

const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Each character's 6-bit value. Both alphabets: `+/` (base64) and `-_` (base64url). */
const sextets: ReadonlyMap<string, number> = new Map([
  ...[...base64Alphabet].map((character, value) => [character, value] as const),
  ["-", 62],
  ["_", 63],
]);

/**
 * Decodes base64 or base64url. Padding, line breaks and any other character
 * outside the alphabets are skipped, so a damaged or scrubbed body still
 * decodes to something instead of failing the whole message.
 */
export function decodeBase64(text: string): Uint8Array {
  const values: number[] = [];
  for (const character of text) {
    const value = sextets.get(character);
    if (value !== undefined) values.push(value);
  }
  const bytes = new Uint8Array(Math.floor((values.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const value of values) {
    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}

/** The character that stands for bytes that aren't valid UTF-8. */
const replacementCharacter = "�";

/**
 * Decodes UTF-8, like `TextDecoder` does: each invalid sequence (a stray
 * continuation byte, an overlong form, a surrogate, a value past U+10FFFF)
 * becomes U+FFFD and decoding goes on with the next byte.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  const characters: string[] = [];
  let index = 0;
  while (index < bytes.length) {
    const sequence = readUtf8Sequence(bytes, index);
    characters.push(
      sequence === undefined ? replacementCharacter : String.fromCodePoint(sequence.codePoint),
    );
    index += sequence?.length ?? 1;
  }
  return characters.join("");
}

/** The lead byte's sequence length and the smallest code point that length may carry. */
function sequenceShape(lead: number): { length: number; minimum: number } | undefined {
  if (lead < 0x80) return { length: 1, minimum: 0 };
  if (lead >= 0xc2 && lead <= 0xdf) return { length: 2, minimum: 0x80 };
  if (lead >= 0xe0 && lead <= 0xef) return { length: 3, minimum: 0x800 };
  if (lead >= 0xf0 && lead <= 0xf4) return { length: 4, minimum: 0x10000 };
  return undefined; // a continuation byte, or a lead byte UTF-8 never uses
}

function readUtf8Sequence(
  bytes: Uint8Array,
  start: number,
): { codePoint: number; length: number } | undefined {
  const lead = bytes[start] ?? 0;
  const shape = sequenceShape(lead);
  if (shape === undefined) return undefined;
  if (shape.length === 1) return { codePoint: lead, length: 1 };
  // The lead byte keeps 7 - length bits of the code point.
  let codePoint = lead & (0xff >> (shape.length + 1));
  for (let offset = 1; offset < shape.length; offset++) {
    const byte = bytes[start + offset];
    if (byte === undefined || (byte & 0xc0) !== 0x80) return undefined;
    codePoint = (codePoint << 6) | (byte & 0x3f);
  }
  const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
  if (codePoint < shape.minimum || codePoint > 0x10ffff || isSurrogate) return undefined;
  return { codePoint, length: shape.length };
}

/** A Gmail body (`body.data`) as text. Gmail doesn't convert charsets; bodies are read as UTF-8. */
export function decodeBody(data: string | undefined): string {
  return data === undefined || data === "" ? "" : decodeUtf8(decodeBase64(data));
}

/** Encodes text as UTF-8, like `TextEncoder` does: a lone surrogate becomes U+FFFD. */
export function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of text) {
    let codePoint = character.codePointAt(0) ?? 0xfffd;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) codePoint = 0xfffd;
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** Standard base64 with padding, as MIME bodies and encoded headers use it. */
export function encodeBase64(bytes: Uint8Array): string {
  const characters: string[] = [];
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = [bytes[index] ?? 0, bytes[index + 1] ?? 0, bytes[index + 2] ?? 0] as const;
    const triple = (chunk[0] << 16) | (chunk[1] << 8) | chunk[2];
    const available = Math.min(3, bytes.length - index);
    for (let sextet = 0; sextet < 4; sextet++) {
      // Three bytes fill four characters; fewer fill one more than they have, then "=".
      characters.push(
        sextet <= available ? (base64Alphabet[(triple >> (18 - 6 * sextet)) & 0x3f] ?? "") : "=",
      );
    }
  }
  return characters.join("");
}

/** Base64url without padding, as Gmail takes a whole message in `raw`. */
export function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
