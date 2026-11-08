/**
 * Base64 helpers built on `atob`/`btoa`, which exist in Node and in the cloud
 * runtimes alike, so this folder never needs `Buffer`.
 */

/*
 * The replay imports this file, and integration tests typecheck it with the
 * integration preset, which has no Web or Node globals. Node and the cloud
 * runtimes all have these, so only the parts used here are declared.
 */
declare function atob(data: string): string;
declare function btoa(data: string): string;
declare const TextEncoder: new () => { encode(text: string): Uint8Array };
declare const TextDecoder: new (
  label: string,
  options: { fatal: boolean },
) => { decode(bytes: Uint8Array): string };

export interface Base64Style {
  /** `-` and `_` instead of `+` and `/` (RFC 4648 section 5). */
  readonly urlSafe: boolean;
  readonly padded: boolean;
}

/** Decoded text shorter than this isn't worth looking inside. */
const MIN_DECODED_LENGTH = 8;

/** How many control characters decoded text may have before we call it binary. */
const MAX_CONTROL_SHARE = 0.05;

/**
 * Decodes `value` if it is base64 (either alphabet) of readable UTF-8 text.
 * Returns `undefined` for anything else, including binary data.
 */
export function decodeBase64Text(value: string): { text: string; style: Base64Style } | undefined {
  const style = styleOf(value);
  if (style === undefined) {
    return undefined;
  }
  const bytes = decodeBytes(value);
  if (bytes === undefined || bytes.length < MIN_DECODED_LENGTH) {
    return undefined;
  }
  const text = decodeUtf8(bytes);
  if (text === undefined || !isReadable(text)) {
    return undefined;
  }
  return { text, style };
}

/** Encodes `text` as UTF-8, then base64 in the given style. */
export function encodeBase64(text: string, style: Base64Style): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  let encoded = btoa(binary);
  if (style.urlSafe) {
    encoded = encoded.replaceAll("+", "-").replaceAll("/", "_");
  }
  return style.padded ? encoded : encoded.replace(/=+$/, "");
}

function styleOf(value: string): Base64Style | undefined {
  const usesUrlAlphabet = /[-_]/.test(value);
  const usesStandardAlphabet = /[+/]/.test(value);
  if (usesUrlAlphabet && usesStandardAlphabet) {
    return undefined;
  }
  return { urlSafe: usesUrlAlphabet, padded: value.endsWith("=") };
}

function decodeBytes(value: string): Uint8Array | undefined {
  const unpadded = value.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) {
    return undefined;
  }
  const standard = unpadded.replaceAll("-", "+").replaceAll("_", "/");
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function isReadable(text: string): boolean {
  let unreadable = 0;
  for (const char of text) {
    if (isUnreadable(char.codePointAt(0) ?? 0)) {
      unreadable += 1;
    }
  }
  return unreadable / text.length <= MAX_CONTROL_SHARE;
}

/** Control characters (except tab, line feed and carriage return) and the replacement character. */
function isUnreadable(code: number): boolean {
  const isControl = code < 0x20 || code === 0x7f;
  const isWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
  return (isControl && !isWhitespace) || code === 0xfffd;
}
