import { cutText } from "@halonicjs/integration-shared";
import { z } from "zod";
import { maxTitleChars } from "./task.ts";

/** One document of a task as Paperclip sends it, only the fields we read. */
export const documentSchema = z.object({
  key: z.string(),
  title: z.string().nullable(),
  body: z.string(),
  updatedAt: z.string(),
});
export type Document = z.infer<typeof documentSchema>;

/** One document, as `issues_get_document` returns it. */
export interface DocumentDetail {
  key: string;
  /** Left out when the document has no title. */
  title?: string;
  text: string;
  /** When the document last changed. */
  updatedAt: string;
}

/** The sheet's promise: a document's text is cut after 50,000 characters. */
export const maxDocumentChars = 50_000;

export function documentDetail(document: Document): DocumentDetail {
  const detail: DocumentDetail = {
    key: document.key,
    text: cutText(document.body, maxDocumentChars),
    updatedAt: document.updatedAt,
  };
  if (document.title !== null) detail.title = cutText(document.title, maxTitleChars);
  return detail;
}
