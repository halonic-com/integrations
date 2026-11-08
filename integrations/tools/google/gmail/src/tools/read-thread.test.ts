import { describe, expect, it } from "vitest";
import { callTool, connectToRecording } from "../test/replay.ts";

describe("gmail_read_thread", () => {
  it("returns the first messages, oldest first, and where the next page starts", async () => {
    const { connection, replay } = connectToRecording("read-thread-two-pages");
    const result = await callTool(connection, "gmail_read_thread", {
      threadId: "19a0c0ffee000101",
      maxMessages: 2,
    });
    replay.assertAllUsed();
    expect(result).toMatchObject({
      threadId: "19a0c0ffee000101",
      messages: [{ id: "19a0c0ffee000101" }, { id: "19a0c0ffee000102" }],
      nextMessageOffset: 2,
    });
  });

  it("returns the rest from messageOffset, without another offset when it is the end", async () => {
    const { connection } = connectToRecording("read-thread-two-pages");
    const result = await callTool(connection, "gmail_read_thread", {
      threadId: "19a0c0ffee000101",
      maxMessages: 2,
      messageOffset: 2,
    });
    expect(result).toMatchObject({ messages: [{ id: "19a0c0ffee000103" }] });
    expect(result).not.toHaveProperty("nextMessageOffset");
  });
});
