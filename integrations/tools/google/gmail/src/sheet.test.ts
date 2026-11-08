import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gmail } from "./index.ts";

/**
 * The permission sheet against the code, for what the conformance suite
 * doesn't compare yet (guide, section 3): every description word for word,
 * and `risk` and `untrusted` for every tool, in the same order.
 *
 * Without a YAML parser: folded text (`>-`) joins its lines with spaces, so
 * with every run of whitespace squeezed to one space, each description must
 * appear in the sheet as it is.
 */
const sheet = readFileSync(new URL("../integration.yaml", import.meta.url), "utf8");
const squeeze = (text: string) => text.replace(/\s+/g, " ");

/** Each tool's block of the sheet, from its `- name:` to the next. */
const toolBlocks = sheet
  .slice(sheet.indexOf("\ntools:"), sheet.indexOf("\nneeds:"))
  .split(/\n {2}- name: /)
  .slice(1);

describe("integration.yaml", () => {
  it("declares the code's tools in the same order", () => {
    expect(toolBlocks.map((block) => block.split("\n")[0])).toEqual(
      gmail.tools.map((tool) => tool.name),
    );
  });

  it.each(gmail.tools.map((tool, index) => [tool.name, tool, index] as const))(
    "has %s's risk, untrusted and every description word for word",
    (_name, tool, index) => {
      const block = toolBlocks[index] ?? "";
      expect(block).toMatch(new RegExp(`\\n {4}risk: ${tool.risk}\\n`));
      expect(block).toMatch(new RegExp(`\\n {4}untrusted: ${tool.untrusted}\\b`));
      const text = squeeze(block);
      expect(text).toContain(tool.description);
      const properties = (tool.parameters["properties"] ?? {}) as Record<
        string,
        { description?: string }
      >;
      for (const [argument, schema] of Object.entries(properties)) {
        if (schema.description === undefined) continue;
        expect(text).toContain(`${argument}:`);
        expect(text).toContain(schema.description);
      }
    },
  );
});
