import { fakeResponse, testHost } from "@halonicjs/tooling-record/replay";
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
    const http = fakeResponse(200, JSON.stringify({ labels }));
    const result = JSON.parse(
      await gmail.connect(testHost(http)).callTool("gmail_list_labels", {}),
    );
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

  it.each(["TRASH", "SPAM", "trash"])(
    "refuses to add %s before any request: no deleting, no spam reports",
    async (labelId) => {
      const { connection, replay } = connectToRecording("modify-labels");
      await expect(
        connection.callTool("gmail_modify_labels", {
          messageIds: ["19a0c0ffee000001"],
          addLabelIds: ["STARRED", labelId],
        }),
      ).rejects.toMatchObject({ code: "bad-arguments" });
      expect(replay.sent).toHaveLength(0);
    },
  );

  it("still removes TRASH and SPAM, which takes mail back out", async () => {
    // Only the request's body matters here, so Gmail's empty 204 is faked
    // instead of recording modify-labels again with other labels.
    const sentBodies: string[] = [];
    const connection = gmail.connect(
      testHost({
        async fetch(_url, init) {
          sentBodies.push(typeof init?.body === "string" ? init.body : "");
          return new Response(null, { status: 204 });
        },
      }),
    );
    await expect(
      connection.callTool("gmail_modify_labels", {
        messageIds: ["19a0c0ffee000001"],
        removeLabelIds: ["TRASH", "SPAM"],
      }),
    ).resolves.toBeDefined();
    expect(sentBodies.map((body) => JSON.parse(body))).toEqual([
      expect.objectContaining({ removeLabelIds: ["TRASH", "SPAM"] }),
    ]);
  });

  it("refuses an empty list of messages before any request", async () => {
    const { connection, replay } = connectToRecording("modify-labels");
    await expect(
      connection.callTool("gmail_modify_labels", { messageIds: [] }),
    ).rejects.toMatchObject({ code: "bad-arguments" });
    expect(replay.sent).toHaveLength(0);
  });
});
