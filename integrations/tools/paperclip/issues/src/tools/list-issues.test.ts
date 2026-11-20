import { describe, expect, it } from "vitest";
import {
  callTool,
  connectToFakePaperclip,
  connectToRecording,
  paperclipError,
} from "../test/replay.ts";

describe("issues_list", () => {
  it("returns each task's id, identifier, title, status, priority, assignee and last change", async () => {
    const { connection, replay } = connectToRecording("list-issues-next-page");
    const result = await callTool(connection, "issues_list", {
      status: "todo,in_progress,blocked",
      maxResults: 2,
    });
    replay.assertAllUsed();
    expect(result).toEqual({
      tasks: [
        {
          id: "7a5c0000-0000-4000-8000-000000000014",
          identifier: "HAL-14",
          title: "<scrubbed:content>",
          status: "in_progress",
          priority: "high",
          assignee: { agentId: "a9e00000-0000-4000-8000-00000000000a" },
          updatedAt: "2026-11-18T10:00:00.000Z",
        },
        {
          id: "7a5c0000-0000-4000-8000-000000000013",
          identifier: "HAL-13",
          title: "<scrubbed:content>",
          status: "blocked",
          priority: "medium",
          assignee: { userId: "user_fake_01" },
          updatedAt: "2026-11-18T10:00:00.000Z",
        },
      ],
      nextOffset: 2,
    });
  });

  it("asks for one task more than it returns, to know there are more", async () => {
    const { connection, replay } = connectToRecording("list-issues-next-page");
    await callTool(connection, "issues_list", {
      status: "todo,in_progress,blocked",
      maxResults: 2,
    });
    const [sent] = replay.sent;
    expect(new URL(sent?.url ?? "").searchParams.get("limit")).toBe("3");
  });

  it("returns no description and none of Paperclip's other fields", async () => {
    const { connection } = connectToRecording("list-issues-next-page");
    const result = await callTool(connection, "issues_list", {
      status: "todo,in_progress,blocked",
      maxResults: 2,
    });
    const text = JSON.stringify(result);
    for (const field of ["description", "monitorNotes", "labels", "activeRun", "companyId"]) {
      expect(text).not.toContain(field);
    }
  });

  it("searches with Paperclip's q and filters by agent, and says when nothing matched", async () => {
    const { connection, replay } = connectToRecording("list-issues-search-no-match");
    const result = await callTool(connection, "issues_list", {
      text: "invented words",
      assigneeAgentId: "a9e00000-0000-4000-8000-00000000000b",
    });
    replay.assertAllUsed();
    expect(result).toEqual({ tasks: [] });
  });

  it("follows nextOffset from the previous page", async () => {
    const { connection, requests } = connectToFakePaperclip(200, "[]");
    await callTool(connection, "issues_list", { maxResults: 10, offset: 20 });
    const url = new URL(requests[0]?.url ?? "");
    expect(url.searchParams.get("offset")).toBe("20");
    expect(url.searchParams.get("limit")).toBe("11");
  });

  it("cuts a long title", async () => {
    const task = {
      id: "t1",
      identifier: "HAL-1",
      title: "x".repeat(600),
      status: "todo",
      priority: "low",
      assigneeAgentId: null,
      assigneeUserId: null,
      updatedAt: "2026-11-18T10:00:00.000Z",
    };
    const { connection } = connectToFakePaperclip(200, JSON.stringify([task]));
    const result = (await callTool(connection, "issues_list", {})) as {
      tasks: { title: string; assignee?: unknown }[];
    };
    expect(result.tasks[0]?.title).toHaveLength(500);
    expect(result.tasks[0]?.title.endsWith("…")).toBe(true);
    expect(result.tasks[0]).not.toHaveProperty("assignee");
  });

  it("maps a refused key to not-signed-in without Paperclip's text", async () => {
    const { connection, replay } = connectToRecording("list-issues-signed-out");
    const call = connection.callTool("issues_list", {});
    await expect(call).rejects.toMatchObject({ code: "not-signed-in", kind: "unauthenticated" });
    await expect(call).rejects.not.toThrow(/Unauthorized/);
    replay.assertAllUsed();
  });

  it.each([
    ["status", { status: "todo; DROP" }],
    ["assigneeAgentId", { assigneeAgentId: "../agents" }],
    ["text", { text: "" }],
    ["maxResults", { maxResults: 51 }],
    ["offset", { offset: -1 }],
  ])("refuses a bad %s before any request", async (field, args) => {
    const { connection, requests } = connectToFakePaperclip(500, paperclipError());
    const call = connection.callTool("issues_list", args);
    await expect(call).rejects.toMatchObject({
      code: "bad-arguments",
      message: `Check these arguments: ${field}.`,
    });
    expect(requests).toHaveLength(0);
  });
});
