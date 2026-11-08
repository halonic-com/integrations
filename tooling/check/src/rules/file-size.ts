import type { CheckContext } from "../lib/context.ts";
import { Report } from "../lib/problems.ts";
import { isSourceFile, isTestFile } from "../lib/source-files.ts";

const measured = /\.(?:[cm]?[jt]sx?|css|rs|astro)$/;

/** Generated files and test fixtures are exempt (plan 6.3). */
export function isExemptFromSize(file: string): boolean {
  return (
    /(?:^|\/)(?:generated|fixtures|__fixtures__|golden)\//.test(file) ||
    /\.generated\.[a-z]+$/.test(file)
  );
}

/**
 * Keeps files and functions small, so agents can read a whole file and two
 * agents rarely edit the same one (plan 6.3).
 */
export function checkFileSize(context: CheckContext): Report {
  const report = new Report("file-size");
  const { warnLines, maxLines, warnFunctionLines } = context.policy.fileSize;
  for (const file of context.files) {
    if (!measured.test(file) || isExemptFromSize(file)) {
      continue;
    }
    const text = context.read(file);
    const lines = text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
    if (lines > maxLines) {
      report.error(
        file,
        `${lines} lines; the limit is ${maxLines}. Split it by concept: one file per view, service or helper, named after what it holds (plan 6.3).`,
      );
    } else if (lines > warnLines) {
      report.warning(
        file,
        `${lines} lines; consider splitting above ${warnLines} (the hard limit is ${maxLines}).`,
      );
    }
    // describe() blocks make test functions long by nature.
    if (!isSourceFile(file) || isTestFile(file)) {
      continue;
    }
    for (const span of context.sourceFacts(file).functions) {
      if (span.lineCount > warnFunctionLines) {
        report.warning(
          file,
          `function ${span.name} has ${span.lineCount} lines; consider splitting above ${warnFunctionLines}.`,
          span.line,
        );
      }
    }
  }
  return report;
}
