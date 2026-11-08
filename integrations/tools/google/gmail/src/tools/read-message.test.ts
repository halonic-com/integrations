import { describe, expect, it } from "vitest";
import { callTool, connectToRecording } from "../test/replay.ts";

describe("gmail_read_message", () => {
  it("reads the whole message in one request and lists its attachments", async () => {
    const { connection, replay } = connectToRecording("read-message");
    const result = await callTool(connection, "gmail_read_message", {
      messageId: "19a0c0ffee000001",
    });
    replay.assertAllUsed();
    expect(result).toMatchObject({
      id: "19a0c0ffee000001",
      threadId: "19a0c0ffee000001",
      labels: ["INBOX", "UNREAD"],
      attachments: [{ partId: "1", mimeType: "application/pdf", size: 48_213 }],
      // The logo is inline: a small image with a Content-ID, hidden unless asked for.
      inlineImagesHidden: 1,
    });
    // Gmail's attachmentId is long and changes on every read: partId is what the result gives.
    expect(JSON.stringify(result)).not.toContain("attachmentId");
  });

  it("names the id it couldn't find, never Google's own text", async () => {
    const { connection } = connectToRecording("read-message-not-found");
    const call = connection.callTool("gmail_read_message", { messageId: "19a0c0ffee0000ff" });
    await expect(call).rejects.toMatchObject({
      code: "not-found",
      message:
        "Gmail found nothing at gmail.googleapis.com/gmail/v1/users/me/messages/19a0c0ffee0000ff (status 404, notFound).",
    });
  });

  it("refuses an id that would change the path, before any request", async () => {
    const { connection, replay } = connectToRecording("read-message");
    await expect(
      connection.callTool("gmail_read_message", { messageId: ".." }),
    ).rejects.toMatchObject({
      code: "bad-arguments",
    });
    expect(replay.sent).toHaveLength(0);
  });
});
