import { describe, expect, it } from "vitest";
import { gmail } from "../index.ts";
import { callTool, connectToRecording } from "../test/replay.ts";

describe("gmail_create_draft", () => {
  it("reads the original and the signature, then saves one draft in the original's thread", async () => {
    const { connection, replay } = connectToRecording("create-draft-reply");
    const result = await callTool(connection, "gmail_create_draft", {
      to: ["Billing Team <billing@example.com>"],
      body: "Paid today, thank you.",
      replyToMessageId: "19a0c0ffee000001",
    });
    replay.assertAllUsed();
    expect(result).toEqual({
      draftId: "r-5550001234567890125",
      messageId: "19a0c0ffee000301",
      threadId: "19a0c0ffee000001",
    });
    expect(replay.sent[2]?.body).toMatchObject({ message: { threadId: "19a0c0ffee000001" } });
  });

  it("is a write: the draft stays in the account until someone sends it", () => {
    const tool = gmail.tools.find((candidate) => candidate.name === "gmail_create_draft");
    expect(tool).toMatchObject({ risk: "write", untrusted: false });
  });
});
