import ts from "@typescript/typescript6";
import type { CheckContext } from "../lib/context.ts";
import { Report } from "../lib/problems.ts";
import { isSourceFile } from "../lib/source-files.ts";
import { owningPackage } from "../lib/workspace.ts";
import { isDevFile } from "./layers.ts";

const why =
  "Integration library code also runs in the cloud runtime, so it gets no Node or DOM types (plan 15.2).";

/**
 * Keeps Node and DOM types out of integration library code. Integrations
 * list `@types/node` for their tests, so a `/// <reference>` line in `src`
 * would load Node's types again and let `process` through `tsc -p .`.
 * The main tsconfig itself is the `tsconfig` rule's job.
 */
export function checkIntegrationTypes(context: CheckContext): Report {
  const report = new Report("integration-types");
  const integrations = context.packages.filter(
    (pkg) => context.placeOf(pkg)?.layer === "integrations",
  );
  for (const file of context.files) {
    if (isLibraryFile(file) && owningPackage(file, integrations) !== undefined) {
      checkReferenceDirectives(file, context.read(file), report);
    }
  }
  return report;
}

function isLibraryFile(file: string): boolean {
  return isSourceFile(file) && !isDevFile(file);
}

/**
 * Finds `/// <reference types>`, `lib` and `path` lines. Each of them can
 * load Node's types into one file and the whole program around it.
 */
function checkReferenceDirectives(file: string, text: string, report: Report): void {
  const found = ts.preProcessFile(text, false, false);
  const lineOf = (position: number): number => text.slice(0, position).split("\n").length;
  const directives = [
    ...found.typeReferenceDirectives.map((reference) => ({ kind: "types", reference })),
    ...found.libReferenceDirectives.map((reference) => ({ kind: "lib", reference })),
    ...found.referencedFiles.map((reference) => ({ kind: "path", reference })),
  ];
  for (const { kind, reference } of directives) {
    report.error(
      file,
      `has /// <reference ${kind}="${reference.fileName}" />. Library code may not load extra types; only tests and config files may. ${why}`,
      lineOf(reference.pos),
    );
  }
}
