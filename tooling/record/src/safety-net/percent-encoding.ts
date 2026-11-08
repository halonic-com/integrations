/**
 * A run of text with at least one `%XX` escape in it, as in a URL or a form
 * value. It stops at whitespace, quotes and backslashes, so in a recording
 * file it never runs past the end of a JSON string.
 *
 * The lookbehind makes a match start only where a run starts. Without it, a
 * long run with no `%` in it, such as a base64 message body, is tried again
 * from every character, which takes seconds on a large message.
 */
export const PERCENT_ENCODED_RUN = /(?<![^\s"'<>\\])[^\s"'<>\\]*%[0-9A-Fa-f]{2}[^\s"'<>\\]*/g;

/** An escape for a printable ASCII character: addresses, numbers and tokens are made of these. */
const ASCII_ESCAPE = /%([2-7][0-9A-Fa-f])/g;

/** Twice: a URL inside a query value is encoded twice (`%2540` for `@`). */
const MAX_DECODE_ROUNDS = 2;

/**
 * Decodes the `%XX` escapes of printable ASCII characters and leaves the rest
 * as they are. Unlike `decodeURIComponent`, it never throws: a broken or
 * non-ASCII escape just stays. `+` stays too; as a space it would only
 * split what the scan looks for.
 */
export function decodePercentText(text: string): string {
  let decoded = text;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    decoded = decoded.replace(ASCII_ESCAPE, (_escape, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  }
  return decoded;
}
