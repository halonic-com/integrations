import { describe, expect, it } from "vitest";
import createFolder from "../../recordings/create-folder.json" with { type: "json" };
import {
  callTool,
  connectToFakeAnswers,
  connectToFakeDrive,
  connectToRecording,
} from "../test/replay.ts";

describe("drive_create_folder", () => {
  it("creates the folder inside parentId and returns id, name and link", async () => {
    const { connection, replay } = connectToRecording(createFolder);
    const result = await callTool(connection, "drive_create_folder", {
      name: "Drafts",
      parentId: "folder-projects-01",
    });
    replay.assertAllUsed();
    expect(replay.sent[0]?.body).toEqual({
      name: "Drafts",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["folder-projects-01"],
    });
    expect(result).toEqual({
      folder: {
        id: "folder-drafts-07",
        name: "<scrubbed:content>",
        link: "https://drive.google.com/drive/folders/folder-drafts-07",
      },
    });
  });

  it("leaves parents out without parentId, so Drive uses the top of My Drive", async () => {
    const { connection, requests } = connectToFakeAnswers({
      status: 200,
      body: '{"id":"folder-new"}',
    });
    await callTool(connection, "drive_create_folder", { name: "Drafts" });
    expect(requests.map((request) => JSON.parse(request.body ?? ""))).toEqual([
      { name: "Drafts", mimeType: "application/vnd.google-apps.folder" },
    ]);
  });

  it.each([
    [429, "rate-limited"],
    [503, "unavailable"],
  ])(
    "never tries again after status %i, because the folder may exist already",
    async (status, code) => {
      const { connection, urls, waits } = connectToFakeDrive(status, "{}");
      const call = connection.callTool("drive_create_folder", { name: "Drafts" });
      await expect(call).rejects.toMatchObject({ code });
      expect(urls).toHaveLength(1);
      expect(waits).toEqual([]);
    },
  );

  it("refuses a parent id that could change the path before any request", async () => {
    const { connection, urls } = connectToFakeDrive(200, "{}");
    const call = connection.callTool("drive_create_folder", { name: "Drafts", parentId: "a/b" });
    await expect(call).rejects.toMatchObject({ code: "bad-arguments" });
    expect(urls).toEqual([]);
  });
});
