import { describe, expect, it } from "vitest";
import { readSheetFields, SheetSyntaxError } from "./sheet-yaml.ts";

function fieldValue(text: string, name: string): unknown {
  return readSheetFields(text, [name]).get(name)?.value;
}

/** The line of the SheetSyntaxError that reading field `a` throws, if any. */
function errorLine(text: string): number | undefined {
  try {
    readSheetFields(text, ["a"]);
  } catch (error) {
    return error instanceof SheetSyntaxError ? error.line : undefined;
  }
  return undefined;
}

describe("tooling/check: reading sheet fields", () => {
  it("reads only the fields asked for, with their lines", () => {
    const text = "id: x\n\n# hosts\nhosts:\n  - a.example.com\ntools:\n  - name: |\n";
    const fields = readSheetFields(text, ["hosts", "secrets"]);
    expect([...fields.keys()]).toEqual(["hosts"]);
    expect(fields.get("hosts")).toEqual({ line: 4, value: ["a.example.com"] });
  });

  it("reads nested block mappings and one-line lists", () => {
    const text = `secrets:
  google-account:
    purpose: Access, through the sign-in.
    hosts: [a.example.com, { fromSetting: server }]
`;
    expect(fieldValue(text, "secrets")).toEqual({
      "google-account": {
        purpose: "Access, through the sign-in.",
        hosts: ["a.example.com", { fromSetting: "server" }],
      },
    });
  });

  it("keeps a # inside quotes and an apostrophe in plain text", () => {
    expect(fieldValue('a: "x # y" # comment\n', "a")).toBe("x # y");
    expect(fieldValue("a: it doesn't # comment\n", "a")).toBe("it doesn't");
    expect(fieldValue("a: { b: it's, c: 'd, e' }\n", "a")).toEqual({ b: "it's", c: "d, e" });
  });

  it("reads list entries that are mappings, scalars or empty", () => {
    const text = "a:\n  - b: 1\n    c: 2\n  - plain\n  -\n";
    expect(fieldValue(text, "a")).toEqual([{ b: "1", c: "2" }, "plain", null]);
  });

  it("throws with the line for YAML it doesn't cover", () => {
    expect(errorLine("a: [b,\n  c]\n")).toBe(1);
    expect(errorLine("a:\n  b: 1\n  - c\n")).toBe(3);
    expect(errorLine('a: "open\n')).toBe(1);
    expect(errorLine("a:\n    b: 1\n  c: 2\n")).toBe(3);
    expect(errorLine("a: *alias\n")).toBe(1);
    expect(errorLine("a:\n  - |\n    text\n")).toBe(2);
  });

  it("throws for a top-level key that isn't plain, even one it wasn't asked for", () => {
    expect(errorLine('id: x\n"a": 1\n')).toBe(2);
    expect(errorLine("id: x\n'a': 1\n")).toBe(2);
    expect(errorLine("id: x\na : 1\n")).toBe(2);
    expect(errorLine("id: x\n- a\n")).toBe(2);
    expect(errorLine('"other": 1\n')).toBe(1);
  });
});
