import { describe, expect, it } from "vitest";
import { lockedPackageProblem, readLockedPackages, registryOverrides } from "./lockfile.ts";

const integrity = "sha512-AAAA";
const npm = "https://registry.npmjs.org/a/-/a-1.0.0.tgz";

function lockfile(packages: string): string {
  return `lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\npackages:\n\n${packages}\nsnapshots:\n\n  a@1.0.0: {}\n`;
}

function problems(packages: string): (string | undefined)[] {
  return readLockedPackages(lockfile(packages)).entries.map(lockedPackageProblem);
}

describe("lockfile check", () => {
  it("accepts packages from registry.npmjs.org with a sha512 hash", () => {
    expect(
      problems(`  a@1.0.0:\n    resolution: {integrity: ${integrity}, tarball: ${npm}}\n`),
    ).toEqual([undefined]);
  });

  it("rejects entries without a tarball URL, which a mirror registry also produces", () => {
    expect(problems(`  a@1.0.0:\n    resolution: {integrity: ${integrity}}\n`)[0]).toMatch(
      /no tarball URL/,
    );
  });

  it("reads nested fields without mistaking them for packages", () => {
    const { entries, unreadableLines } = readLockedPackages(
      lockfile(
        `  b@1.0.0:\n    resolution: {integrity: ${integrity}, tarball: ${npm}}\n    peerDependencies:\n      c: '*'\n`,
      ),
    );
    expect(entries.map((entry) => entry.key)).toEqual(["b@1.0.0"]);
    expect(unreadableLines).toEqual([]);
  });

  it("rejects tarball URLs, git and a missing hash", () => {
    const found = problems(
      [
        `  t@1.0.0:\n    resolution: {integrity: ${integrity}, tarball: https://example.com/t.tgz}\n`,
        "  g@1.0.0:\n    resolution: {type: git, repo: https://example.com/g.git, commit: abc}\n",
        `  n@1.0.0:\n    resolution: {integrity: sha1-AAAA, tarball: ${npm}}\n`,
        `  f@file:vendor/f:\n    resolution: {integrity: ${integrity}, tarball: file:vendor/f.tgz}\n`,
        "  d@file:vendor/d:\n    resolution: {directory: vendor/d, type: directory}\n",
      ].join("\n"),
    );
    expect(found.every((problem) => problem !== undefined)).toBe(true);
  });

  it("accepts the Node runtime only from the Node.js release hosts", () => {
    const runtime = (url: string): string =>
      [
        "  node@runtime:26.13.0:",
        "    resolution:",
        "      type: variations",
        "      variants:",
        "        - resolution:",
        "            integrity: sha256-AAAA",
        "            type: binary",
        `            url: ${url}`,
        "",
      ].join("\n");
    expect(problems(runtime("https://nodejs.org/download/release/v26.13.0/node.tar.gz"))).toEqual([
      undefined,
    ]);
    expect(problems(runtime("https://example.com/v26.13.0/node.tar.gz"))[0]).toMatch(
      /somewhere other than/,
    );
  });

  it("reports lines it can't read, such as an entry in flow style", () => {
    const { entries, unreadableLines } = readLockedPackages(
      lockfile(
        "  'x@1.0.0': {resolution: {integrity: sha512-AAAA, tarball: https://example.com/x.tgz}}\n",
      ),
    );
    expect(entries).toEqual([]);
    expect(unreadableLines).toEqual([9]);
  });

  it("finds committed settings that point at another registry", () => {
    const yaml =
      'registries:\n  "@halonicjs": https://registry.npmjs.org/\n  "@x": https://mirror.example/\n';
    expect(registryOverrides(yaml, "registry=https://registry.npmjs.org\n")).toEqual([
      { file: "pnpm-workspace.yaml", url: "https://mirror.example/" },
    ]);
    expect(registryOverrides("", "@x:registry=https://mirror.example/\n")).toEqual([
      { file: ".npmrc", url: "https://mirror.example/" },
    ]);
  });

  it("lets only pnpm itself go without a tarball URL, in the part that pins pnpm", () => {
    const text = (name: string): string =>
      `---\nlockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    packageManagerDependencies:\n      pnpm: {}\n\npackages:\n\n  ${name}@12.18.0:\n    resolution: {integrity: ${integrity}}\n\n---\n${lockfile(`  a@1.0.0:\n    resolution: {integrity: ${integrity}}\n`)}`;
    expect(readLockedPackages(text("pnpm")).entries.map(lockedPackageProblem)).toEqual([
      undefined,
      expect.stringMatching(/no tarball URL/),
    ]);
    expect(readLockedPackages(text("left-pad")).entries.map(lockedPackageProblem)[0]).toMatch(
      /may hold only pnpm/,
    );
  });
});
