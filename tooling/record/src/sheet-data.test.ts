import { describe, expect, it } from "vitest";
import { readSheetData } from "./sheet-data.ts";

const gmailSheetUrl = new URL(
  "../../../integrations/tools/google/gmail/integration.yaml",
  import.meta.url,
);

describe("readSheetData", () => {
  it("reads a real permission sheet as typed data", () => {
    const sheet = readSheetData(gmailSheetUrl);

    expect(sheet).toMatchObject({ tools: expect.any(Array) });
    const tools = (sheet as { tools: { name: string; risk: string }[] }).tools;
    expect(tools).toContainEqual(expect.objectContaining({ name: "gmail_send", risk: "send" }));
  });
});
