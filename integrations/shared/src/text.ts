/**
 * Cuts `text` to at most `maxChars` characters, ending with `…` when it
 * was cut. Never splits a character made of two UTF-16 units.
 *
 * For limits on what a service sends, such as a tool result or a
 * description that goes into the model's context (guide, section 5).
 *
 * @throws RangeError when `maxChars` is below 1: there would be no room
 *   for the `…` that says the text was cut.
 *
 * @example
 * cutText("abcdef", 4); // "abc…"
 */
export function cutText(text: string, maxChars: number): string {
  if (!(maxChars >= 1)) {
    throw new RangeError("cutText needs a limit of at least 1 character.");
  }
  if (text.length <= maxChars) {
    return text;
  }
  let end = maxChars - 1;
  const last = text.charCodeAt(end - 1);
  // A high surrogate at the end would be half of a character such as an emoji.
  if (last >= 0xd800 && last <= 0xdbff) {
    end -= 1;
  }
  return `${text.slice(0, end)}…`;
}
