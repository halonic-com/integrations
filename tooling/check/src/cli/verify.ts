import { spawnSync } from "node:child_process";
import { findRepoRoot } from "../lib/workspace.ts";

/**
 * pnpm verify
 *
 * The agent's local check before asking for review (plan 6.4): our own
 * checks, formatting, then typecheck, lint and test for the packages the
 * change affects. CI runs every task through the cache.
 * Pass --full to run every package, as CI does.
 */
interface Step {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
}

function main(argv: readonly string[]): number {
  const full = argv.includes("--full");
  const turboScope = full ? [] : ["--affected"];
  const steps: Step[] = [
    { label: "repo checks", command: "pnpm", args: ["run", "--silent", "check"] },
    { label: "personal-terms guard", command: "pnpm", args: ["run", "--silent", "check:terms"] },
    { label: "licences", command: "pnpm", args: ["run", "--silent", "check:licences"] },
    {
      label: "formatting",
      command: "pnpm",
      args: ["exec", "biome", "ci", "--linter-enabled=false", "."],
    },
    {
      label: "typecheck, lint, test, build",
      command: "pnpm",
      args: [
        "exec",
        "turbo",
        "run",
        "typecheck",
        "lint",
        "test",
        "build",
        ...turboScope,
        "--output-logs=errors-only",
      ],
    },
  ];
  const root = findRepoRoot();
  const started = performance.now();
  for (const step of steps) {
    console.log(`\n▶ ${step.label}`);
    const result = spawnSync(step.command, step.args, { cwd: root, stdio: "inherit" });
    if (result.status !== 0) {
      console.error(`\n✗ verify failed at: ${step.label}. Fix it and run pnpm verify again.`);
      return result.status ?? 1;
    }
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`\n✓ verify passed in ${seconds}s.`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
