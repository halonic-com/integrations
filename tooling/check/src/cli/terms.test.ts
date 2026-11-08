import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "terms.ts");

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "terms-cli-"));
  writeFileSync(join(repo, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  writeFileSync(join(repo, "notes.md"), "A harmless note.\n");
  execFileSync("git", ["init", "--quiet"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** Runs the guard in the throwaway repo with only the variables given. */
function run(environment: Record<string, string>, ...args: string[]) {
  const result = spawnSync("node", [script, ...args], {
    cwd: repo,
    encoding: "utf8",
    // An empty HOME keeps a real local deny-terms file out of the test.
    env: {
      ...process.env,
      HOME: repo,
      HALONIC_DENY_TERMS: "",
      HALONIC_TERMS_REQUIRED: "",
      GITHUB_ACTIONS: "",
      ...environment,
    },
  });
  return { code: result.status, output: result.stdout + result.stderr };
}

describe("terms guard command", () => {
  it("skips with a warning when nothing is configured", () => {
    const result = run({});
    expect(result.code).toBe(0);
    expect(result.output).toContain("SKIPPED");
  });

  it("fails instead of skipping when the list is required", () => {
    const result = run({ HALONIC_TERMS_REQUIRED: "true" });
    expect(result.code).toBe(1);
    expect(result.output).toContain("HALONIC_TERMS_REQUIRED is true");
  });

  it("still skips when the requirement is explicitly off", () => {
    expect(run({ HALONIC_TERMS_REQUIRED: "false" }).code).toBe(0);
  });

  it("fails when the secret is set but holds no term", () => {
    const result = run({ HALONIC_DENY_TERMS: "# only a comment\n, ,\n" });
    expect(result.code).toBe(1);
    expect(result.output).toContain("holds no usable term");
  });

  it("finds a term and never prints it", () => {
    writeFileSync(join(repo, "notes.md"), "see the Blue%20Whale\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    const result = run({ HALONIC_DENY_TERMS: "blue whale" });
    expect(result.code).toBe(1);
    expect(result.output).toContain("notes.md:1");
    expect(result.output.toLowerCase()).not.toContain("whale");
  });

  it("asks GitHub to mask every term, once per line of the list", () => {
    const result = run({ GITHUB_ACTIONS: "true", HALONIC_DENY_TERMS: "zebra\n50%\nblue whale" });
    expect(result.output).toContain("::add-mask::zebra\n");
    expect(result.output).toContain("::add-mask::50%25\n");
    expect(result.output).toContain("::add-mask::blue whale\n");
  });

  it("reads the allowed phrases from the file it is given, not the repo's copy", () => {
    mkdirSync(join(repo, "tooling", "check"), { recursive: true });
    writeFileSync(join(repo, "tooling", "check", "terms-allowed-phrases.txt"), "zebra-crossing\n");
    writeFileSync(join(repo, "notes.md"), "a zebra-crossing\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    const environment = { HALONIC_DENY_TERMS: "zebra" };
    expect(run(environment).code).toBe(0);

    const trusted = join(repo, "trusted.txt");
    writeFileSync(trusted, "# nothing is allowed\n");
    expect(run(environment, "--allowed-phrases", trusted).code).toBe(1);
  });

  it("fails when an allowed phrase is a term itself", () => {
    const phrases = join(repo, "phrases.txt");
    writeFileSync(phrases, "Crossing\n");
    const result = run({ HALONIC_DENY_TERMS: "crossing" }, "--allowed-phrases", phrases);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("Allowed phrase number 1 is a protected term itself");
  });
});
