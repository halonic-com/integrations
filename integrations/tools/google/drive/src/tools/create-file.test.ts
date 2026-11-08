import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { describe, expect, it } from "vitest";
import createFile from "../../recordings/create-file.json" with { type: "json" };
import createFileFolderNotFound from "../../recordings/create-file-folder-not-found.json" with {
  type: "json",
};
import { callTool, connectToFakeDrive, connectToRecording } from "../test/replay.ts";

const planArguments = {
  name: "Launch plan",
  content: "# Launch plan\n\n- Pick a date\n- Book the room",
  mimeType: "text/markdown",
  folderId: "folder-projects-01",
  convertTo: "document",
};

describe("drive_create_file", () => {
  it("uploads the text as a Google Doc into the folder and returns id, name, type and link", async () => {
    const { connection, replay } = connectToRecording(createFile);
    const result = await callTool(connection, "drive_create_file", planArguments);
    replay.assertAllUsed();
    expect(result).toEqual({
      file: {
        id: "file-plan-05",
        name: "<scrubbed:content>",
        type: "application/vnd.google-apps.document",
        link: "https://docs.google.com/document/d/file-plan-05/edit",
      },
    });
  });

  it("sends the metadata and the text in one multipart upload", async () => {
    const { connection, replay } = connectToRecording(createFile);
    await callTool(connection, "drive_create_file", planArguments);
    const [upload] = replay.sent;
    expect(upload?.init.method).toBe("POST");
    expect(upload?.init.headers?.["content-type"]).toBe(
      "multipart/related; boundary=halonic-upload-boundary",
    );
    expect(upload?.body).toContain(
      '{"name":"Launch plan","parents":["folder-projects-01"],"mimeType":"application/vnd.google-apps.document"}',
    );
    expect(upload?.body).toContain("Content-Type: text/markdown\r\n\r\n# Launch plan");
  });

  it("turns a missing folder into not-found without Google's own text", async () => {
    const { connection } = connectToRecording(createFileFolderNotFound);
    const call = connection.callTool("drive_create_file", {
      name: "Room list",
      content: "Room A\nRoom B",
      folderId: "folder-missing-06",
    });
    await expect(call).rejects.toBeInstanceOf(GoogleError);
    await expect(call).rejects.toMatchObject({ code: "not-found" });
    await expect(call).rejects.not.toThrow(/File not found/);
  });

  it.each([
    [429, "rate-limited"],
    [500, "unavailable"],
    [503, "unavailable"],
  ])(
    "never tries again after status %i, because the file may exist already",
    async (status, code) => {
      const { connection, urls, waits } = connectToFakeDrive(status, "{}");
      const call = connection.callTool("drive_create_file", planArguments);
      await expect(call).rejects.toMatchObject({ code });
      expect(urls).toHaveLength(1);
      expect(waits).toEqual([]);
    },
  );

  it("calls a body that isn't JSON an unexpected response", async () => {
    const { connection } = connectToFakeDrive(200, "<html>Sign in</html>");
    const call = connection.callTool("drive_create_file", planArguments);
    await expect(call).rejects.toMatchObject({ code: "unexpected-response" });
  });

  it.each([
    ["a mimeType with a line break", { mimeType: "text/plain\r\nX-Injected: yes" }],
    ["a folder id that could change the path", { folderId: "../files" }],
    ["an unknown convertTo", { convertTo: "presentation" }],
    ["an empty name", { name: "" }],
  ])("refuses %s before any request", async (_case, change) => {
    const { connection, urls } = connectToFakeDrive(200, "{}");
    const call = connection.callTool("drive_create_file", { ...planArguments, ...change });
    await expect(call).rejects.toMatchObject({ code: "bad-arguments" });
    expect(urls).toEqual([]);
  });
});
