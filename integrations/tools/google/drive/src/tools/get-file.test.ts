import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { describe, expect, it } from "vitest";
import getFile from "../../recordings/get-file.json" with { type: "json" };
import getFileNotFound from "../../recordings/get-file-not-found.json" with { type: "json" };
import { callTool, connectToFakeDrive, connectToRecording } from "../test/replay.ts";

/** A Google error body with a reason and a sentence that repeats the request. */
function googleError(status: number, reason: string): string {
  return JSON.stringify({
    error: {
      code: status,
      errors: [{ domain: "global", reason, message: "File not found: Secret plan.txt" }],
      message: "File not found: Secret plan.txt",
    },
  });
}

describe("drive_get_file", () => {
  it("returns the file's details, including whether it is in the trash", async () => {
    const { connection, replay } = connectToRecording(getFile);
    const result = await callTool(connection, "drive_get_file", { fileId: "file-notes-02" });
    replay.assertAllUsed();
    expect(result).toEqual({
      file: {
        id: "file-notes-02",
        name: "<scrubbed:content>",
        type: "text/plain",
        size: 2048,
        modified: "2026-10-28T16:05:00.000Z",
        owners: ["<scrubbed:content>"],
        parents: ["folder-projects-01"],
        link: "https://drive.google.com/file/d/file-notes-02/view",
        trashed: false,
      },
    });
  });

  it("turns a missing file into not-found without Google's own text", async () => {
    const { connection, replay } = connectToRecording(getFileNotFound);
    const call = connection.callTool("drive_get_file", { fileId: "file-missing-04" });
    await expect(call).rejects.toBeInstanceOf(GoogleError);
    await expect(call).rejects.toMatchObject({ code: "not-found" });
    await expect(call).rejects.not.toThrow(/File not found/);
    replay.assertAllUsed();
  });

  it.each([
    [400, "badRequest", "bad-arguments"],
    [401, "authError", "not-signed-in"],
    [403, "insufficientFilePermissions", "not-allowed"],
    [403, "userRateLimitExceeded", "rate-limited"],
    [403, "dailyLimitExceeded", "quota-exceeded"],
    [404, "notFound", "not-found"],
  ])(
    "maps status %i with reason %s to %s at once, without Google's text",
    async (status, reason, code) => {
      const { connection, urls } = connectToFakeDrive(status, googleError(status, reason));
      const call = connection.callTool("drive_get_file", { fileId: "file-notes-02" });
      await expect(call).rejects.toMatchObject({ code });
      await expect(call).rejects.not.toThrow(/Secret plan/);
      expect(urls).toHaveLength(1);
    },
  );

  it("reads again twice after status 500, then maps backendError to unavailable", async () => {
    const { connection, urls, waits } = connectToFakeDrive(500, googleError(500, "backendError"));
    const call = connection.callTool("drive_get_file", { fileId: "file-notes-02" });
    await expect(call).rejects.toMatchObject({ code: "unavailable" });
    expect(urls).toHaveLength(3);
    expect(waits).toEqual([1_000, 2_000]);
  });

  it("leaves a 429 to the kit's own retries, and maps rateLimitExceeded to rate-limited", async () => {
    const { connection, urls, waits } = connectToFakeDrive(
      429,
      googleError(429, "rateLimitExceeded"),
    );
    const call = connection.callTool("drive_get_file", { fileId: "file-notes-02" });
    await expect(call).rejects.toMatchObject({ code: "rate-limited" });
    expect(urls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it("calls a body that isn't JSON an unexpected response", async () => {
    const { connection } = connectToFakeDrive(200, "<html>Sign in</html>");
    const call = connection.callTool("drive_get_file", { fileId: "file-notes-02" });
    await expect(call).rejects.toMatchObject({ code: "unexpected-response" });
  });

  it("calls a file without an id an unexpected response", async () => {
    const { connection } = connectToFakeDrive(200, JSON.stringify({ name: "Notes.txt" }));
    const call = connection.callTool("drive_get_file", { fileId: "file-notes-02" });
    await expect(call).rejects.toMatchObject({ code: "unexpected-response" });
  });

  it("refuses an id that could change the path, before any request", async () => {
    const { connection, urls } = connectToFakeDrive(200, "{}");
    const call = connection.callTool("drive_get_file", { fileId: "../about" });
    await expect(call).rejects.toMatchObject({
      code: "bad-arguments",
      message: "Check these arguments: fileId.",
    });
    expect(urls).toHaveLength(0);
  });
});
