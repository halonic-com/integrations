import { describe, expect, it } from "vitest";
import {
  callTool,
  connectToFakePaperclip,
  connectToRecording,
  paperclipError,
} from "../test/replay.ts";

const agent = "a9e00000-0000-4000-8000-00000000000a";
const task = (n: number) => `7a5c0000-0000-4000-8000-0000000000${n}`;

/** The smallest task Paperclip could send, for paths a recording can't show. */
function fakeTask(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "t1",
    identifier: "HAL-1",
    title: "title",
    description: "description",
    status: "todo",
    priority: "low",
    assigneeAgentId: null,
    assigneeUserId: null,
    updatedAt: "2026-11-11T08:00:00.000Z",
    parentId: null,
    ancestors: [],
    blockedBy: [],
    blocks: [],
    documentSummaries: [],
    ...fields,
  });
}

describe("issues_get", () => {
  it("returns the task, its parent, its blockers and its document keys, and nothing else", async () => {
    const { connection, replay } = connectToRecording("get-issue");
    const result = await callTool(connection, "issues_get", { issue: "HAL-12" });
    replay.assertAllUsed();
    expect(result).toEqual({
      id: task(12),
      identifier: "HAL-12",
      title: "<scrubbed:content>",
      description: "<scrubbed:content>",
      status: "blocked",
      priority: "high",
      assignee: { agentId: agent },
      updatedAt: "2026-11-18T10:00:00.000Z",
      parent: { id: task(10), identifier: "HAL-10" },
      blockedBy: [
        { id: task(11), identifier: "HAL-11", title: "<scrubbed:content>", status: "in_review" },
      ],
      blocks: [{ id: task(13), identifier: "HAL-13", title: "<scrubbed:content>", status: "todo" }],
      // The recorder treats a field named `key` as a secret (README, "Recordings").
      documentKeys: ["scrubbed-secret-1", "scrubbed-secret-2"],
    });
  });

  it("leaves out the parent when there is none, and names only its id when Paperclip sends no ancestor", async () => {
    const orphan = connectToFakePaperclip(200, fakeTask());
    expect(await callTool(orphan.connection, "issues_get", { issue: "HAL-1" })).not.toHaveProperty(
      "parent",
    );
    const child = connectToFakePaperclip(200, fakeTask({ parentId: "t0" }));
    expect(await callTool(child.connection, "issues_get", { issue: "HAL-1" })).toMatchObject({
      parent: { id: "t0" },
    });
  });

  it("cuts a long description after 20,000 characters, and reads a missing one as empty", async () => {
    const long = connectToFakePaperclip(200, fakeTask({ description: "x".repeat(20_001) }));
    const result = (await callTool(long.connection, "issues_get", { issue: "HAL-1" })) as {
      description: string;
    };
    expect(result.description).toHaveLength(20_000);
    const none = connectToFakePaperclip(200, fakeTask({ description: null }));
    expect(await callTool(none.connection, "issues_get", { issue: "HAL-1" })).toMatchObject({
      description: "",
    });
  });

  it("asks for the task by the identifier it was given", async () => {
    const { connection, requests } = connectToFakePaperclip(200, fakeTask());
    await connection.callTool("issues_get", { issue: "HAL-1" });
    expect(requests.map((request) => request.url)).toEqual([
      "https://tasks.example.com/api/issues/HAL-1",
    ]);
  });

  it("maps a task that doesn't exist to not-found, without Paperclip's text", async () => {
    const { connection } = connectToFakePaperclip(404, paperclipError());
    await expect(connection.callTool("issues_get", { issue: "HAL-99" })).rejects.toMatchObject({
      code: "not-found",
      message: "Paperclip found nothing at tasks.example.com/api/issues/HAL-99 (status 404).",
    });
  });

  it.each([
    ["a path", { issue: "../agents/me" }],
    ["no issue", {}],
  ])("refuses %s as the issue before any request", async (_, args) => {
    const { connection, requests } = connectToFakePaperclip(200, fakeTask());
    await expect(connection.callTool("issues_get", args)).rejects.toMatchObject({
      code: "bad-arguments",
      message: "Check these arguments: issue.",
    });
    expect(requests).toHaveLength(0);
  });
});
