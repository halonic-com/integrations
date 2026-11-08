import { z } from "zod";

/**
 * The Google types an upload can turn into. Drive converts the content when
 * the metadata asks for a Google type and the content is of a type it can
 * import, such as Markdown, HTML or plain text for a Doc and CSV for a
 * Sheet.
 *
 * https://developers.google.com/workspace/drive/api/guides/manage-uploads#import-docs
 */
const googleTypes = {
  document: "application/vnd.google-apps.document",
  spreadsheet: "application/vnd.google-apps.spreadsheet",
} as const;

/** The `convertTo` argument of `drive_create_file`. */
export const convertToSchema = z
  .enum(["document", "spreadsheet"])
  .optional()
  .describe("Turn the content into a Google Doc or Sheet.");

export type ConvertTo = keyof typeof googleTypes;

/** What `drive_create_file` knows about the file it creates. */
export interface NewFile {
  readonly name: string;
  /** The type of the content that is uploaded, such as `text/csv`. */
  readonly contentType: string;
  /** The folder to create it in; left out, Drive puts it at the top of My Drive. */
  readonly folderId?: string | undefined;
  readonly convertTo?: ConvertTo | undefined;
}

/** The metadata part of a new file's upload, in the field order the old connector sent. */
export interface NewFileMetadata {
  readonly name: string;
  readonly parents?: readonly string[];
  /** The Google type to convert to, or else the content's own type. */
  readonly mimeType: string;
}

/**
 * The metadata for a new file. With `convertTo`, Drive stores a Google Doc
 * or Sheet made from the content; without it, the file keeps the content's
 * type.
 *
 * @example
 * newFileMetadata({ name: "Budget", contentType: "text/csv", convertTo: "spreadsheet" });
 * // { name: "Budget", mimeType: "application/vnd.google-apps.spreadsheet" }
 */
export function newFileMetadata(file: NewFile): NewFileMetadata {
  const mimeType = file.convertTo === undefined ? file.contentType : googleTypes[file.convertTo];
  if (file.folderId === undefined) {
    return { name: file.name, mimeType };
  }
  return { name: file.name, parents: [file.folderId], mimeType };
}
