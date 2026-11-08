/**
 * Finds e-mail addresses, including ones in HTML, URLs and mail headers.
 * Shared by the scrubber and the safety net, so both judge text the same way.
 *
 * This works from each `@` outward rather than with one regular expression.
 * A pattern that may start at any character tries again from every character
 * of a long run with no `@` in it, such as a base64 message body, which is
 * slow on large recordings. A pattern that only starts where a run of address
 * characters starts misses an address glued onto the end of another one
 * (`one@mail.test.x@other.test`). Starting from the `@` avoids both.
 */

/** The most characters an address may have before its `@`. */
const MAX_LOCAL_PART_LENGTH = 64;

/** A character that may appear before the `@`. */
const LOCAL_PART_CHARACTER = /[\w.%+-]/;

/** The domain, matched from just after the `@`. Sticky, so it only matches there. */
const DOMAIN = /[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/y;

export interface FoundEmail {
  readonly address: string;
  /** Where the address starts in the text. */
  readonly index: number;
}

/** Every e-mail address in the text, in order and without overlaps. */
export function findEmails(text: string): FoundEmail[] {
  const found: FoundEmail[] = [];
  // Where the last address ended: the next one can't start before it.
  let previousEnd = 0;

  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    const start = startOfLocalPart(text, at, previousEnd);
    if (start === at) {
      continue;
    }
    DOMAIN.lastIndex = at + 1;
    const domain = DOMAIN.exec(text);
    if (domain === null) {
      continue;
    }
    const end = at + 1 + domain[0].length;
    found.push({ address: text.slice(start, end), index: start });
    previousEnd = end;
  }
  return found;
}

/** How far back from the `@` the part before it reaches, at most 64 characters. */
function startOfLocalPart(text: string, at: number, earliest: number): number {
  const limit = Math.max(earliest, at - MAX_LOCAL_PART_LENGTH);
  let start = at;
  while (start > limit && LOCAL_PART_CHARACTER.test(text.charAt(start - 1))) {
    start--;
  }
  return start;
}
