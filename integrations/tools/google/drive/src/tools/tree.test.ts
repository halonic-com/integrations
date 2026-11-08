import { describe, expect, it } from "vitest";
import treeFoldersOnly from "../../recordings/tree-folders-only.json" with { type: "json" };
import treeStopsAtMaxItems from "../../recordings/tree-stops-at-max-items.json" with {
  type: "json",
};
import treeTwoLevels from "../../recordings/tree-two-levels.json" with { type: "json" };
import { callTool, connectToFakeDrive, connectToRecording } from "../test/replay.ts";

describe("drive_tree", () => {
  it("lists a folder, then its subfolders, with paths from the top", async () => {
    const { connection, replay } = connectToRecording(treeTwoLevels);
    const result = await callTool(connection, "drive_tree", {
      folderId: "folder-projects-01",
      depth: 2,
    });
    replay.assertAllUsed();
    expect(result).toEqual({
      folderId: "folder-projects-01",
      depth: 2,
      count: 3,
      entries: [
        {
          path: "/<scrubbed:content>/",
          id: "folder-designs-06",
          type: "folder",
          modified: "2026-11-01T10:00:00.000Z",
        },
        {
          path: "/<scrubbed:content>",
          id: "file-plan-01",
          type: "application/vnd.google-apps.document",
          modified: "2026-11-02T09:30:00.000Z",
        },
        {
          path: "/<scrubbed:content>/<scrubbed:content>",
          id: "file-sketch-07",
          type: "image/svg+xml",
          size: 5120,
          modified: "2026-10-30T14:20:00.000Z",
        },
      ],
    });
  });

  it("stops at maxItems, says truncated and lists no deeper", async () => {
    const { connection, replay } = connectToRecording(treeStopsAtMaxItems);
    const result = await callTool(connection, "drive_tree", {
      folderId: "folder-projects-01",
      maxItems: 2,
    });
    replay.assertAllUsed();
    expect(result).toMatchObject({ count: 2, truncated: true });
    // Drive's page token isn't passed on: the model lists a subfolder on its own instead.
    expect(JSON.stringify(result)).not.toContain("scrubbed-secret");
  });

  it("lists no deeper once a level fills maxItems, and says truncated", async () => {
    // The top folder holds one folder and one file: exactly maxItems.
    const files = [
      { id: "folder-designs-06", name: "Designs", mimeType: "application/vnd.google-apps.folder" },
      { id: "file-plan-01", name: "Plan", mimeType: "application/vnd.google-apps.document" },
    ];
    const { connection, urls } = connectToFakeDrive(200, JSON.stringify({ files }));
    const result = await callTool(connection, "drive_tree", {
      folderId: "root",
      depth: 2,
      maxItems: 2,
    });
    // The subfolder isn't listed: that would ask Drive for a page of 0 items.
    expect(urls).toHaveLength(1);
    expect(result).toMatchObject({ count: 2, truncated: true });
  });

  it("asks only for folders with foldersOnly", async () => {
    const { connection, replay } = connectToRecording(treeFoldersOnly);
    const result = await callTool(connection, "drive_tree", {
      folderId: "root",
      depth: 1,
      foldersOnly: true,
    });
    replay.assertAllUsed();
    expect(result).toMatchObject({ count: 1, entries: [{ id: "folder-designs-06" }] });
    expect(result).not.toHaveProperty("truncated");
  });

  it("makes at most 25 listings and then says truncated", async () => {
    // Every listing answers with the same 30 subfolders.
    const folders = Array.from({ length: 30 }, (_, index) => ({
      id: `folder-${index}`,
      name: `Folder ${index}`,
      mimeType: "application/vnd.google-apps.folder",
    }));
    const { connection, urls } = connectToFakeDrive(200, JSON.stringify({ files: folders }));
    const result = await callTool(connection, "drive_tree", {
      folderId: "root",
      depth: 3,
      maxItems: 1_000,
    });
    // One listing of the top folder, then 24 of its 30 subfolders.
    expect(urls).toHaveLength(25);
    expect(result).toMatchObject({ count: 30 + 24 * 30, truncated: true });
  });

  it("refuses a depth over 5 and more than 1,000 items, before any request", async () => {
    const { connection, urls } = connectToFakeDrive(200, "{}");
    const call = connection.callTool("drive_tree", {
      folderId: "root",
      depth: 6,
      maxItems: 1_001,
    });
    await expect(call).rejects.toMatchObject({
      code: "bad-arguments",
      message: "Check these arguments: depth, maxItems.",
    });
    expect(urls).toHaveLength(0);
  });
});
