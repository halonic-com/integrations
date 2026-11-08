import { describe, expect, it } from "vitest";
import readBinaryFile from "../../recordings/read-binary-file.json" with { type: "json" };
import readDocMarkdown from "../../recordings/read-doc-markdown.json" with { type: "json" };
import readDocPlainText from "../../recordings/read-doc-plain-text.json" with { type: "json" };
import readDocTooLarge from "../../recordings/read-doc-too-large.json" with { type: "json" };
import readTextFileInParts from "../../recordings/read-text-file-in-parts.json" with {
  type: "json",
};
import { callTool, connectToFakeDrive, connectToRecording } from "../test/replay.ts";

describe("drive_read_file", () => {
  it("reads the details, then exports a Google Doc as Markdown", async () => {
    const { connection, replay } = connectToRecording(readDocMarkdown);
    const result = await callTool(connection, "drive_read_file", { fileId: "file-plan-01" });
    replay.assertAllUsed();
    expect(result).toMatchObject({
      file: { id: "file-plan-01", type: "application/vnd.google-apps.document" },
      format: "text/markdown",
      content:
        "# halonic-test plan\n\nA made-up plan for the recording.\n\n- First step\n- Second step\n",
    });
    expect(result).not.toHaveProperty("nextOffset");
  });

  it("exports as plain text when Drive refuses the Markdown export", async () => {
    const { connection, replay } = connectToRecording(readDocPlainText);
    const result = await callTool(connection, "drive_read_file", { fileId: "file-plan-01" });
    replay.assertAllUsed();
    expect(result).toMatchObject({
      format: "text/plain",
      content: "halonic-test plan\r\n\r\nA made-up plan for the recording.\r\n",
    });
  });

  it("stops at an export error that isn't a refused format, such as a file too large", async () => {
    const { connection, replay } = connectToRecording(readDocTooLarge);
    const call = connection.callTool("drive_read_file", { fileId: "file-plan-01" });
    await expect(call).rejects.toMatchObject({ code: "not-allowed" });
    // No plain-text export after it: that would fail the same way.
    replay.assertAllUsed();
  });

  it("downloads a text file and returns the first part with nextOffset", async () => {
    const { connection, replay } = connectToRecording(readTextFileInParts);
    const result = await callTool(connection, "drive_read_file", {
      fileId: "file-notes-02",
      maxChars: 40,
    });
    replay.assertAllUsed();
    expect(result).toMatchObject({
      file: { id: "file-notes-02", size: 2048 },
      format: "text/plain",
      content: "Made-up notes for the recording, long en",
      nextOffset: 40,
    });
  });

  it("returns only the details of a binary file, without downloading it", async () => {
    const { connection, replay } = connectToRecording(readBinaryFile);
    const result = await callTool(connection, "drive_read_file", { fileId: "file-scan-05" });
    replay.assertAllUsed();
    expect(result).toEqual({
      file: {
        id: "file-scan-05",
        name: "<scrubbed:content>",
        type: "application/pdf",
        size: 48213,
        modified: "2026-10-15T08:45:00.000Z",
        owners: ["<scrubbed:content>"],
        parents: ["folder-projects-01"],
        link: "https://drive.google.com/file/d/file-scan-05/view",
        trashed: false,
      },
    });
  });

  it("refuses more than 100,000 characters and a negative offset, before any request", async () => {
    const { connection, urls } = connectToFakeDrive(200, "{}");
    const call = connection.callTool("drive_read_file", {
      fileId: "file-notes-02",
      maxChars: 100_001,
      offset: -1,
    });
    await expect(call).rejects.toMatchObject({
      code: "bad-arguments",
      message: "Check these arguments: maxChars, offset.",
    });
    expect(urls).toHaveLength(0);
  });
});
