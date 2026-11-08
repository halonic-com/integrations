import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { gmail } from "../index.ts";
import { callTool, connectToRecording } from "../test/replay.ts";

/** A draft as Gmail returns it, with the headers given. */
function connectToDraft(headers: Record<string, string>, body: string) {
  const draft = {
    id: "r-1",
    message: {
      id: "m1",
      threadId: "t1",
      payload: {
        mimeType: "text/plain",
        headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
        body: { data: Buffer.from(body, "utf8").toString("base64url") },
      },
    },
  };
  const http = {
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(draft),
    }),
  };
  return gmail.connect({ http });
}

describe("google.get-draft-returns-bcc", () => {
  it("returns the draft's Bcc recipients next to to and cc", async () => {
    const connection = connectToDraft(
      { To: "robin@example.com", Bcc: "kim@example.com", Subject: "Minutes" },
      "Below.",
    );
    const result = await callTool(connection, "gmail_get_draft", { draftId: "r-1" });
    expect(result).toEqual({
      draftId: "r-1",
      to: "robin@example.com",
      bcc: "kim@example.com",
      subject: "Minutes",
      body: "Below.",
      bodyChars: 6,
      attachments: [],
    });
  });

  it("leaves bcc out for a draft without a Bcc header, as it does cc", async () => {
    const connection = connectToDraft({ To: "robin@example.com" }, "Thanks.");
    const result = await callTool(connection, "gmail_get_draft", { draftId: "r-1" });
    expect(result).not.toHaveProperty("bcc");
    expect(result).not.toHaveProperty("cc");
  });

  it("shows bcc for a recorded draft that has one, and none for one that hasn't", async () => {
    const withBcc = connectToRecording("get-draft-with-bcc");
    const shown = await callTool(withBcc.connection, "gmail_get_draft", {
      draftId: "r-5550001234567890123",
    });
    withBcc.replay.assertAllUsed();
    expect(shown).toMatchObject({
      draftId: "r-5550001234567890123",
      to: "<scrubbed:content>",
      cc: "<scrubbed:content>",
      bcc: "<scrubbed:content>",
      attachments: ["<scrubbed:content>"],
    });

    const withoutBcc = connectToRecording("get-draft-without-bcc");
    const plain = await callTool(withoutBcc.connection, "gmail_get_draft", {
      draftId: "r-5550001234567890124",
    });
    expect(plain).not.toHaveProperty("bcc");
  });
});

describe("gmail_get_draft", () => {
  it("returns a long body in pages", async () => {
    const connection = connectToDraft({ To: "robin@example.com" }, "x".repeat(700));
    const first = await callTool(connection, "gmail_get_draft", {
      draftId: "r-1",
      maxBodyChars: 500,
    });
    expect(first).toMatchObject({ bodyChars: 700, nextBodyOffset: 500 });
  });
});
