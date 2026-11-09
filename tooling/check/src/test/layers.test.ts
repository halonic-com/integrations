import { describe, expect, it } from "vitest";
import { integration, rulesHit, runChecks, tool } from "./fixture-repo.ts";

describe("tooling/check: layers", () => {
  it("stops integrations from using Node APIs, also bare built-in names", () => {
    const usesNode = integration(
      "gmail",
      {},
      {
        "src/index.ts": 'import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n',
      },
    );
    const usesBare = integration(
      "drive",
      {},
      {
        "src/index.ts": 'import { join } from "path";\nexport const x = join;\n',
      },
    );
    const messages = runChecks([usesNode, usesBare]).map((problem) => problem.message);
    expect(messages.some((message) => message.includes('Node APIs ("node:fs")'))).toBe(true);
    expect(messages.some((message) => message.includes('Node APIs ("path")'))).toBe(true);
  });

  it("lets integration tests use Node APIs and dev tooling", () => {
    const tested = integration(
      "gmail",
      { devDependencies: { vitest: "catalog:" } },
      {
        "src/index.ts": "export const x = 1;\n",
        "src/index.test.ts":
          'import { readFileSync } from "node:fs";\nimport { it } from "vitest";\nit("reads", () => readFileSync);\n',
      },
    );
    expect(rulesHit([tested])).toEqual([]);
  });

  it("lets integrations use each other through the public entry point only", () => {
    const viaEntry = integration(
      "gmail",
      { dependencies: { "@halonicjs/integration-google-auth": "workspace:*" } },
      {
        "src/index.ts": 'import { x } from "@halonicjs/integration-google-auth";\nexport { x };\n',
      },
    );
    const deep = integration(
      "drive",
      { dependencies: { "@halonicjs/integration-google-auth": "workspace:*" } },
      { "src/index.ts": 'import "@halonicjs/integration-google-auth/src/index.ts";\n' },
    );
    expect(rulesHit([integration("google-auth"), viaEntry])).toEqual([]);
    const messages = runChecks([integration("google-auth"), deep]).map((p) => p.message);
    expect(messages.some((message) => message.includes("not a public entry point"))).toBe(true);
  });

  it("keeps tooling out of runtime and tooling away from integrations", () => {
    const shipsTool = integration("gmail", {
      dependencies: { "@halonicjs/tooling-record": "workspace:*" },
    });
    const toolUsesIntegration = tool("record", {
      devDependencies: { "@halonicjs/integration-gmail": "workspace:*" },
    });
    const shipped = runChecks([tool("record"), shipsTool]).map((problem) => problem.message);
    expect(shipped.some((message) => message.includes("dev-only"))).toBe(true);
    const reversed = runChecks([integration("gmail"), toolUsesIntegration]).map((p) => p.message);
    expect(reversed.some((message) => message.includes("only other tooling packages"))).toBe(true);
  });

  it("catches relative imports that leave the package", () => {
    const sneaky = integration(
      "drive",
      {},
      {
        "src/index.ts": 'import "../../gmail/src/index.ts";\n',
      },
    );
    const messages = runChecks([integration("gmail"), sneaky]).map((p) => p.message);
    expect(messages.some((message) => message.includes("reaches outside"))).toBe(true);
  });

  it("stops library code from importing test code, which may load Node's types", () => {
    const probe = integration(
      "mcp",
      {},
      {
        "src/test/probe-fake.ts": '/// <reference types="node" />\nexport const probeFake = 1;\n',
        "src/test/index.ts": 'export * from "./probe-fake.ts";\n',
        "src/probe.ts":
          'import { probeFake } from "./test/probe-fake.ts";\nexport const p = probeFake;\n',
        "src/folder.ts": 'import "./test";\n',
        "src/index.test.ts": 'import "./test/probe-fake.ts";\n',
      },
    );
    const problems = runChecks([probe])
      .filter((problem) => problem.rule === "layers")
      .map((problem) => `${problem.file}:${problem.line}`);
    expect(problems.sort()).toEqual([
      "integrations/mcp/src/folder.ts:1",
      "integrations/mcp/src/probe.ts:1",
    ]);
  });
});
