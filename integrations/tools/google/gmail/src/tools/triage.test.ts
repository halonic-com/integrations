import { describe, expect, it } from "vitest";
import { gmail } from "../index.ts";
import { hostFor } from "../test/host.ts";
import { callTool, connectToRecording } from "../test/replay.ts";
import { bodyCharsPerMessage } from "./triage.ts";

/**
 * Any search: the recordings hold `q` as the placeholder (`request.query.q`
 * in the sheet), and the replay scrubs the sent URL the same way.
 */
const query = "invoice newer_than:7d";

describe("gmail_triage", () => {
  it("searches unread inbox mail by default", async () => {
    const http = {
      fetch: async (url: string) => {
        expect(url).toBe(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is%3Aunread+in%3Ainbox&maxResults=10",
        );
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" };
      },
    };
    const result = await gmail.connect(hostFor({ http })).callTool("gmail_triage", {});
    expect(JSON.parse(result)).toMatchObject({ query: "is:unread in:inbox", messages: [] });
  });

  it("searches and reads each match in one call", async () => {
    const { connection, replay } = connectToRecording("triage-two-messages");
    const result = await callTool(connection, "gmail_triage", { query });
    replay.assertAllUsed();
    expect(result).toMatchObject({
      query,
      resultSizeEstimate: 2,
      bodyCharsPerMessage: 2_000,
      messages: [
        { id: "19a0c0ffee000001", attachments: [{ partId: "1" }], inlineImagesHidden: 1 },
        { id: "19a0c0ffee000002", attachments: [] },
      ],
    });
    expect(result).not.toHaveProperty("nextPageToken");
    // The Message-ID header is for replies; triage leaves it out.
    expect(JSON.stringify(result)).not.toContain("messageIdHeader");
  });
});

describe("bodyCharsPerMessage", () => {
  it("gives each message what was asked, lowered so all bodies stay under 40,000", () => {
    expect(bodyCharsPerMessage(2_000, 10)).toBe(2_000);
    expect(bodyCharsPerMessage(5_000, 25)).toBe(1_600);
    expect(bodyCharsPerMessage(5_000, 0)).toBe(5_000);
  });

  it("never goes below 300 characters a message", () => {
    expect(bodyCharsPerMessage(300, 200)).toBe(300);
  });
});
