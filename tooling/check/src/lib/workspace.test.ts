import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expandWorkspaceGlob, readCatalog, readWorkspaceGlobs } from "./workspace.ts";

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

describe("readCatalog", () => {
  it("reads quoted and plain names up to the next key", () => {
    const yaml = [
      "packages:",
      "  - tooling/*",
      "catalog:",
      '  "@halonicjs/adapters": 0.1.0',
      "  # a comment",
      "  zod: ^4.6.7 # a trailing comment",
      "",
      "minimumReleaseAge: 4320",
    ].join("\n");
    expect([...readCatalog(yaml)]).toEqual([
      ["@halonicjs/adapters", "0.1.0"],
      ["zod", "^4.6.7"],
    ]);
  });

  it("is empty without a catalog", () => {
    expect(readCatalog("packages:\n  - tooling/*\n").size).toBe(0);
  });
});

describe("expandWorkspaceGlob", () => {
  function expandIn(folders: readonly string[], glob: string): string[] {
    const root = mkdtempSync(join(tmpdir(), "halonic-workspace-"));
    try {
      for (const folder of folders) {
        mkdirSync(join(root, folder), { recursive: true });
      }
      return expandWorkspaceGlob(root, glob).sort();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const folders = [
    "integrations/mcp/node_modules/zod",
    "integrations/tools/google/gmail",
    "integrations/tools/google/drive",
    "integrations/tools/google/node_modules",
    "integrations/tools/microsoft/outlook",
  ];

  it("lets each * stand for one folder name", () => {
    expect(expandIn(folders, "integrations/tools/*/*")).toEqual([
      "integrations/tools/google/drive",
      "integrations/tools/google/gmail",
      "integrations/tools/microsoft/outlook",
    ]);
  });

  it("keeps a plain folder and finds nothing below a missing one", () => {
    expect(expandIn(folders, "integrations/mcp")).toEqual(["integrations/mcp"]);
    expect(expandIn(folders, "integrations/models/*")).toEqual([]);
  });

  it("never looks inside node_modules", () => {
    expect(expandIn(folders, "integrations/*/*")).not.toContain("integrations/mcp/node_modules");
  });

  it("throws on ** and on * inside a folder name", () => {
    expect(() => expandIn([], "integrations/**")).toThrow(/Unsupported workspace glob/);
    expect(() => expandIn([], "integrations/llm-*")).toThrow(/Unsupported workspace glob/);
  });

  it.each(["integrations/*/", "./integrations/*", "integrations/../x/*", "integrations//*"])(
    "throws on an empty, . or .. folder in %s",
    (glob) => {
      expect(() => expandIn([], glob)).toThrow(/Unsupported workspace glob/);
    },
  );
});
