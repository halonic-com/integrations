import { describe, expect, it } from "vitest";
import {
  callTool,
  connectToFakePaperclip,
  connectToRecording,
  paperclipError,
} from "../test/replay.ts";

function fakeDocument(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    key: "plan",
    title: "Plan",
    body: "text",
    updatedAt: "2026-11-11T08:00:00.000Z",
    ...fields,
  });
}

describe("issues_get_document", () => {
  it("returns the document's key, title, text and last change", async () => {
    const { connection, replay } = connectToRecording("get-document");
    const result = await callTool(connection, "issues_get_document", {
      issue: "HAL-12",
      key: "notes",
    });
    replay.assertAllUsed();
    expect(result).toEqual({
      // The recorder treats a field named `key` as a secret (README, "Recordings").
      key: "scrubbed-secret-1",
      title: "<scrubbed:content>",
      text: "<scrubbed:content>",
      updatedAt: "2026-11-12T08:00:00.000Z",
    });
  });

  it("maps a document that doesn't exist yet to not-found, without Paperclip's text", async () => {
    const { connection, replay } = connectToRecording("get-document-not-found");
    const call = connection.callTool("issues_get_document", { issue: "HAL-12", key: "report" });
    await expect(call).rejects.toMatchObject({
      code: "not-found",
      message:
        "Paperclip found nothing at tasks.example.com/api/issues/HAL-12/documents/report (status 404).",
    });
    replay.assertAllUsed();
  });

  it("cuts a long text after 50,000 characters, and leaves out a missing title", async () => {
    const { connection } = connectToFakePaperclip(
      200,
      fakeDocument({ title: null, body: "x".repeat(50_001) }),
    );
    const result = (await callTool(connection, "issues_get_document", {
      issue: "HAL-1",
      key: "plan",
    })) as { text: string };
    expect(result.text).toHaveLength(50_000);
    expect(result).not.toHaveProperty("title");
  });

  it.each([
    ["key", { issue: "HAL-1", key: "../../comments" }],
    ["key", { issue: "HAL-1", key: "a.b" }],
    ["key", { issue: "HAL-1" }],
    ["issue", { issue: "HAL 1", key: "plan" }],
  ])("refuses a bad %s before any request", async (field, args) => {
    const { connection, requests } = connectToFakePaperclip(500, paperclipError());
    await expect(connection.callTool("issues_get_document", args)).rejects.toMatchObject({
      code: "bad-arguments",
      message: `Check these arguments: ${field}.`,
    });
    expect(requests).toHaveLength(0);
  });
});
