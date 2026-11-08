import { z } from "zod";
import type { DriveClient } from "../client.ts";
import { type FileDetails, fileDetails } from "../file.ts";
import type { ToolImplementation } from "../kit.ts";
import { allOf, inFolder, nameOrContentHas, notTrashed } from "../query.ts";
import { driveIdSchema, pageTokenSchema } from "./arguments.ts";

/** Drive's own limit for one page is 1,000; the old connector allowed 100. */
export const maxSearchResults = 100;

const searchArguments = z.strictObject({
  text: z.string().min(1).max(500).optional().describe("Words to find in file names and contents."),
  folderId: driveIdSchema.optional().describe("Only files directly inside this folder."),
  query: z
    .string()
    .min(1)
    .max(2_000)
    .optional()
    .describe(`Drive query syntax, such as "mimeType = 'application/pdf'".`),
  pageSize: z
    .int()
    .min(1)
    .max(maxSearchResults)
    .default(25)
    .describe("Files to return (default 25)."),
  pageToken: pageTokenSchema
    .optional()
    .describe("nextPageToken from the previous search, for more results."),
});
type SearchArguments = z.infer<typeof searchArguments>;

/** What the tool promises in its description, and nothing more. */
interface SearchResult {
  files: FileDetails[];
  nextPageToken?: string;
}

/**
 * The Drive query for the arguments. The model's own `query` is put in
 * brackets, so its `or` can't reach past the trash clause.
 */
export function searchQuery(args: Pick<SearchArguments, "text" | "folderId" | "query">): string {
  const clauses = [notTrashed];
  if (args.text !== undefined) clauses.push(nameOrContentHas(args.text));
  if (args.folderId !== undefined) clauses.push(inFolder(args.folderId));
  if (args.query !== undefined) clauses.push(`(${args.query})`);
  return allOf(clauses);
}

export const searchTool = {
  declaration: {
    name: "drive_search",
    description:
      "Finds files. Use text for a name and full-text search, folderId to list a folder, or query for Drive query syntax. Trashed files are left out. Returns id, name, type, size, modified time, owners, parents and link per file.",
    parameters: z.toJSONSchema(searchArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: searchArguments,
  // One request.
  async run(client, args, signal): Promise<SearchResult> {
    const page = await client.listFiles(
      {
        query: searchQuery(args),
        pageSize: args.pageSize,
        // Drive refuses an order with a full-text search; it then sorts by relevance.
        orderBy: args.text === undefined ? "modifiedTime desc" : undefined,
        pageToken: args.pageToken,
      },
      signal,
    );
    const result: SearchResult = { files: page.files.map(fileDetails) };
    if (page.nextPageToken !== undefined) result.nextPageToken = page.nextPageToken;
    return result;
  },
} satisfies ToolImplementation<DriveClient, typeof searchArguments>;
