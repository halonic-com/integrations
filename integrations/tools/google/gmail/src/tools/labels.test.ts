import { describe, expect, it } from "vitest";
import { gmail } from "../index.ts";
import { callTool, connectToRecording } from "../test/replay.ts";
import { maxLabels } from "./list-labels.ts";

describe("gmail_list_labels", () => {
  it("returns each label's id, name and type, and nothing else", async () => {
    // Every label name is scrubbed in the recording, the system ones too.
    const { connection, replay } = connectToRecording("list-labels");
    const result = await callTool(connection, "gmail_list_labels", {});
    replay.assertAllUsed();
    expect(result).toEqual({
      labels: [
        { id: "INBOX", name: "<scrubbed:content>", type: "system" },
        { id: "UNREAD", name: "<scrubbed:content>", type: "system" },
        { id: "STARRED", name: "<scrubbed:content>", type: "system" },
        { id: "Label_7", name: "<scrubbed:content>", type: "user" },
      ],
    });
  });

  it("stops at 500 labels and says how many it left out", async () => {
    const labels = Array.from({ length: maxLabels + 3 }, (_, n) => ({
      id: `Label_${n}`,
      name: `n${n}`,
    }));
    const http = {
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ labels }),
      }),
    };
    const result = JSON.parse(await gmail.connect({ http }).callTool("gmail_list_labels", {}));
    expect(result.labels).toHaveLength(maxLabels);
    expect(result.omittedLabels).toBe(3);
  });
});

describe("gmail_modify_labels", () => {
  it("changes the labels of every message in one request and returns only a count", async () => {
    const { connection, replay } = connectToRecording("modify-labels");
    const result = await callTool(connection, "gmail_modify_labels", {
      messageIds: ["19a0c0ffee000001", "19a0c0ffee000002"],
      addLabelIds: ["Label_7"],
      removeLabelIds: ["UNREAD", "INBOX"],
    });
    replay.assertAllUsed();
    expect(result).toEqual({ modified: 2 });
    expect(replay.sent[0]?.body).toEqual({
      ids: ["19a0c0ffee000001", "19a0c0ffee000002"],
      addLabelIds: ["Label_7"],
      removeLabelIds: ["UNREAD", "INBOX"],
    });
  });

  it("is a write: it changes only what the account itself sees", () => {
    const tool = gmail.tools.find((candidate) => candidate.name === "gmail_modify_labels");
    expect(tool).toMatchObject({ risk: "write", untrusted: false });
  });

  it("refuses an empty list of messages before any request", async () => {
    const { connection, replay } = connectToRecording("modify-labels");
    await expect(
      connection.callTool("gmail_modify_labels", { messageIds: [] }),
    ).rejects.toMatchObject({ code: "bad-arguments" });
    expect(replay.sent).toHaveLength(0);
  });
});
