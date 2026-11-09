import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { describe, expect, it } from "vitest";
import { gmail } from "../index.ts";
import { callTool, connectToRecording } from "../test/replay.ts";

/**
 * Any search: the recordings hold `q` as the placeholder (`request.query.q`
 * in the sheet), and the replay scrubs the sent URL the same way.
 */
const query = "invoice newer_than:7d";

describe("gmail_search", () => {
  it("lists one page, reads each message's summary and passes the page token on", async () => {
    const { connection, replay } = connectToRecording("search-two-messages");
    const result = await callTool(connection, "gmail_search", {
      query,
      maxResults: 2,
    });
    replay.assertAllUsed();
    expect(result).toEqual({
      resultSizeEstimate: 3,
      messages: [
        {
          id: "19a0c0ffee000001",
          threadId: "19a0c0ffee000001",
          from: "<scrubbed:content>",
          to: "<scrubbed:content>",
          subject: "<scrubbed:content>",
          date: "<scrubbed:content>",
          labels: ["INBOX", "UNREAD"],
          snippet: "<scrubbed:content>",
        },
        {
          id: "19a0c0ffee000002",
          threadId: "19a0c0ffee000002",
          from: "<scrubbed:content>",
          to: "<scrubbed:content>",
          cc: "<scrubbed:content>",
          subject: "<scrubbed:content>",
          date: "<scrubbed:content>",
          labels: ["INBOX"],
          snippet: "<scrubbed:content>",
        },
      ],
      nextPageToken: "scrubbed-secret-1",
    });
  });

  it("asks for the next page with the token from the previous one", async () => {
    const { connection, replay } = connectToRecording("search-next-page");
    const result = await callTool(connection, "gmail_search", {
      query,
      maxResults: 2,
      pageToken: "scrubbed-secret-1",
    });
    replay.assertAllUsed();
    expect(result).toMatchObject({ resultSizeEstimate: 1, messages: [{ id: "19a0c0ffee000003" }] });
    expect(result).not.toHaveProperty("nextPageToken");
  });

  it("returns an empty list, not an error, when nothing matches", async () => {
    const { connection, replay } = connectToRecording("search-no-match");
    const result = await callTool(connection, "gmail_search", {
      query,
    });
    replay.assertAllUsed();
    expect(result).toEqual({ resultSizeEstimate: 0, messages: [] });
  });

  it("searches the inbox, 15 messages at a time, when no arguments are given", async () => {
    const http = {
      fetch: async (url: string) => {
        expect(url).toBe(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in%3Ainbox&maxResults=15",
        );
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => "{}",
        };
      },
    };
    const result = await gmail.connect({ http, wait: async () => {} }).callTool("gmail_search", {});
    expect(JSON.parse(result)).toEqual({ messages: [] });
  });

  it("turns a refused sign-in into not-signed-in without Google's own text", async () => {
    const { connection } = connectToRecording("search-signed-out");
    const call = connection.callTool("gmail_search", { query });
    await expect(call).rejects.toBeInstanceOf(GoogleError);
    await expect(call).rejects.toMatchObject({ code: "not-signed-in" });
    // The recording holds Google's text as the placeholder, so it must not show up.
    await expect(call).rejects.not.toThrow(/scrubbed/);
  });

  it("refuses more than 25 results and a huge page token before any request", async () => {
    const { connection, replay } = connectToRecording("search-no-match");
    const call = connection.callTool("gmail_search", {
      maxResults: 26,
      pageToken: "x".repeat(501),
    });
    await expect(call).rejects.toMatchObject({
      code: "bad-arguments",
      message: "Check these arguments: maxResults, pageToken.",
    });
    expect(replay.sent).toHaveLength(0);
  });
});
