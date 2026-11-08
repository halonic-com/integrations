import { describe, expect, it } from "vitest";
import updateFile from "../../recordings/update-file.json" with { type: "json" };
import { callTool, connectToFakeDrive, connectToRecording } from "../test/replay.ts";

const notesArguments = {
  fileId: "file-notes-02",
  content: "Notes for the next meeting:\nBring the plan.",
};

describe("drive_update_file", () => {
  it("replaces the content and returns id, name, type and link", async () => {
    const { connection, replay } = connectToRecording(updateFile);
    const result = await callTool(connection, "drive_update_file", notesArguments);
    replay.assertAllUsed();
    expect(result).toEqual({
      file: {
        id: "file-notes-02",
        name: "<scrubbed:content>",
        type: "text/plain",
        link: "https://drive.google.com/file/d/file-notes-02/view",
      },
    });
  });

  it("sends empty metadata, so the name and folder stay, and the text as text/plain", async () => {
    const { connection, replay } = connectToRecording(updateFile);
    await callTool(connection, "drive_update_file", notesArguments);
    const [upload] = replay.sent;
    expect(upload?.init.method).toBe("PATCH");
    expect(upload?.body).toContain("charset=UTF-8\r\n\r\n{}\r\n");
    expect(upload?.body).toContain("Content-Type: text/plain\r\n\r\nNotes for the next meeting:");
  });

  it.each([
    [429, "rate-limited"],
    [500, "unavailable"],
  ])("never tries again after status %i", async (status, code) => {
    const { connection, urls } = connectToFakeDrive(status, "{}");
    const call = connection.callTool("drive_update_file", notesArguments);
    await expect(call).rejects.toMatchObject({ code });
    expect(urls).toHaveLength(1);
  });

  it("refuses a file id that could change the path before any request", async () => {
    const { connection, urls } = connectToFakeDrive(200, "{}");
    const call = connection.callTool("drive_update_file", { ...notesArguments, fileId: ".." });
    await expect(call).rejects.toMatchObject({ code: "bad-arguments" });
    expect(urls).toEqual([]);
  });
});
