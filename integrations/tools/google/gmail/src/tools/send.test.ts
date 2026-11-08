import { describe, expect, it } from "vitest";
import { gmail } from "../index.ts";
import { callTool, connectToRecording } from "../test/replay.ts";

describe("risk of the tools that send", () => {
  it("marks both send tools send, so Halonic can ask or refuse", () => {
    const risk = new Map(gmail.tools.map((tool) => [tool.name, tool.risk]));
    expect(risk.get("gmail_send")).toBe("send");
    expect(risk.get("gmail_send_draft")).toBe("send");
  });
});

describe("gmail_send", () => {
  it("reads the signature, then sends once and returns only ids", async () => {
    const { connection, replay } = connectToRecording("send");
    const result = await callTool(connection, "gmail_send", {
      to: ["Robin Sample <robin@example.com>"],
      subject: "halonic-test agenda",
      body: "Agenda for Thursday is below.",
    });
    replay.assertAllUsed();
    expect(result).toEqual({
      sent: true,
      messageId: "19a0c0ffee000302",
      threadId: "19a0c0ffee000302",
    });
  });

  it("turns a refused mail into bad-arguments without any part of the mail or Google's text", async () => {
    const { connection } = connectToRecording("send-refused");
    const call = connection.callTool("gmail_send", {
      to: ["robin@example"],
      subject: "halonic-test agenda",
      body: "Agenda for Thursday is below.",
    });
    await expect(call).rejects.toMatchObject({ code: "bad-arguments" });
    await expect(call).rejects.not.toThrow(/robin|agenda|Agenda|Invalid/);
  });

  it("never sends again after Gmail fails: one request, then unavailable", async () => {
    const { connection, replay } = connectToRecording("send-unavailable");
    await expect(
      connection.callTool("gmail_send", {
        to: ["Robin Sample <robin@example.com>"],
        subject: "halonic-test agenda",
        body: "Agenda for Thursday is below.",
        signature: false,
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    replay.assertAllUsed();
    expect(replay.sent).toHaveLength(1);
  });
});

describe("gmail_send_draft", () => {
  it("sends the draft by id in one request", async () => {
    const { connection, replay } = connectToRecording("send-draft");
    const result = await callTool(connection, "gmail_send_draft", {
      draftId: "r-5550001234567890123",
    });
    replay.assertAllUsed();
    expect(replay.sent[0]?.body).toEqual({ id: "r-5550001234567890123" });
    expect(result).toEqual({
      sent: true,
      messageId: "19a0c0ffee000303",
      threadId: "19a0c0ffee000201",
    });
  });
});
