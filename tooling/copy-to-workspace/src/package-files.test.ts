import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FolderError } from "./folder-error.ts";
import { runtimePackages } from "./package-files.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "package-files-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writePackage(folder: string, name: string, dependencies: Record<string, string> = {}) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "package.json"),
    JSON.stringify({ name, exports: "./index.js", dependencies }),
  );
}

function link(from: string, to: string) {
  mkdirSync(dirname(from), { recursive: true });
  symlinkSync(to, from, "dir");
}

describe("runtimePackages", () => {
  it("finds an npm package's own dependency next to it, as pnpm installs it", () => {
    // pnpm: <store>/a@1/node_modules/a, with its dependency b at <store>/a@1/node_modules/b.
    const store = join(root, "node_modules", ".pnpm");
    const a = join(store, "a@1", "node_modules", "a");
    const b = join(store, "b@1", "node_modules", "b");
    writePackage(a, "a", { b: "^1.0.0" });
    writePackage(b, "b");
    link(join(store, "a@1", "node_modules", "b"), b);
    const integration = join(root, "integration");
    writePackage(integration, "integration", { a: "^1.0.0" });
    link(join(integration, "node_modules", "a"), a);

    const packages = runtimePackages(integration);

    expect(packages.map((p) => [p.name, p.source])).toEqual([
      ["integration", "workspace"],
      ["a", "npm"],
      ["b", "npm"],
    ]);
  });

  it("refuses a dependency that isn't installed, naming both packages", () => {
    const integration = join(root, "integration");
    writePackage(integration, "integration", { missing: "^1.0.0" });

    expect(() => runtimePackages(integration)).toThrow(FolderError);
    expect(() => runtimePackages(integration)).toThrow("integration needs missing");
  });
});
