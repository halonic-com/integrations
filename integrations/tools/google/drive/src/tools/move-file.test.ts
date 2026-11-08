import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { describe, expect, it } from "vitest";
import moveFile from "../../recordings/move-file.json" with { type: "json" };
import moveFileNotAllowed from "../../recordings/move-file-not-allowed.json" with { type: "json" };
import {
  callTool,
  connectToFakeAnswers,
  connectToFakeDrive,
  connectToRecording,
} from "../test/replay.ts";

describe("drive_move_file", () => {
  it("takes the file out of its folder, puts it into the new one and renames it", async () => {
    const { connection, replay } = connectToRecording(moveFile);
    const result = await callTool(connection, "drive_move_file", {
      fileId: "file-notes-02",
      toFolderId: "folder-archive-08",
      newName: "Old team notes",
    });
    replay.assertAllUsed();
    const move = new URL(replay.sent[1]?.url ?? "");
    expect(replay.sent[1]?.init.method).toBe("PATCH");
    expect(move.searchParams.get("addParents")).toBe("folder-archive-08");
    expect(move.searchParams.get("removeParents")).toBe("folder-projects-01");
    expect(replay.sent[1]?.body).toEqual({ name: "Old team notes" });
    expect(result).toEqual({
      file: {
        id: "file-notes-02",
        name: "<scrubbed:content>",
        parents: ["folder-archive-08"],
        link: "https://drive.google.com/file/d/file-notes-02/view",
      },
    });
  });

  it("keeps the name when no newName is given, and maps a refusal to not-allowed", async () => {
    const { connection, replay } = connectToRecording(moveFileNotAllowed);
    const call = connection.callTool("drive_move_file", {
      fileId: "file-notes-02",
      toFolderId: "folder-shared-09",
    });
    await expect(call).rejects.toBeInstanceOf(GoogleError);
    await expect(call).rejects.toMatchObject({ code: "not-allowed" });
    await expect(call).rejects.not.toThrow(/sufficient permissions/);
    expect(replay.sent[1]?.body).toEqual({});
  });

  it("leaves removeParents out for a file that is in none of the account's folders", async () => {
    const { connection, urls } = connectToFakeDrive(200, '{"id":"file-shared-10"}');
    await callTool(connection, "drive_move_file", {
      fileId: "file-shared-10",
      toFolderId: "folder-archive-08",
    });
    expect(urls).toHaveLength(2);
    expect(new URL(urls[1] ?? "").searchParams.has("removeParents")).toBe(false);
  });

  it("never tries the move again after a 503", async () => {
    const { connection, requests } = connectToFakeAnswers(
      { status: 200, body: '{"id":"file-notes-02","parents":["folder-projects-01"]}' },
      { status: 503, body: "{}" },
    );
    const call = connection.callTool("drive_move_file", {
      fileId: "file-notes-02",
      toFolderId: "folder-archive-08",
    });
    await expect(call).rejects.toMatchObject({ code: "unavailable" });
    expect(requests).toHaveLength(2);
  });

  it.each([
    ["a file id", { fileId: "..", toFolderId: "folder-archive-08" }],
    ["a folder id", { fileId: "file-notes-02", toFolderId: "folder/../x" }],
  ])("refuses %s that could change the path before any request", async (_case, args) => {
    const { connection, urls } = connectToFakeDrive(200, "{}");
    await expect(connection.callTool("drive_move_file", args)).rejects.toMatchObject({
      code: "bad-arguments",
    });
    expect(urls).toEqual([]);
  });
});
