import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadContext, rules } from "@halonicjs/tooling-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FAKE } from "../test/fakes.ts";
import { checkOffers } from "./check-offered.ts";

const realRoot = join(import.meta.dirname, "..", "..", "..", "..");
const cli = join(realRoot, "tooling/record/src/cli/check-offered.ts");
const sample = "integrations/offered/sample";

let root: string;

/** A throwaway repo with the real sample offer and the files `pnpm check` reads. */
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "halonic-offered-"));
  for (const file of [
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "tooling/check/policy.json",
    "tooling/check/dependencies.json",
    "tooling/check/advisories-ignored.json",
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(join(realRoot, file), join(root, file));
  }
  cpSync(join(realRoot, sample), join(root, sample), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

function runCli(): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [cli], { cwd: root, encoding: "utf8" });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe("check:offered", () => {
  it("passes the sample offer", () => {
    expect(runCli()).toMatchObject({ status: 0 });
  });

  it("fails on a fake key in the backend and never prints it", () => {
    const backend = `${sample}/backend/index.js`;
    write(backend, `${readFileSync(join(root, backend), "utf8")}const key = "${FAKE.apiKey}";\n`);
    const { status, output } = runCli();
    expect(status).toBe(1);
    expect(output).toContain(`${backend}: Looks like a fake-key`);
    expect(output).not.toContain(FAKE.apiKey);
  });

  it("refuses a package.json, so pnpm and Turbo never see a package", () => {
    write(`${sample}/package.json`, '{"scripts":{"build":"node backend/index.js"}}');
    write("integrations/offered/package.json", "{}");
    const { status, output } = runCli();
    expect(status).toBe(1);
    expect(output).toContain(`${sample}/package.json: An offer holds only`);
    expect(output).toContain("integrations/offered/package.json: Only offer folders");
  });

  it("refuses a link instead of following it", () => {
    rmSync(join(root, sample, "OFFER.md"));
    symlinkSync(join(root, "package.json"), join(root, sample, "OFFER.md"));
    expect(runCli().output).toContain(`${sample}/OFFER.md: Not a plain file`);
  });

  it("never runs an offer: a backend that writes a file when loaded leaves none", () => {
    const marker = join(root, sample, "backend", "loaded");
    write(
      `${sample}/backend/index.js`,
      'import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./loaded", import.meta.url), "");\n',
    );
    runCli();
    const context = loadContext(root);
    for (const rule of Object.values(rules)) {
      rule(context);
    }
    expect(existsSync(marker)).toBe(false);
  });
});

describe("checkOffers", () => {
  it("asks for every file an offer needs and a plain folder name", () => {
    const problems = checkOffers(root, ["integrations/offered/Bad_Name/notes.txt"]);
    expect(problems.map((problem) => problem.file)).toEqual([
      "integrations/offered/Bad_Name/",
      "integrations/offered/Bad_Name/integration.yaml",
      "integrations/offered/Bad_Name/connector.yaml",
      "integrations/offered/Bad_Name/OFFER.md",
      "integrations/offered/Bad_Name/backend/index.js",
      "integrations/offered/Bad_Name/notes.txt",
    ]);
  });
});
