import { describe, expect, it } from "vitest";
import { integration, runChecks, tool } from "./fixture-repo.ts";

const library = "export const x = 1;\n";

function typeProblems(files: Record<string, string>): string[] {
  return runChecks([integration("calendar", {}, files)])
    .filter((problem) => problem.rule === "integration-types")
    .map((problem) => `${problem.file}${problem.line === undefined ? "" : `:${problem.line}`}`);
}

describe("tooling/check: integration-types", () => {
  it("lets tests, src/test and config files load Node types", () => {
    const files = {
      "vitest.config.ts": '/// <reference types="node" />\n',
      "src/index.ts": library,
      "src/index.test.ts": '/// <reference types="node" />\n',
      "src/test/fakes.ts": '/// <reference types="node" />\n',
    };
    expect(typeProblems(files)).toEqual([]);
  });

  it("rejects /// <reference> lines for types, lib and path in library code", () => {
    const files = {
      "src/index.ts": `// Calendar client.\n/// <reference types="node" />\n${library}`,
      "src/dom.ts": '/// <reference lib="dom" />\n',
      "src/path.ts": '/// <reference path="../node_modules/@types/node/index.d.ts" />\n',
    };
    expect(typeProblems(files).sort()).toEqual([
      "integrations/calendar/src/dom.ts:1",
      "integrations/calendar/src/index.ts:2",
      "integrations/calendar/src/path.ts:1",
    ]);
  });

  it("leaves /// <reference> lines in tooling alone", () => {
    const problems = runChecks([tool("record")], {
      extraFiles: { "tooling/record/src/index.ts": '/// <reference types="node" />\n' },
    });
    expect(problems.filter((problem) => problem.rule === "integration-types")).toEqual([]);
  });
});
