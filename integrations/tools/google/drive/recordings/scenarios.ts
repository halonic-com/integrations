import { drive } from "../src/index.ts";
import type { IntegrationConnection, Scenario } from "../src/kit.ts";

/**
 * Live `drive_tree` scenarios for `pnpm record`. They answer the three
 * questions from the integrations#75 review, which the hand-written
 * recordings can't: they only show what we expected Google to send.
 *
 * The scenarios find their folders by name, so no id from one test account
 * ends up in the repo. Before recording, the test account needs:
 *
 * - `halonic-record-tree`: a folder in My Drive holding one subfolder, and a
 *   file in each.
 * - `halonic-record-many`: a folder in My Drive holding at least 30 files.
 * - `halonic-record-shared-top`: a folder at the top of a shared drive.
 *   Shared drives need a Google Workspace account.
 *
 * Use made-up files only. File names are scrubbed, but the ids and types
 * stay in the recording.
 */

const folderType = "application/vnd.google-apps.folder";

/** What the tree calls read from Drive. Never the owners or a request body. */
const treeOnly = ["response.body.name", "response.body.owners[*].*", "request.body.name"];

/** The one folder with this name, as `drive_search` returns it. */
async function findFolder(
  connection: IntegrationConnection,
  name: string,
): Promise<{ id: string; parents: string[] }> {
  const text = await connection.callTool("drive_search", {
    query: `name = '${name}' and mimeType = '${folderType}'`,
    pageSize: 2,
  });
  const { files } = JSON.parse(text) as { files: { id: string; parents: string[] }[] };
  const [folder] = files;
  if (folder === undefined || files.length > 1) {
    throw new Error(`The test account needs exactly one folder named ${name}.`);
  }
  return folder;
}

export const integration = drive;
export const scenarios: readonly Scenario[] = [
  {
    // What a real two-level listing looks like, to check the hand-written ones against.
    name: "tree-live-two-levels",
    unusedUserContent: treeOnly,
    async run(connection) {
      const folder = await findFolder(connection, "halonic-record-tree");
      await connection.callTool("drive_tree", { folderId: folder.id, depth: 2 });
    },
  },
  {
    // Question 1: whether Drive sends a page shorter than `pageSize` with a
    // `nextPageToken`. The tool then says `truncated` and lists no deeper.
    name: "tree-live-partial-page",
    unusedUserContent: treeOnly,
    async run(connection) {
      const folder = await findFolder(connection, "halonic-record-many");
      await connection.callTool("drive_tree", { folderId: folder.id, depth: 1, maxItems: 10 });
    },
  },
  {
    // Question 3: whether listing a shared drive by its id works without
    // `corpora=drive` and `driveId`. A top-level folder's parent is the
    // shared drive. Google's answer is recorded either way, so a refusal is
    // kept as well: that refusal is the answer.
    name: "tree-live-shared-drive",
    unusedUserContent: [...treeOnly, "response.body.files[*].owners[*].*"],
    async run(connection) {
      const top = await findFolder(connection, "halonic-record-shared-top");
      const [sharedDriveId] = top.parents;
      if (sharedDriveId === undefined) {
        throw new Error("halonic-record-shared-top has no parent; is it in a shared drive?");
      }
      try {
        await connection.callTool("drive_tree", { folderId: sharedDriveId, depth: 1 });
      } catch {
        // Kept in the recording; see above.
      }
    },
  },
];
