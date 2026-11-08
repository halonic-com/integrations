import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readWorkspaceGlobs } from "./workspace.ts";

function globsOf(yaml: string): string[] {
  const root = mkdtempSync(join(tmpdir(), "halonic-workspace-"));
  try {
    writeFileSync(join(root, "pnpm-workspace.yaml"), yaml);
    return readWorkspaceGlobs(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("readWorkspaceGlobs", () => {
  it("reads an indented block list up to the next key", () => {
    const yaml =
      "packages:\n  - apps/*\n  # a comment\n\n  - 'tooling/*' # quoted\ncatalog:\n  a: 1\n";
    expect(globsOf(yaml)).toEqual(["apps/*", "tooling/*"]);
  });

  it("reads items at column 0, which pnpm also accepts", () => {
    expect(globsOf("packages:\n- apps/*\n- packages/host\nallowBuilds: {}\n")).toEqual([
      "apps/*",
      "packages/host",
    ]);
  });

  it("throws on a flow-style list instead of seeing no packages", () => {
    expect(() => globsOf("packages: [apps/*, tooling/*]\n")).toThrow(/not a block list/);
  });

  it("throws on a line it can't read", () => {
    expect(() => globsOf("packages:\n  - apps/*\n  - [tooling/*]\n")).toThrow(/line 3/);
  });

  it("throws when packages is missing or empty", () => {
    expect(() => globsOf("packages:\n\ncatalog: {}\n")).toThrow(/lists no folders/);
    expect(() => globsOf("catalog: {}\n")).toThrow(/is missing/);
  });
});
