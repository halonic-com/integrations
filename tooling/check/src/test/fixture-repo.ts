import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadContext } from "../lib/context.ts";
import type { Problem } from "../lib/problems.ts";
import { rules } from "../rules/all.ts";

const realRoot = join(import.meta.dirname, "..", "..", "..", "..");

/** A small package for a fixture repo. */
export interface FixturePackage {
  readonly directory: string;
  readonly manifest?: Record<string, unknown>;
  readonly files?: Readonly<Record<string, string>>;
}

/** A valid package.json for a folder, which tests then break on purpose. */
export function manifestFor(
  name: string,
  layer: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts" },
    halonic: { layer, owner: "ravi" },
    ...extra,
  };
}

/**
 * Builds a throwaway git repo with the real workspace globs and check
 * policy, runs every rule on it and returns the errors.
 */
export function runChecks(
  packages: readonly FixturePackage[],
  options: { extraFiles?: Record<string, string> } = {},
): Problem[] {
  const root = mkdtempSync(join(tmpdir(), "halonic-check-"));
  try {
    const write = (path: string, text: string): void => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    write("pnpm-workspace.yaml", readFileSync(join(realRoot, "pnpm-workspace.yaml"), "utf8"));
    write(
      "pnpm-lock.yaml",
      "lockfileVersion: '9.0'\n\npackages:\n\n  a@1.0.0:\n    resolution: {integrity: sha512-AAAA, tarball: https://registry.npmjs.org/a/-/a-1.0.0.tgz}\n",
    );
    write(
      "tooling/check/policy.json",
      readFileSync(join(realRoot, "tooling/check/policy.json"), "utf8"),
    );
    write(
      "tooling/check/dependencies.json",
      readFileSync(join(realRoot, "tooling/check/dependencies.json"), "utf8"),
    );
    write(
      "package.json",
      JSON.stringify(manifestFor("@halonicjs/root", "tooling", { exports: undefined })),
    );
    for (const pkg of packages) {
      write(`${pkg.directory}/package.json`, JSON.stringify(pkg.manifest ?? {}));
      for (const [file, text] of Object.entries(
        pkg.files ?? { "src/index.ts": "export const x = 1;\n" },
      )) {
        write(`${pkg.directory}/${file}`, text);
      }
    }
    for (const [file, text] of Object.entries(options.extraFiles ?? {})) {
      write(file, text);
    }
    execFileSync("git", ["init", "-q"], { cwd: root });
    const context = loadContext(root);
    return Object.values(rules)
      .flatMap((rule) => rule(context).problems)
      .filter((problem) => problem.severity === "error");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** An empty integration, which tests then change. */
export function integration(
  name: string,
  extra: Record<string, unknown> = {},
  files?: Record<string, string>,
): FixturePackage {
  return {
    directory: `integrations/${name}`,
    manifest: manifestFor(`@halonicjs/integration-${name}`, "integrations", extra),
    ...(files === undefined ? {} : { files }),
  };
}

/**
 * An empty integration in a group folder, such as `tools/google/gmail`.
 * The test gives the name, so it checks the naming rule instead of copying it.
 */
export function groupedIntegration(folders: string, name: string): FixturePackage {
  return {
    directory: `integrations/${folders}`,
    manifest: manifestFor(`@halonicjs/integration-${name}`, "integrations"),
  };
}

/** An empty tooling package. */
export function tool(name: string, extra: Record<string, unknown> = {}): FixturePackage {
  return {
    directory: `tooling/${name}`,
    manifest: manifestFor(`@halonicjs/tooling-${name}`, "tooling", extra),
  };
}

/** The names of the rules that report an error for these packages. */
export function rulesHit(
  packages: FixturePackage[],
  options?: Parameters<typeof runChecks>[1],
): string[] {
  return [...new Set(runChecks(packages, options).map((problem) => problem.rule))].sort();
}
