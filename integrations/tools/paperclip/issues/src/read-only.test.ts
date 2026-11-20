import { readSheetData } from "@halonicjs/tooling-record/sheet-data";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * What the permission sheet promises the user, pinned so a later change
 * can't loosen it quietly: every tool only reads, and the one key goes
 * only to the Paperclip server the workspace chose. The code's own tests
 * (no write tool, only GET requests) come with the client.
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

  it("reaches only the Paperclip server in the url setting, over https", () => {
    expect(sheet.hosts).toEqual([{ fromSetting: "url", class: "public" }]);
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
