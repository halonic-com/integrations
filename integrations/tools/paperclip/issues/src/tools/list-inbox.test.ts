import { describe, expect, it } from "vitest";
import {
  callTool,
  connectToFakePaperclip,
  connectToRecording,
  paperclipError,
} from "../test/replay.ts";

const task = (n: number) => `7a5c0000-0000-4000-8000-0000000000${n}`;

function fakeInboxTask(n: number) {
  return {
    id: `t${n}`,
    identifier: `HAL-${n}`,
    title: "title",
    status: "todo",
    priority: "low",
    updatedAt: "2026-11-11T08:00:00.000Z",
    dependencyReady: true,
  };
}

describe("issues_list_inbox", () => {
  it("returns each task's id, identifier, title, status, priority, blockers done and last change", async () => {
    const { connection, replay } = connectToRecording("list-inbox");
    const result = await callTool(connection, "issues_list_inbox", {});
    replay.assertAllUsed();
    expect(result).toEqual({
      tasks: [
        {
          id: task(12),
          identifier: "HAL-12",
          title: "<scrubbed:content>",
          status: "blocked",
          priority: "medium",
          blockersDone: false,
          updatedAt: "2026-11-12T08:00:00.000Z",
        },
        {
          id: task(15),
          identifier: "HAL-15",
          title: "<scrubbed:content>",
          status: "in_progress",
          priority: "medium",
          blockersDone: true,
          updatedAt: "2026-11-15T08:00:00.000Z",
        },
      ],
    });
  });

  it("returns at most 50 tasks and says how many more there are", async () => {
    const inbox = Array.from({ length: 53 }, (_, index) => fakeInboxTask(index + 1));
    const { connection } = connectToFakePaperclip(200, JSON.stringify(inbox));
    const result = (await callTool(connection, "issues_list_inbox", {})) as {
      tasks: unknown[];
      notShown: number;
    };
    expect(result.tasks).toHaveLength(50);
    expect(result.notShown).toBe(3);
  });

  it("maps a key that isn't an agent's to not-allowed, without Paperclip's text", async () => {
    const { connection } = connectToFakePaperclip(403, paperclipError());
    await expect(connection.callTool("issues_list_inbox", {})).rejects.toMatchObject({
      code: "not-allowed",
      message:
        "The Paperclip key may not read tasks.example.com/api/agents/me/inbox-lite (status 403).",
    });
  });

  it("refuses any argument before a request", async () => {
    const { connection, requests } = connectToFakePaperclip(200, "[]");
    await expect(
      connection.callTool("issues_list_inbox", { agentId: "someone-else" }),
    ).rejects.toMatchObject({ code: "bad-arguments" });
    expect(requests).toHaveLength(0);
  });
});
