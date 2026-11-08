import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { describe, expect, it } from "vitest";
import searchFolderNextPage from "../../recordings/search-folder-next-page.json" with {
  type: "json",
};
import searchNoMatch from "../../recordings/search-no-match.json" with { type: "json" };
import searchSignedOut from "../../recordings/search-signed-out.json" with { type: "json" };
import searchTextTwoFiles from "../../recordings/search-text-two-files.json" with { type: "json" };
import { callTool, connectToFakeDrive, connectToRecording } from "../test/replay.ts";
import { searchQuery } from "./search.ts";

describe("drive_search", () => {
  it("searches names and contents, sorted by relevance, and passes the page token on", async () => {
    const { connection, replay } = connectToRecording(searchTextTwoFiles);
    const result = await callTool(connection, "drive_search", {
      text: "halonic-test",
      pageSize: 2,
    });
    replay.assertAllUsed();
    expect(result).toEqual({
      files: [
        {
          id: "file-plan-01",
          name: "<scrubbed:content>",
          type: "application/vnd.google-apps.document",
          modified: "2026-11-02T09:30:00.000Z",
          owners: ["<scrubbed:content>"],
          parents: ["folder-projects-01"],
          link: "https://docs.google.com/document/d/file-plan-01/edit",
        },
        {
          id: "file-notes-02",
          name: "<scrubbed:content>",
          type: "text/plain",
          size: 2048,
          modified: "2026-10-28T16:05:00.000Z",
          owners: ["<scrubbed:content>"],
          parents: ["folder-projects-01"],
          link: "https://drive.google.com/file/d/file-notes-02/view",
        },
      ],
      nextPageToken: "scrubbed-secret-1",
    });
  });

  it("lists a folder, newest first, from the token of the previous page", async () => {
    const { connection, replay } = connectToRecording(searchFolderNextPage);
    const result = await callTool(connection, "drive_search", {
      folderId: "folder-projects-01",
      pageSize: 2,
      pageToken: "scrubbed-secret-1",
    });
    replay.assertAllUsed();
    expect(result).toMatchObject({ files: [{ id: "file-budget-03" }] });
    expect(result).not.toHaveProperty("nextPageToken");
  });

  it("returns an empty list, not an error, when nothing matches", async () => {
    const { connection, replay } = connectToRecording(searchNoMatch);
    const result = await callTool(connection, "drive_search", {
      query: "name = 'halonic-test nothing'",
    });
    replay.assertAllUsed();
    expect(result).toEqual({ files: [] });
  });

  it("turns a refused sign-in into not-signed-in without Google's own text", async () => {
    const { connection } = connectToRecording(searchSignedOut);
    const call = connection.callTool("drive_search", { text: "halonic-test" });
    await expect(call).rejects.toBeInstanceOf(GoogleError);
    await expect(call).rejects.toMatchObject({ code: "not-signed-in" });
    await expect(call).rejects.not.toThrow(/Invalid Credentials|halonic-test/);
  });

  it("lists the newest 25 files outside the trash when no arguments are given", async () => {
    const { connection, urls } = connectToFakeDrive(200, "{}");
    expect(await callTool(connection, "drive_search", {})).toEqual({ files: [] });
    const query = new URL(urls[0] ?? "").searchParams;
    expect(query.get("q")).toBe("trashed = false");
    expect(query.get("pageSize")).toBe("25");
    expect(query.get("orderBy")).toBe("modifiedTime desc");
  });

  it("refuses more than 100 results, an empty text and a folder id with a quote, before any request", async () => {
    const { connection, urls } = connectToFakeDrive(200, "{}");
    const call = connection.callTool("drive_search", {
      pageSize: 101,
      text: "",
      folderId: "folder' or 'a' = 'a",
    });
    await expect(call).rejects.toMatchObject({
      code: "bad-arguments",
      message: "Check these arguments: text, folderId, pageSize.",
    });
    expect(urls).toHaveLength(0);
  });
});

describe("searchQuery", () => {
  it("puts the model's own query in brackets, so its or can't skip the trash clause", () => {
    expect(searchQuery({ query: "name = 'a' or name = 'b'" })).toBe(
      "trashed = false and (name = 'a' or name = 'b')",
    );
  });

  it("combines text, folder and query", () => {
    expect(
      searchQuery({ text: "plan", folderId: "folder-1", query: "mimeType = 'text/plain'" }),
    ).toBe(
      "trashed = false and (name contains 'plan' or fullText contains 'plan') and 'folder-1' in parents and (mimeType = 'text/plain')",
    );
  });
});
