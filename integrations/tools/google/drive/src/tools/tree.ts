import { z } from "zod";
import type { DriveClient, FileList, ListFilesRequest } from "../client.ts";
import { type DriveFile, folderType, sizeInBytes } from "../file.ts";
import type { ToolImplementation } from "../kit.ts";
import { allOf, hasType, inFolder, notTrashed } from "../query.ts";
import { driveIdSchema } from "./arguments.ts";

/** The most folder listings one call makes: one request each. */
export const maxTreeListings = 25;

/** The most items one call returns. The result goes into the model's context. */
export const maxTreeItems = 1_000;

const treeArguments = z.strictObject({
  folderId: driveIdSchema.describe('Folder id, a shared drive id, or "root" for My Drive.'),
  depth: z.int().min(1).max(5).default(3).describe("Levels of subfolders to list (default 3)."),
  maxItems: z
    .int()
    .min(1)
    .max(maxTreeItems)
    .default(300)
    .describe("Items to return at most (default 300)."),
  foldersOnly: z.boolean().default(false).describe("Only list folders (for filing decisions)."),
});
type TreeArguments = z.infer<typeof treeArguments>;

/** One item of the tree. A field Drive didn't send is `undefined`, which the JSON result leaves out. */
interface TreeEntry {
  /** From the listed folder, such as `/Projects/Plan`. A folder's path ends in `/`. */
  path: string;
  id: string;
  /** `folder`, or the file's type. */
  type: string | undefined;
  size: number | undefined;
  modified: string | undefined;
}

/** What the tool promises in its description, and nothing more. */
interface TreeResult {
  folderId: string;
  depth: number;
  count: number;
  /** Present when the call stopped before listing everything. */
  truncated?: true;
  entries: TreeEntry[];
}

/** A folder still to list, and its path from the top. */
interface FolderToList {
  id: string;
  path: string;
}

/** The tree shows less than a search does, so it asks Drive for less. */
const treeFileFields = "id,name,mimeType,size,modifiedTime";

/**
 * One folder's listing: one page, folders first, then by name.
 *
 * Every folder of a level asks for all the items left, not a share of them.
 * The levels are listed at the same time and added in order, so the first
 * folders fill the result. Splitting `itemsLeft` would cut them short and
 * change which items come back.
 */
function listing(folder: FolderToList, args: TreeArguments, itemsLeft: number): ListFilesRequest {
  const clauses = [inFolder(folder.id), notTrashed];
  if (args.foldersOnly) clauses.push(hasType(folderType));
  return {
    query: allOf(clauses),
    pageSize: itemsLeft,
    orderBy: "folder,name",
    fields: treeFileFields,
  };
}

function treeEntry(file: DriveFile, path: string): TreeEntry {
  const isFolder = file.mimeType === folderType;
  return {
    path: isFolder ? `${path}/` : path,
    id: file.id,
    type: isFolder ? "folder" : file.mimeType,
    size: sizeInBytes(file.size),
    modified: file.modifiedTime,
  };
}

/**
 * Collects the tree a level at a time and keeps to the limits: at most
 * `maxItems` entries and {@link maxTreeListings} listings. It says
 * `truncated` when a limit or a second page left something out.
 */
class TreeWalk {
  readonly #args: TreeArguments;
  readonly #entries: TreeEntry[] = [];
  #listingsLeft = maxTreeListings;
  #truncated = false;

  constructor(args: TreeArguments) {
    this.#args = args;
  }

  /**
   * Whether to list another level: something left to list, and no limit
   * reached. When the entries are already full, the folders left might be
   * empty, but nobody can tell without listing them, so it says `truncated`.
   */
  goesOn(level: readonly FolderToList[], depth: number): boolean {
    if (depth > this.#args.depth || level.length === 0) return false;
    if (this.#entries.length >= this.#args.maxItems) this.#truncated = true;
    return !this.#truncated;
  }

  /** The folders of this level the listing limit still allows, each with its listing. */
  listingsFor(
    level: readonly FolderToList[],
  ): { folder: FolderToList; request: ListFilesRequest }[] {
    const allowed = level.slice(0, this.#listingsLeft);
    if (allowed.length < level.length) this.#truncated = true;
    this.#listingsLeft -= allowed.length;
    const itemsLeft = this.#args.maxItems - this.#entries.length;
    return allowed.map((folder) => ({ folder, request: listing(folder, this.#args, itemsLeft) }));
  }

  /** Adds one folder's listing and returns its subfolders, to list on the next level. */
  add(folder: FolderToList, page: FileList): FolderToList[] {
    if (page.nextPageToken !== undefined) this.#truncated = true;
    const subfolders: FolderToList[] = [];
    for (const file of page.files) {
      if (this.#entries.length >= this.#args.maxItems) {
        this.#truncated = true;
        break;
      }
      const path = `${folder.path}/${file.name ?? file.id}`;
      this.#entries.push(treeEntry(file, path));
      if (file.mimeType === folderType) subfolders.push({ id: file.id, path });
    }
    return subfolders;
  }

  result(): TreeResult {
    const result: TreeResult = {
      folderId: this.#args.folderId,
      depth: this.#args.depth,
      count: this.#entries.length,
      entries: this.#entries,
    };
    if (this.#truncated) result.truncated = true;
    return result;
  }
}

export const treeTool = {
  declaration: {
    name: "drive_tree",
    description:
      'Lists a folder and its subfolders a few levels deep in one call: path, id, type, size and modified time per item (folders end in "/"). When truncated is true, list a subfolder on its own for the rest.',
    parameters: z.toJSONSchema(treeArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: treeArguments,
  // At most 25 requests: one listing per folder, a level at a time.
  async run(client, args, signal): Promise<TreeResult> {
    const walk = new TreeWalk(args);
    let level: FolderToList[] = [{ id: args.folderId, path: "" }];
    for (let depth = 1; walk.goesOn(level, depth); depth++) {
      // The folders of one level are listed at the same time; their results are added in order.
      const listings = await Promise.all(
        walk.listingsFor(level).map(async ({ folder, request }) => ({
          folder,
          page: await client.listFiles(request, signal),
        })),
      );
      level = listings.flatMap(({ folder, page }) => walk.add(folder, page));
    }
    return walk.result();
  },
} satisfies ToolImplementation<DriveClient, typeof treeArguments>;
