import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { drive } from "./index.ts";

/**
 * The permission sheet against the code, until the conformance suite runs
 * in this repo (it compares the same, through the kit's loader): every
 * description word for word, `risk` and `untrusted` for every tool, in the
 * same order, and every argument. An argument without a description fails:
 * the sheet couldn't show it, and the user would approve a tool without
 * seeing it. Gmail's `sheet.test.ts` is the same test.
 *
 * Without a YAML parser: folded text (`>-`) joins its lines with spaces, so
 * with every run of whitespace squeezed to one space, each description must
 * appear in the sheet as it is. That's why the sheet writes no text in
 * quotes: YAML's quoting would change it.
 */
const sheet = readFileSync(new URL("../integration.yaml", import.meta.url), "utf8");
const squeeze = (text: string) => text.replace(/\s+/g, " ");

/** Each tool's block of the sheet, from its `- name:` to the next. */
const toolBlocks = sheet
  .slice(sheet.indexOf("\ntools:"), sheet.indexOf("\nneeds:"))
  .split(/\n {2}- name: /)
  .slice(1);

/** The argument names a tool's block lists under `arguments:`. */
function sheetArguments(block: string): string[] {
  const section = /\n {4}arguments:\n((?: {6}.*\n)*)/.exec(`${block}\n`)?.[1] ?? "";
  return [...section.matchAll(/^ {6}(\w+):/gm)].map((match) => match[1] ?? "");
}

describe("integration.yaml", () => {
  it("declares the code's tools in the same order", () => {
    expect(toolBlocks.map((block) => block.split("\n")[0])).toEqual(
      drive.tools.map((tool) => tool.name),
    );
  });

  it.each(drive.tools.map((tool, index) => [tool.name, tool, index] as const))(
    "has %s's risk, untrusted, noun and every description word for word",
    (_name, tool, index) => {
      const block = toolBlocks[index] ?? "";
      expect(block).toMatch(new RegExp(`\\n {4}risk: ${tool.risk}\\b`));
      expect(block).toMatch(new RegExp(`\\n {4}untrusted: ${tool.untrusted}\\b`));
      // A send tool says what it sends and what it does to it, so a run can
      // say "Saved 1 Drive file" rather than "Sent" (HAL-2836, HAL-2868).
      if (tool.risk === "send") {
        expect(block).toMatch(
          /\n {4}noun: \{ one: Drive [a-z]+, many: Drive [a-z]+ \}\n {4}verb: (?:saved|created|updated|moved)\n/,
        );
      }
      const text = squeeze(block);
      expect(text).toContain(tool.description);
      const properties = (tool.parameters["properties"] ?? {}) as Record<
        string,
        { description?: string }
      >;
      for (const [argument, schema] of Object.entries(properties)) {
        expect(schema.description, `${argument} has no description`).toBeDefined();
        expect(text).toContain(schema.description);
      }
      // Both ways: the sheet lists no argument the code doesn't take.
      expect(sheetArguments(block).sort()).toEqual(Object.keys(properties).sort());
    },
  );
});
