import { describe, expect, it } from "vitest";
import {
  type FixturePackage,
  integration,
  integrationConfigs,
  rulesHit,
  runChecks,
  tool,
} from "./fixture-repo.ts";

const integrationPreset = "@halonicjs/tooling-config/tsconfig/integration.json";
const nodePreset = "@halonicjs/tooling-config/tsconfig/node.json";

/** An integration whose configs or typecheck script a test replaces. */
function withConfigs(
  configs: Record<string, object | null>,
  extra: Record<string, unknown> = {},
): FixturePackage {
  const files: Record<string, string | null> = { "src/index.ts": "export const x = 1;\n" };
  for (const [file, config] of Object.entries(configs)) {
    files[file] = config === null ? null : JSON.stringify(config);
  }
  return integration("gmail", extra, files);
}

function messages(pkg: FixturePackage): string[] {
  return runChecks([pkg])
    .filter((problem) => problem.rule === "tsconfig")
    .map((problem) => `${problem.file}: ${problem.message}`);
}

describe("tooling/check: tsconfig", () => {
  it("passes an integration with both configs and a typecheck script for both", () => {
    expect(rulesHit([integration("gmail")])).toEqual([]);
  });

  it("leaves tooling packages alone", () => {
    expect(rulesHit([tool("record")])).toEqual([]);
  });

  it("fails when the library config includes the Vitest config or tests", () => {
    const included = withConfigs({
      "tsconfig.json": {
        extends: integrationPreset,
        include: ["src", "./vitest.config.ts", "src/test/"],
        exclude: ["src/**/*.test.ts"],
      },
    });
    const found = messages(included);
    expect(found.some((message) => message.includes('Remove "./vitest.config.ts"'))).toBe(true);
    expect(found.some((message) => message.includes('Remove "src/test/"'))).toBe(true);
  });

  it("fails when the Vitest config comes in through files", () => {
    const listed = withConfigs({
      "tsconfig.json": {
        extends: integrationPreset,
        include: ["src"],
        files: ["vitest.config.ts"],
        exclude: ["src/**/*.test.ts"],
      },
    });
    expect(messages(listed)).toEqual([expect.stringContaining('Remove "vitest.config.ts"')]);
  });

  it("requires the test files excluded, and src/test when there is one", () => {
    const noExclude = withConfigs({
      "tsconfig.json": { extends: integrationPreset, include: ["src"] },
    });
    expect(messages(noExclude)).toEqual([expect.stringContaining('Add "src/**/*.test.ts"')]);

    const files = {
      "src/index.ts": "export const x = 1;\n",
      "src/test/fake.ts": "export const fake = 1;\n",
      "tsconfig.json": JSON.stringify({
        extends: integrationPreset,
        include: ["src"],
        exclude: ["src/**/*.test.ts"],
      }),
    };
    expect(messages(integration("gmail", {}, files))).toEqual([
      expect.stringContaining('Add "src/test"'),
    ]);
  });

  it("requires the integration preset for the library and the node preset for tests", () => {
    const swapped = withConfigs({
      "tsconfig.json": {
        ...JSON.parse(integrationConfigs["tsconfig.json"] ?? ""),
        extends: nodePreset,
      },
      "tsconfig.test.json": {
        extends: "../../tooling/config/tsconfig/base.json",
        include: ["src"],
      },
    });
    expect(messages(swapped)).toEqual([
      expect.stringContaining(`tsconfig.json: "extends" must be "${integrationPreset}"`),
      expect.stringContaining(`tsconfig.test.json: "extends" must be "${nodePreset}"`),
    ]);
  });

  it("requires both config files", () => {
    const missing = withConfigs({ "tsconfig.json": null, "tsconfig.test.json": null });
    expect(messages(missing)).toEqual([
      "integrations/gmail/tsconfig.json: Add this file. See docs/guides/integrations.md.",
      "integrations/gmail/tsconfig.test.json: Add this file. See docs/guides/integrations.md.",
    ]);
  });

  it("fails on a config with comments", () => {
    const commented = integration(
      "gmail",
      {},
      {
        "src/index.ts": "export const x = 1;\n",
        "tsconfig.test.json": `// tests\n${integrationConfigs["tsconfig.test.json"]}`,
      },
    );
    expect(messages(commented)).toEqual([
      expect.stringContaining("tsconfig.test.json: This must be a JSON object"),
    ]);
  });

  it("requires a typecheck script that runs both configs", () => {
    for (const typecheck of [
      undefined,
      "tsc --noEmit -p .",
      "tsc --noEmit -p tsconfig.test.json",
    ]) {
      const pkg = integration("gmail", { scripts: { typecheck } });
      expect(messages(pkg)).toEqual([expect.stringContaining('"typecheck" script')]);
    }
    const spelledOut = "tsc --noEmit --project tsconfig.json && tsc --noEmit -p tsconfig.test.json";
    expect(messages(integration("gmail", { scripts: { typecheck: spelledOut } }))).toEqual([]);
  });
});
