import { describe, expect, it } from "vitest";
import {
  type FixturePackage,
  groupedIntegration,
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

  it("passes integrations in the group folders", () => {
    const grouped = [
      groupedIntegration("models/anthropic", "model-anthropic"),
      groupedIntegration("knowledge/mcp", "knowledge-mcp"),
      groupedIntegration("tools/google/gmail", "tool-google-gmail"),
      groupedIntegration("tools/google/shared", "tool-google-shared"),
      integration("mcp"),
    ];
    expect(runChecks(grouped)).toEqual([]);
  });

  it("names a grouped integration after all its folders", () => {
    const short = groupedIntegration("knowledge/mcp", "mcp");
    const messages = runChecks([short]).map((problem) => problem.message);
    expect(
      messages.some((message) =>
        message.includes('must be "@halonicjs/integration-knowledge-mcp"'),
      ),
    ).toBe(true);
  });

  it("flags a package that pnpm doesn't see because a folder level is missing", () => {
    const missingGroup = groupedIntegration("google/gmail", "tool-google-gmail");
    const messages = runChecks([missingGroup]).map((problem) => problem.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("pnpm doesn't see this package");
  });

  it.each(["models/openai/chat", "tools/google/gmail/labels"])(
    "flags a package that pnpm doesn't see because integrations/%s is a level too deep",
    (folders) => {
      const tooDeep = groupedIntegration(folders, folders.replaceAll("/", "-"));
      const messages = runChecks([tooDeep]).map((problem) => problem.message);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("pnpm doesn't see this package");
    },
  );

  it.each([
    // match integrations/*, so pnpm sees them and the place is wrong
    ["models", "Packages live only in"],
    ["knowledge", "Packages live only in"],
    ["tools", "Packages live only in"],
    // matches no glob, so pnpm doesn't see it
    ["tools/google", "pnpm doesn't see this package"],
  ])("rejects a package in the group folder integrations/%s", (folders, expected) => {
    const group = groupedIntegration(folders, folders.replace("/", "-"));
    const messages = runChecks([group]).map((problem) => problem.message);
    expect(messages.some((message) => message.includes(expected))).toBe(true);
  });

  it("requires every folder level to be kebab-case", () => {
    const badProvider = groupedIntegration("tools/Google/gmail", "tool-Google-gmail");
    const messages = runChecks([badProvider]).map((problem) => problem.message);
    expect(messages.some((message) => message.includes('Folder name "Google"'))).toBe(true);
  });

  it("rejects two packages with the same name", () => {
    const twins = [
      groupedIntegration("tools/google-cloud/storage", "tool-google-cloud-storage"),
      groupedIntegration("tools/google/cloud-storage", "tool-google-cloud-storage"),
    ];
    const messages = runChecks(twins).map((problem) => problem.message);
    expect(messages).toHaveLength(2);
    for (const folder of ["tools/google-cloud/storage", "tools/google/cloud-storage"]) {
      expect(
        messages.some((message) =>
          message.includes(`is also the name of the package in integrations/${folder}.`),
        ),
      ).toBe(true);
    }
  });

  it.each([
    ["model-anthropic", "models"],
    ["tool-google-gmail", "tools"],
    ["knowledge-mcp", "knowledge"],
  ])("rejects the ungrouped folder integrations/%s, whose name belongs to %s", (folder, group) => {
    const messages = runChecks([integration(folder)]).map((problem) => problem.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(`kept for integrations/${group}/`);
  });
});
