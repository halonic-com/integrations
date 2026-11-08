import { describe, expect, it } from "vitest";
import { z } from "zod";
import { googleBaseUrls, googleUrl, withNextPageToken } from "./urls.ts";

describe("googleUrl", () => {
  it("joins the path to the base", () => {
    expect(googleUrl(googleBaseUrls.gmail, ["users", "me", "messages"])).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    );
  });

  it("encodes each path part, so an id can't change the path", () => {
    const url = googleUrl(googleBaseUrls.drive, ["files", "../../admin?x=1#y"]);
    expect(url).toBe("https://www.googleapis.com/drive/v3/files/..%2F..%2Fadmin%3Fx%3D1%23y");
  });

  it("encodes query values, repeats lists and leaves out undefined", () => {
    const url = googleUrl(googleBaseUrls.gmail, ["users", "me", "messages"], {
      q: "from:billing@example.com subject:a&b=c",
      maxResults: 10,
      includeSpamTrash: false,
      metadataHeaders: ["From", "Subject"],
      pageToken: undefined,
    });
    expect(new URL(url).search).toBe(
      "?q=from%3Abilling%40example.com+subject%3Aa%26b%3Dc&maxResults=10&includeSpamTrash=false&metadataHeaders=From&metadataHeaders=Subject",
    );
  });

  it("sets the page token when there is one", () => {
    const url = googleUrl(googleBaseUrls.drive, ["files"], { pageToken: "page-2" });
    expect(new URL(url).searchParams.get("pageToken")).toBe("page-2");
  });
});

describe("withNextPageToken", () => {
  const listSchema = withNextPageToken(z.object({ files: z.array(z.object({ id: z.string() })) }));

  it("reads nextPageToken when there are more pages", () => {
    expect(listSchema.parse({ files: [{ id: "f1" }], nextPageToken: "page-2" })).toEqual({
      files: [{ id: "f1" }],
      nextPageToken: "page-2",
    });
  });

  it("accepts the last page without one", () => {
    expect(listSchema.parse({ files: [] })).toEqual({ files: [] });
  });
});
