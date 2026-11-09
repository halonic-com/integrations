import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAdvisories } from "../lib/advisories.ts";
import { checkAdvisories } from "../rules/advisories.ts";
import { runChecks } from "./fixture-repo.ts";

const today = new Date("2026-11-08T12:00:00Z");
const realRoot = join(import.meta.dirname, "..", "..", "..", "..");

const entry = {
  ghsa: "GHSA-cfgh-2345-wxrv",
  cve: "CVE-2026-12345",
  package: "left-pad",
  reason: "Only reachable through a build script that never sees user input.",
  expires: "2026-12-01",
};

function problems(ignored: unknown[], extra: Record<string, unknown> = {}): readonly string[] {
  return readAdvisories(JSON.stringify({ ignored, ...extra }), today).problems;
}

function withFile(text: string, other: Record<string, string> = {}): string[] {
  return runChecks([], { extraFiles: { "tooling/check/advisories-ignored.json": text, ...other } })
    .filter((problem) => problem.rule === "advisories")
    .map((problem) => problem.message);
}

describe("tooling/check: advisories-ignored.json", () => {
  it("accepts an empty list and a complete entry", () => {
    expect(problems([])).toEqual([]);
    expect(problems([entry])).toEqual([]);
    expect(problems([{ ...entry, cve: undefined }])).toEqual([]);
  });

  it("reports a missing reason or one that explains nothing", () => {
    expect(problems([{ ...entry, reason: undefined }])).toEqual([
      "ignored[0].reason is missing or not a non-empty string",
    ]);
    expect(problems([{ ...entry, reason: "later" }])[0]).toContain("must explain the decision");
  });

  it("reports unknown fields, in an entry and at the top", () => {
    expect(problems([{ ...entry, expire: "2026-12-01" }])[0]).toContain(
      "ignored[0].expire is not a known field",
    );
    expect(problems([], { extra: 1 })).toEqual(['"extra" is not a known setting (known: ignored)']);
  });

  it("reports a bad advisory ID or CVE", () => {
    expect(problems([{ ...entry, ghsa: "CVE-2026-1" }])[0]).toContain("must look like GHSA-");
    expect(problems([{ ...entry, cve: "2026-1" }])[0]).toContain("must look like CVE-");
  });

  it("reports a date that isn't a real day", () => {
    for (const expires of ["soon", "2026-02-30", "2026-1-5", "2026-12-01T00:00:00Z"]) {
      expect(problems([{ ...entry, expires }])[0]).toContain(
        "must be a real day written YYYY-MM-DD",
      );
    }
  });

  it("fails once an entry has expired, but not on its last day", () => {
    expect(problems([{ ...entry, expires: "2026-11-08" }])).toEqual([]);
    expect(problems([{ ...entry, expires: "2026-11-07" }])[0]).toContain(
      "has passed, so GHSA-cfgh-2345-wxrv is no longer ignored",
    );
  });

  it("allows at most 90 days", () => {
    expect(problems([{ ...entry, expires: "2027-02-06" }])).toEqual([]);
    expect(problems([{ ...entry, expires: "2027-02-07" }])[0]).toContain(
      "is 91 days out; at most 90 days are allowed",
    );
  });

  it("reports a repeated advisory", () => {
    expect(problems([entry, { ...entry, package: "other" }])).toEqual([
      "ignored[1] repeats GHSA-cfgh-2345-wxrv",
    ]);
  });

  it("reports text that isn't the expected shape", () => {
    expect(readAdvisories("{", today).problems).toEqual(["the file isn't valid JSON"]);
    expect(readAdvisories("[]", today).problems[0]).toContain('an "ignored" list');
    expect(problems(["GHSA-cfgh-2345-wxrv"])).toEqual(["ignored[0] must be an object"]);
  });
});

describe("tooling/check: advisories rule", () => {
  it("passes for an empty list", () => {
    expect(withFile('{ "ignored": [] }')).toEqual([]);
  });

  it("passes for the real advisories-ignored.json", () => {
    const real = readFileSync(new URL("../../advisories-ignored.json", import.meta.url), "utf8");
    expect(withFile(real)).toEqual([]);
  });

  it("names the file for an expired entry", () => {
    const expired = JSON.stringify({ ignored: [{ ...entry, expires: "2020-01-01" }] });
    expect(withFile(expired)[0]).toContain("has passed");
  });

  it("fails when the file is gone", () => {
    const report = checkAdvisories({ files: [], read: () => "" } as never, today);
    expect(report.problems.map((problem) => problem.message)[0]).toContain("The file is missing");
  });

  it("rejects an ignore in pnpm-workspace.yaml, a workflow or a script", () => {
    const yaml = "auditConfig:\n  ignoreGhsas:\n    - GHSA-cfgh-2345-wxrv\n";
    const hits = (files: Record<string, string>): number =>
      withFile('{ "ignored": [] }', files).length;
    expect(
      hits({ ".github/workflows/x.yml": "run: pnpm audit --prod --ignore GHSA-cfgh-2345-wxrv\n" }),
    ).toBe(1);
    expect(hits({ "scripts/x.sh": "pnpm audit --ignore GHSA-cfgh-2345-wxrv\n" })).toBe(0);
    const workspace = readFileSync(join(realRoot, "pnpm-workspace.yaml"), "utf8");
    expect(hits({ "pnpm-workspace.yaml": `${workspace}\n${yaml}` })).toBeGreaterThan(0);
  });

  it("rejects an ignore flag in any package's package.json", () => {
    const script = '{ "scripts": { "audit": "pnpm audit --ignore GHSA-cfgh-2345-wxrv" } }\n';
    const hits = withFile('{ "ignored": [] }', { "packages/x/package.json": script });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("Advisories are ignored only in");
  });

  it("flags every advisory-ignoring audit flag but not --ignore-workspace", () => {
    const hits = (command: string): number =>
      withFile('{ "ignored": [] }', { ".github/workflows/x.yml": `run: ${command}\n` }).length;
    expect(hits("pnpm audit --ignore-registry-errors")).toBe(1);
    expect(hits("pnpm audit --ignore-unfixable")).toBe(1);
    expect(hits("pnpm audit --ignore GHSA-cfgh-2345-wxrv")).toBe(1);
    expect(hits("pnpm audit --ignore-workspace")).toBe(0);
  });
});
