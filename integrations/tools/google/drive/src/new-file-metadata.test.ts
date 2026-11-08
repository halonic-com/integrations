import { describe, expect, it } from "vitest";
import { convertToSchema, newFileMetadata } from "./new-file-metadata.ts";

describe("newFileMetadata", () => {
  it("keeps the content's type when nothing is converted", () => {
    expect(newFileMetadata({ name: "notes.md", contentType: "text/markdown" })).toEqual({
      name: "notes.md",
      mimeType: "text/markdown",
    });
  });

  it("asks for a Google Doc for convertTo document", () => {
    const metadata = newFileMetadata({
      name: "Plan",
      contentType: "text/markdown",
      convertTo: "document",
    });

    expect(metadata.mimeType).toBe("application/vnd.google-apps.document");
  });

  it("asks for a Google Sheet for convertTo spreadsheet", () => {
    const metadata = newFileMetadata({
      name: "Budget",
      contentType: "text/csv",
      convertTo: "spreadsheet",
    });

    expect(metadata.mimeType).toBe("application/vnd.google-apps.spreadsheet");
  });

  it("puts the file in folderId, with the fields in the old connector's order", () => {
    const metadata = newFileMetadata({
      name: "a.txt",
      contentType: "text/plain",
      folderId: "folder-1",
    });

    expect(JSON.stringify(metadata)).toBe(
      '{"name":"a.txt","parents":["folder-1"],"mimeType":"text/plain"}',
    );
  });

  it("leaves parents out without a folder, so Drive uses the top of My Drive", () => {
    const metadata = newFileMetadata({
      name: "a.txt",
      contentType: "text/plain",
      folderId: undefined,
    });

    expect(metadata).not.toHaveProperty("parents");
  });
});

describe("convertToSchema", () => {
  it("accepts document, spreadsheet or nothing", () => {
    expect(convertToSchema.parse("document")).toBe("document");
    expect(convertToSchema.parse("spreadsheet")).toBe("spreadsheet");
    expect(convertToSchema.parse(undefined)).toBeUndefined();
  });

  it("refuses other Google types", () => {
    expect(convertToSchema.safeParse("presentation").success).toBe(false);
  });
});
