import { z } from "zod";

/**
 * A Drive file as Drive returns it, and the small object the tools return
 * for it. Tools never pass Drive's response on as it is (guide, section 5).
 */

/** Drive's type for a folder. */
export const folderType = "application/vnd.google-apps.folder";

/** The fields a listing asks Drive for: everything {@link FileDetails} shows except `trashed`. */
export const listedFileFields =
  "id,name,mimeType,size,modifiedTime,owners(emailAddress),parents,webViewLink";

/** The fields a single file is read with: the listed ones and whether it is in the trash. */
export const fileFields = `${listedFileFields},trashed`;

/** Only the fields we ask for, and all but `id` may be missing (a folder has no size). */
export const driveFileSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  // Drive sends sizes as strings, because they can be larger than a JSON number holds exactly.
  size: z.string().optional(),
  modifiedTime: z.string().optional(),
  owners: z.array(z.object({ emailAddress: z.string().optional() })).optional(),
  parents: z.array(z.string()).optional(),
  webViewLink: z.string().optional(),
  trashed: z.boolean().optional(),
});
export type DriveFile = z.infer<typeof driveFileSchema>;

/**
 * One file as a tool returns it, with its fields in the order the tool
 * descriptions name them. A field Drive didn't send is `undefined`, which
 * the JSON result leaves out (a folder has no size).
 */
export interface FileDetails {
  id: string;
  name: string | undefined;
  type: string | undefined;
  size: number | undefined;
  modified: string | undefined;
  owners: string[];
  parents: string[];
  link: string | undefined;
  trashed: boolean | undefined;
}

/** Turns Drive's file into {@link FileDetails}. */
export function fileDetails(file: DriveFile): FileDetails {
  return {
    id: file.id,
    name: file.name,
    type: file.mimeType,
    size: sizeInBytes(file.size),
    modified: file.modifiedTime,
    owners: ownerAddresses(file),
    parents: file.parents ?? [],
    link: file.webViewLink,
    trashed: file.trashed,
  };
}

function ownerAddresses(file: DriveFile): string[] {
  const addresses: string[] = [];
  for (const owner of file.owners ?? []) {
    if (owner.emailAddress !== undefined) addresses.push(owner.emailAddress);
  }
  return addresses;
}

/** A size Drive sent that isn't a whole number of bytes is left out rather than guessed. */
function sizeInBytes(size: string | undefined): number | undefined {
  if (size === undefined || !/^\d+$/.test(size)) {
    return undefined;
  }
  return Number(size);
}
