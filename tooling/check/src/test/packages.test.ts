import { describe, expect, it } from "vitest";
import {
  type FixturePackage,
  integration,
  manifestFor,
  rulesHit,
  runChecks,
  tool,
} from "./fixture-repo.ts";

describe("tooling/check: packages", () => {
  it("passes an empty integration and an empty tool", () => {
    expect(runChecks([integration("gmail"), tool("record")])).toEqual([]);
  });

  it("requires workspace:* for internal dependencies", () => {
    const ranged = integration("drive", {
      dependencies: { "@halonicjs/integration-google-auth": "^0.1.0" },
    });
    expect(rulesHit([integration("google-auth"), ranged])).toEqual(["packages"]);
  });

  it("flags wrong names, public packages and a missing owner", () => {
    const wrong: FixturePackage = {
      directory: "integrations/gmail",
      manifest: {
        name: "@halonicjs/gmail",
        type: "module",
        exports: { ".": "./src/index.ts" },
        halonic: { layer: "integrations" },
      },
    };
    const messages = runChecks([wrong]).map((problem) => problem.message);
    expect(
      messages.some((message) => message.includes('must be "@halonicjs/integration-gmail"')),
    ).toBe(true);
    expect(messages.some((message) => message.includes('"private": true'))).toBe(true);
    expect(messages.some((message) => message.includes("owner"))).toBe(true);
  });

  it("allows only the root entry point for an integration", () => {
    const leaky = integration("gmail", {
      exports: { ".": "./src/index.ts", "./internal": "./src/index.ts" },
    });
    expect(rulesHit([leaky])).toEqual(["packages"]);
  });

  it("rejects packages outside integrations/ and tooling/", () => {
    const stray: FixturePackage = {
      directory: "packages/core/std",
      manifest: manifestFor("@halonicjs/std", "core"),
    };
    const messages = runChecks([stray], {
      extraFiles: { "pnpm-workspace.yaml": "packages:\n  - packages/core/*\n" },
    }).map((problem) => problem.message);
    expect(messages.some((message) => message.includes("Packages live only in"))).toBe(true);
  });
});
