import type { IntegrationConnection } from "@halonicjs/adapters/integration-kit";
import { describe, expect, it } from "vitest";
import treeLivePartialPage from "../../recordings/tree-live-partial-page.json" with {
  type: "json",
};
import treeLiveSharedDrive from "../../recordings/tree-live-shared-drive.json" with {
  type: "json",
};
import treeLiveTwoLevels from "../../recordings/tree-live-two-levels.json" with { type: "json" };
import { callTool, connectToRecording } from "../test/replay.ts";

/**
 * The live `drive_tree` recordings from `recordings/scenarios.ts`, which
 * answer the three questions from the integrations#75 review with what
 * Google really sent. Each one first finds its test folder by name, the way
 * the scenario does.
 */

async function findFolder(
  connection: IntegrationConnection,
  name: string,
): Promise<{ id: string; parents: string[] }> {
  const result = (await callTool(connection, "drive_search", {
    query: `name = '${name}' and mimeType = 'application/vnd.google-apps.folder'`,
    pageSize: 2,
  })) as { files: { id: string; parents: string[] }[] };
  const [folder] = result.files;
  if (folder === undefined) throw new Error(`The recording has no folder named ${name}.`);
  return folder;
}

describe("drive_tree on live recordings", () => {
  it("lists two real levels, asking the second level only for the items left", async () => {
    const { connection, replay } = connectToRecording(treeLiveTwoLevels);
    const folder = await findFolder(connection, "halonic-record-tree");
    const result = await callTool(connection, "drive_tree", { folderId: folder.id, depth: 2 });
    replay.assertAllUsed();
    expect(result).toMatchObject({ count: 3 });
    expect(result).not.toHaveProperty("truncated");
    expect(new URL(replay.sent[2]?.url ?? "").searchParams.get("pageSize")).toBe("298");
  });

  // Question 1. Drive filled the page and added a token, so the tool says
  // truncated and lists no deeper. Drive sent no page shorter than pageSize.
  it("says truncated when Drive has more than maxItems in one folder", async () => {
    const { connection, replay } = connectToRecording(treeLivePartialPage);
    const folder = await findFolder(connection, "halonic-record-many");
    const result = await callTool(connection, "drive_tree", {
      folderId: folder.id,
      depth: 1,
      maxItems: 10,
    });
    replay.assertAllUsed();
    expect(result).toMatchObject({ count: 10, truncated: true });
  });

  // Question 3. A shared drive's id lists its top level with `in parents`
  // and supportsAllDrives alone: no `corpora` or `driveId` needed.
  it("lists a shared drive by its id", async () => {
    const { connection, replay } = connectToRecording(treeLiveSharedDrive);
    const top = await findFolder(connection, "halonic-record-shared-top");
    const [sharedDriveId] = top.parents;
    const result = await callTool(connection, "drive_tree", { folderId: sharedDriveId, depth: 1 });
    replay.assertAllUsed();
    expect(result).toMatchObject({ count: 1, entries: [{ id: top.id, type: "folder" }] });
    const listing = new URL(replay.sent[1]?.url ?? "").searchParams;
    expect(listing.has("corpora")).toBe(false);
    expect(listing.has("driveId")).toBe(false);
  });
});
