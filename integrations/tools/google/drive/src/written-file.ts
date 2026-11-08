import type { DriveFile } from "./file.ts";

/**
 * What the tools that create or change a file return: the few fields their
 * descriptions promise, not the full `FileDetails`. Drive is asked
 * for only these, so the answer holds no owners.
 */

/** The fields a create, update or move asks Drive to answer with. */
export const writtenFileFields = "id,name,mimeType,parents,webViewLink";

/** One created or changed file as a tool returns it. */
export interface WrittenFile {
  id: string;
  name: string | undefined;
  type: string | undefined;
  link: string | undefined;
}

/** Turns Drive's answer into {@link WrittenFile}. */
export function writtenFile(file: DriveFile): WrittenFile {
  return { id: file.id, name: file.name, type: file.mimeType, link: file.webViewLink };
}
