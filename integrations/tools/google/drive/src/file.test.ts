import { describe, expect, it } from "vitest";
import { driveFileSchema, fileDetails } from "./file.ts";

describe("fileDetails", () => {
  it("renames Drive's fields, turns the size into a number and lists owner addresses", () => {
    const file = driveFileSchema.parse({
      id: "file-notes-02",
      name: "Notes.txt",
      mimeType: "text/plain",
      size: "2048",
      modifiedTime: "2026-10-28T16:05:00.000Z",
      owners: [{ emailAddress: "owner@example.com" }],
      parents: ["folder-projects-01"],
      webViewLink: "https://drive.google.com/file/d/file-notes-02/view",
      trashed: false,
    });
    expect(fileDetails(file)).toEqual({
      id: "file-notes-02",
      name: "Notes.txt",
      type: "text/plain",
      size: 2048,
      modified: "2026-10-28T16:05:00.000Z",
      owners: ["owner@example.com"],
      parents: ["folder-projects-01"],
      link: "https://drive.google.com/file/d/file-notes-02/view",
      trashed: false,
    });
  });

  it("leaves out what Drive didn't send, such as a folder's size", () => {
    const details = fileDetails(driveFileSchema.parse({ id: "folder-projects-01" }));
    expect(JSON.parse(JSON.stringify(details))).toEqual({
      id: "folder-projects-01",
      owners: [],
      parents: [],
    });
  });

  it("skips an owner without an address and a size that isn't a whole number", () => {
    const details = fileDetails(
      driveFileSchema.parse({ id: "file-a", size: "12.5", owners: [{}] }),
    );
    expect(details.owners).toEqual([]);
    expect(details).not.toHaveProperty("size", expect.anything());
  });

  it("refuses a file without an id", () => {
    expect(driveFileSchema.safeParse({ name: "Notes.txt" }).success).toBe(false);
  });
});
