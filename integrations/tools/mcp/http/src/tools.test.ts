import { describe, expect, it } from "vitest";
import { maxDescriptionChars, maxParametersChars } from "./limits.ts";
import { toIntegrationTool } from "./tools.ts";

const inputSchema = { type: "object" as const, properties: { text: { type: "string" } } };

describe("toIntegrationTool", () => {
  it("keeps the server's name, description and argument schema", () => {
    expect(toIntegrationTool({ name: "echo", description: "Echoes text.", inputSchema })).toEqual({
      name: "echo",
      description: "Echoes text.",
      parameters: inputSchema,
      risk: "write",
      untrusted: true,
    });
  });

  it("stays write and untrusted whatever the server's hints claim", () => {
    const tool = toIntegrationTool({
      name: "lookup",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    });
    expect(tool).toMatchObject({ risk: "write", untrusted: true });
  });

  it("gives a tool without a description an empty one", () => {
    expect(toIntegrationTool({ name: "echo", inputSchema }).description).toBe("");
  });

  it("cuts a long description", () => {
    const description = "a".repeat(maxDescriptionChars + 10);
    const tool = toIntegrationTool({ name: "echo", description, inputSchema });
    expect(tool.description).toHaveLength(maxDescriptionChars);
    expect(tool.description.endsWith("…")).toBe(true);
  });

  it("refuses an argument schema above the limit, naming the tool", () => {
    const huge = { type: "object" as const, description: "a".repeat(maxParametersChars) };
    expect(() => toIntegrationTool({ name: "echo", inputSchema: huge })).toThrow(
      expect.objectContaining({ name: "McpToolsError", code: "unexpected-response" }),
    );
    expect(() => toIntegrationTool({ name: "echo", inputSchema: huge })).toThrow(/tool echo/);
  });
});
