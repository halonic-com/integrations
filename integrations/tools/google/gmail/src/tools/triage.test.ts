import { describe, expect, it } from "vitest";
import { callTool, connectToRecording } from "../test/replay.ts";
import { bodyCharsPerMessage } from "./triage.ts";

describe("gmail_triage", () => {
  it("searches unread inbox mail and reads each match in one call", async () => {
    const { connection, replay } = connectToRecording("triage-two-messages");
    const result = await callTool(connection, "gmail_triage", {});
    replay.assertAllUsed();
    expect(result).toMatchObject({
      query: "is:unread in:inbox",
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
