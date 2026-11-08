/**
 * Public entry point of tooling/check: the rules, so tests and other tools
 * can run them. The command lines live in `cli/`.
 */
export { type CheckContext, loadContext } from "./lib/context.ts";
export { folderNamePattern, placeOf } from "./lib/layout.ts";
export { formatProblem, type Problem, Report } from "./lib/problems.ts";
export { findRepoRoot, listWorkspacePackages, readJson } from "./lib/workspace.ts";
export { rules } from "./rules/all.ts";
