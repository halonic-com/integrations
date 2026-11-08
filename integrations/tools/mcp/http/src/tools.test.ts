import { describe, expect, it } from "vitest";
import {
  maxDescriptionChars,
  maxParametersChars,
  maxParametersDepth,
  maxToolListChars,
} from "./limits.ts";
import { toIntegrationTool, toIntegrationTools, withoutHiddenText } from "./tools.ts";

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

  it("refuses an argument schema nested deeper than the limit, naming the tool", () => {
    // Small enough for the size limit, deep enough to overflow JSON.stringify.
    const json = `{"type":"object","default":${"[".repeat(5_000)}${"]".repeat(5_000)}}`;
    expect(json.length).toBeLessThan(maxParametersChars);
    const deep = JSON.parse(json);
    expect(() => toIntegrationTool({ name: "echo", inputSchema: deep })).toThrow(
      expect.objectContaining({
        code: "unexpected-response",
        message: `The MCP server's tool echo nests its arguments more than ${maxParametersDepth} levels deep.`,
      }),
    );
  });

  it("accepts an argument schema exactly at the nesting limit", () => {
    // The schema object itself is the first level.
    const nested = `${"[".repeat(maxParametersDepth - 1)}${"]".repeat(maxParametersDepth - 1)}`;
    const atLimit = JSON.parse(`{"type":"object","default":${nested}}`);
    expect(toIntegrationTool({ name: "echo", inputSchema: atLimit }).parameters).toEqual(atLimit);
    const overLimit = JSON.parse(`{"type":"object","default":[${nested}]}`);
    expect(() => toIntegrationTool({ name: "echo", inputSchema: overLimit })).toThrow(
      /levels deep/,
    );
  });

  it("keeps a property named __proto__ in the schema", () => {
    // JSON.parse makes "__proto__" an ordinary key, as it is in the server's answer.
    const schema = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"},"a":{"type":"string"}}}',
    );
    const parameters = toIntegrationTool({ name: "echo", inputSchema: schema }).parameters;
    expect(Object.keys(parameters["properties"] as object)).toEqual(["__proto__", "a"]);
    expect(JSON.stringify(parameters)).toBe(JSON.stringify(schema));
  });

  it("takes hidden characters out of the descriptions, also inside the schema", () => {
    const hidden = "Echoes\u200b text.\u202e\u{e0041}\u0007\ufe01\u{e0100}";
    const tool = toIntegrationTool({
      name: "echo",
      description: hidden,
      inputSchema: {
        type: "object",
        title: hidden,
        properties: { text: { type: "string", description: hidden, pattern: "^a\u200bb$" } },
      },
    });
    expect(tool.description).toBe("Echoes text.");
    expect(tool.parameters).toEqual({
      type: "object",
      title: "Echoes text.",
      // A pattern is the server's rule for the argument, so it stays as written.
      properties: { text: { type: "string", description: "Echoes text.", pattern: "^a\u200bb$" } },
    });
  });
});

describe("withoutHiddenText", () => {
  it("keeps line breaks, tabs and visible text in any script", () => {
    expect(withoutHiddenText("Line one\n\tLine two: Grüße, 你好, 😀")).toBe(
      "Line one\n\tLine two: Grüße, 你好, 😀",
    );
  });
});

describe("toIntegrationTools", () => {
  it("offers every tool, in the server's order", () => {
    const tools = toIntegrationTools([
      { name: "b", inputSchema },
      { name: "a", inputSchema },
    ]);
    expect(tools.map((tool) => tool.name)).toEqual(["b", "a"]);
  });

  it("refuses a list that repeats a name, naming the tool", () => {
    const list = [
      { name: "search_notes", description: "Finds notes.", inputSchema },
      { name: "search_notes", description: "Deletes notes.", inputSchema },
    ];
    expect(() => toIntegrationTools(list)).toThrow(
      expect.objectContaining({
        code: "unexpected-response",
        message: "The MCP server lists its tool search_notes more than once.",
      }),
    );
  });

  it("refuses a list above its limit, even when each tool is within its own", () => {
    const description = "a".repeat(maxDescriptionChars);
    const charsPerTool = description.length + JSON.stringify(inputSchema).length;
    const toolsThatFit = Math.floor(maxToolListChars / charsPerTool);
    const list = Array.from({ length: toolsThatFit + 1 }, (_, index) => ({
      name: `tool_${index}`,
      description,
      inputSchema,
    }));
    expect(toIntegrationTools(list.slice(0, toolsThatFit))).toHaveLength(toolsThatFit);
    expect(() => toIntegrationTools(list)).toThrow(
      expect.objectContaining({
        code: "unexpected-response",
        message: `The MCP server's tools take more than ${maxToolListChars} characters to describe.`,
      }),
    );
  });
});
