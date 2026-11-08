/**
 * How `drive_read_file` gets a file's text: Google's own files are
 * exported, text files are downloaded, and anything else is binary.
 */

/**
 * The formats each Google file type is exported as, best first. Drive's
 * Markdown export can be refused for a document, so plain text follows.
 * A `Map`, because the key is a type Drive sent.
 */
const exportFormats: ReadonlyMap<string, readonly string[]> = new Map([
  ["application/vnd.google-apps.document", ["text/markdown", "text/plain"]],
  ["application/vnd.google-apps.spreadsheet", ["text/csv"]], // Drive exports only the first sheet
  ["application/vnd.google-apps.presentation", ["text/plain"]],
  ["application/vnd.google-apps.drawing", ["image/svg+xml"]],
]);

/** How to get a file's text. */
export type ReadPlan =
  | { kind: "export"; formats: readonly string[] }
  | { kind: "download"; format: string }
  | { kind: "binary" };

/** Types that are text, though not under `text/`, as in the old connector. */
const textLikeType = /json|xml|csv|javascript|yaml/;

export function readPlan(type: string | undefined): ReadPlan {
  const formats = type === undefined ? undefined : exportFormats.get(type);
  if (formats !== undefined) {
    return { kind: "export", formats };
  }
  if (type !== undefined && (type.startsWith("text/") || textLikeType.test(type))) {
    return { kind: "download", format: type };
  }
  return { kind: "binary" };
}

/** One part of a long text. */
export interface TextPart {
  content: string;
  /** Where the next part starts; missing on the last part. */
  nextOffset?: number;
}

/**
 * Returns at most `maxChars` characters from `offset`. A part doesn't end
 * between the two halves of a character outside the Basic Multilingual
 * Plane (an emoji, say), so each part is valid text. The one exception is
 * a part of one character: it must move forward, or a reader would ask for
 * the same part again and again.
 */
export function textPart(text: string, offset: number, maxChars: number): TextPart {
  let end = Math.min(offset + maxChars, text.length);
  if (end < text.length && end - 1 > offset && isHighSurrogate(text.charCodeAt(end - 1))) {
    end -= 1;
  }
  const part: TextPart = { content: text.slice(offset, end) };
  if (end < text.length) part.nextOffset = end;
  return part;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
