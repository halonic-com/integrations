import type { McpToolResult } from "@halonicjs/integration-mcp";
import { cutText } from "@halonicjs/integration-shared";
import type { KnowledgeDoc } from "./kit.ts";
import { maxDocumentChars, maxTitleChars } from "./limits.ts";
import { asJsonObject, parseJson, stringField, textsOf } from "./structured.ts";

/** The field names servers use for a document, in the order we look for them. */
const contentFields = ["content", "text", "body"] as const;
const titleFields = ["title", "name"] as const;

/**
 * Maps the get tool's answer to the document with `ref`, or `null` when
 * the answer has no text.
 *
 * A single JSON object with one of {@link contentFields} gives the content
 * and, if it has one, the title. Any other answer is the document's text
 * as it is, titled by its ref. The ref is always the caller's: a server
 * can't swap in another document's. The content is cut to
 * {@link maxDocumentChars}, and a note at the end says so.
 */
export function toDocument(result: McpToolResult, ref: string): KnowledgeDoc | null {
  const texts = textsOf(result);
  if (texts.length === 0) {
    return null;
  }
  const [onlyText] = texts;
  const object =
    texts.length === 1 && onlyText !== undefined ? asJsonObject(parseJson(onlyText)) : undefined;
  const structuredContent = object === undefined ? undefined : stringField(object, contentFields);
  if (object !== undefined && structuredContent !== undefined) {
    return {
      ref,
      title: cutText(stringField(object, titleFields) ?? ref, maxTitleChars),
      content: limitDocument(structuredContent),
    };
  }
  return {
    ref,
    title: cutText(ref, maxTitleChars),
    content: limitDocument(texts.join("\n\n")),
  };
}

/** The note at the end of a document that was cut, so the reader knows there is more. */
export const cutNote = `\n\n[Cut: the document is longer than ${maxDocumentChars} characters.]`;

function limitDocument(content: string): string {
  if (content.length <= maxDocumentChars) {
    return content;
  }
  return cutText(content, maxDocumentChars - cutNote.length) + cutNote;
}
