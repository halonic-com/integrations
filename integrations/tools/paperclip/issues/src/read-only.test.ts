import { readSheetData } from "@halonicjs/tooling-record/sheet-data";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { paperclipIssues } from "./index.ts";
import { asksForPaperclipKey, connectToFakePaperclip } from "./test/replay.ts";

/**
 * What the permission sheet promises the user, pinned so a later change
 * can't loosen it quietly: every tool only reads, and the one key goes
 * only to the Paperclip server the workspace chose. The code keeps the
 * same promise: it has no tool that writes, and it sends only `GET`.
 */
const sheetSchema = z.object({
  hosts: z.array(z.unknown()),
  secrets: z.record(z.string(), z.unknown()),
  tools: z.array(z.object({ name: z.string(), risk: z.string(), untrusted: z.boolean() })),
  needs: z.array(z.unknown()),
});
const sheet = sheetSchema.parse(readSheetData(new URL("../integration.yaml", import.meta.url)));

describe("integration.yaml", () => {
  it("declares only tools that read", () => {
    expect(sheet.tools.length).toBeGreaterThan(0);
    for (const tool of sheet.tools) {
      expect(tool.risk, tool.name).toBe("read");
    }
  });

  it("marks every tool's result untrusted", () => {
    for (const tool of sheet.tools) {
      expect(tool.untrusted, tool.name).toBe(true);
    }
  });

  it("reaches only the Paperclip server in the url setting, on a private network", () => {
    expect(sheet.hosts).toEqual([{ fromSetting: "url", class: "private" }]);
  });

  it("sends its one key only to that server, as a bearer token", () => {
    expect(sheet.secrets).toEqual({
      "paperclip-key": {
        purpose: expect.any(String),
        hosts: [{ fromSetting: "url" }],
        as: "bearer",
      },
    });
  });

  it("needs nothing beyond HTTP", () => {
    expect(sheet.needs).toEqual([]);
  });
});

/** The smallest valid arguments for each tool the code has. */
const callsOfEveryTool: Record<string, Record<string, unknown>> = {
  issues_list: {},
  issues_get: { issue: "HAL-12" },
  issues_list_comments: { issue: "HAL-12" },
  issues_get_document: { issue: "HAL-12", key: "plan" },
  issues_list_inbox: {},
};

describe("the integration's code", () => {
  it("has only tools the sheet declares, each of them read only", () => {
    const declared = new Map(sheet.tools.map((tool) => [tool.name, tool]));
    for (const tool of paperclipIssues.tools) {
      expect(declared.get(tool.name)?.risk, tool.name).toBe("read");
      expect(tool.risk, tool.name).toBe("read");
    }
  });

  it.each([
    "issues_update",
    "issues_create",
    "issues_add_comment",
    "issues_delete",
    "issues_checkout",
  ])("refuses %s before any request", async (name) => {
    const { connection, requests } = connectToFakePaperclip(200, "{}");
    await expect(connection.callTool(name, { issue: "HAL-12" })).rejects.toMatchObject({
      name: "PaperclipError",
      code: "not-found",
    });
    expect(requests).toHaveLength(0);
  });

  it("sends only GET requests, each asking the kit for paperclip-key as bearer", async () => {
    expect(Object.keys(callsOfEveryTool)).toEqual(paperclipIssues.tools.map((tool) => tool.name));
    const { connection, requests } = connectToFakePaperclip(200, "[]");
    for (const [name, args] of Object.entries(callsOfEveryTool)) {
      // The fake's `[]` only fits the lists; the request is what counts here.
      await connection.callTool(name, args).catch(() => undefined);
    }
    expect(requests).toHaveLength(paperclipIssues.tools.length);
    for (const request of requests) {
      expect(request.init?.method, request.url).toBe("GET");
      expect(request.init?.body, request.url).toBeUndefined();
      expect(asksForPaperclipKey(request.init), request.url).toBe(true);
    }
  });
});
