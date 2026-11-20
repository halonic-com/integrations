import { describe, expect, it } from "vitest";
import {
  callTool,
  connectToFakePaperclip,
  connectToRecording,
  paperclipError,
} from "../test/replay.ts";

const firstComment = "c0000000-0000-4000-8000-000000000001";

describe("issues_list_comments", () => {
  it("returns each comment's id, author, time and text, oldest first, without deleted ones", async () => {
    const { connection, replay } = connectToRecording("list-comments");
    const result = await callTool(connection, "issues_list_comments", { issue: "HAL-12" });
    replay.assertAllUsed();
    expect(result).toEqual({
      comments: [
        {
          id: firstComment,
          author: { type: "agent", agentId: "a9e00000-0000-4000-8000-00000000000a" },
          createdAt: "2026-11-11T08:00:00.000Z",
          text: "<scrubbed:content>",
        },
        {
          id: "c0000000-0000-4000-8000-000000000002",
          author: { type: "user", userId: "user_fake_01" },
          createdAt: "2026-11-12T08:00:00.000Z",
          text: "<scrubbed:content>",
        },
        {
          id: "c0000000-0000-4000-8000-000000000004",
          author: { type: "system" },
          createdAt: "2026-11-14T08:00:00.000Z",
          text: "<scrubbed:content>",
        },
      ],
    });
  });

  it("hands back nextAfter and leaves out the comment Paperclip's after sends again", async () => {
    const { connection, replay } = connectToRecording("list-comments-two-pages");
    const first = await callTool(connection, "issues_list_comments", {
      issue: "HAL-12",
      maxResults: 1,
    });
    expect(first).toMatchObject({ comments: [{ id: firstComment }], nextAfter: firstComment });
    const second = await callTool(connection, "issues_list_comments", {
      issue: "HAL-12",
      maxResults: 1,
      after: firstComment,
    });
    expect(second).toEqual({
      comments: [expect.objectContaining({ id: "c0000000-0000-4000-8000-000000000002" })],
    });
    replay.assertAllUsed();
  });

  it("pages the same when after isn't sent back", async () => {
    const comment = (id: string) => ({
      id,
      authorType: "agent",
      authorAgentId: "a1",
      authorUserId: null,
      body: "text",
      createdAt: "2026-11-11T08:00:00.000Z",
    });
    const page = [comment("c2"), comment("c3"), comment("c4")];
    const { connection } = connectToFakePaperclip(200, JSON.stringify(page));
    const result = await callTool(connection, "issues_list_comments", {
      issue: "HAL-12",
      after: "c1",
      maxResults: 2,
    });
    expect(result).toMatchObject({ comments: [{ id: "c2" }, { id: "c3" }], nextAfter: "c3" });
  });

  it("cuts a long comment after 10,000 characters", async () => {
    const comment = {
      id: "c1",
      authorType: "agent",
      authorAgentId: "a1",
      authorUserId: null,
      body: "x".repeat(10_001),
      createdAt: "2026-11-11T08:00:00.000Z",
    };
    const { connection } = connectToFakePaperclip(200, JSON.stringify([comment]));
    const result = (await callTool(connection, "issues_list_comments", { issue: "HAL-1" })) as {
      comments: { text: string }[];
    };
    expect(result.comments[0]?.text).toHaveLength(10_000);
  });

  it("maps a task that doesn't exist to not-found, naming the task but not Paperclip's text", async () => {
    const { connection, replay } = connectToRecording("list-comments-not-found");
    const call = connection.callTool("issues_list_comments", { issue: "HAL-99" });
    await expect(call).rejects.toMatchObject({
      code: "not-found",
      kind: "not_found",
      message:
        "Paperclip found nothing at tasks.example.com/api/issues/HAL-99/comments (status 404).",
    });
    replay.assertAllUsed();
  });

  it.each([
    ["issue", { issue: "../companies" }],
    ["issue", { issue: "HAL-1/comments" }],
    ["after", { issue: "HAL-1", after: "a b" }],
    ["maxResults", { issue: "HAL-1", maxResults: 101 }],
  ])("refuses a bad %s before any request", async (field, args) => {
    const { connection, requests } = connectToFakePaperclip(500, paperclipError());
    const call = connection.callTool("issues_list_comments", args);
    await expect(call).rejects.toMatchObject({
      code: "bad-arguments",
      message: `Check these arguments: ${field}.`,
    });
    expect(requests).toHaveLength(0);
  });
});
