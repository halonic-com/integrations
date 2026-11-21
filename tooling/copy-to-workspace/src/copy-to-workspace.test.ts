import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCopyCommand } from "./copy-to-workspace.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const id = "tool-paperclip-issues";

let workspace: string;
let printed: string[];

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "copy-to-workspace-test-"));
  writeFileSync(join(workspace, "workspace.yaml"), "id: test\nname: Test\n");
  printed = [];
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

async function copy(...args: string[]): Promise<number> {
  return await runCopyCommand({ root, args, print: (line) => printed.push(line) });
}

describe("pnpm copy-to-workspace", () => {
  // Builds the integration and its packages with tsc, which takes a few seconds.
  it("builds a folder whose default export is the integration", { timeout: 60_000 }, async () => {
    expect(await copy(id, workspace)).toBe(0);
    const folder = join(workspace, "integrations", id);
    expect(readFileSync(join(folder, "integration.yaml"), "utf8")).toBe(
      readFileSync(join(root, "integrations/tools/paperclip/issues/integration.yaml"), "utf8"),
    );
    const entry = await import(pathToFileURL(join(folder, "backend", "index.js")).href);
    expect(entry.default.name).toBe(id);
    expect(entry.default.tools).toHaveLength(5);
    expect(printed[0]).toBe(`Copied ${id} to ${folder}.`);
  });

  it("leaves only relative imports and zod, as Halonic's runner allows", {
    timeout: 60_000,
  }, async () => {
    expect(await copy(id, workspace)).toBe(0);
    const backend = join(workspace, "integrations", id, "backend");
    const imports = globSync("**/*.js", { cwd: backend }).flatMap((file) =>
      [...readFileSync(join(backend, file), "utf8").matchAll(/\b(?:from|import)\s*"([^"]+)"/g)].map(
        (match) => match[1] as string,
      ),
    );
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((name) => !name.startsWith(".") && name !== "zod")).toEqual([]);
  });

  it("replaces a folder that holds the same integration", { timeout: 60_000 }, async () => {
    expect(await copy(id, workspace)).toBe(0);
    const stale = join(workspace, "integrations", id, "backend", "stale.js");
    writeFileSync(stale, "");
    expect(await copy(id, workspace)).toBe(0);
    expect(globSync("backend/stale.js", { cwd: join(workspace, "integrations", id) })).toEqual([]);
  });

  it("refuses a folder that holds something else, and leaves it as it was", async () => {
    const other = join(workspace, "integrations", id);
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "notes.txt"), "mine");
    expect(await copy(id, workspace)).toBe(1);
    expect(printed[0]).toContain("is already there and doesn't hold tool-paperclip-issues");
    expect(readFileSync(join(other, "notes.txt"), "utf8")).toBe("mine");
  });

  it("refuses a folder that isn't a workspace", async () => {
    rmSync(join(workspace, "workspace.yaml"));
    expect(await copy(id, workspace)).toBe(1);
    expect(printed[0]).toContain("isn't a Halonic workspace");
  });

  it("refuses an integration it can't find", async () => {
    expect(await copy("tool-nowhere-nothing", workspace)).toBe(1);
    expect(printed[0]).toBe('No integration has the id or path "tool-nowhere-nothing".');
  });

  it("shows the usage for a wrong number of arguments", async () => {
    expect(await copy(id)).toBe(2);
    expect(printed[0]).toMatch(/^Usage: pnpm copy-to-workspace/);
  });
});
