/** How bad a finding is: errors fail the check, warnings are only shown. */
export type Severity = "error" | "warning";

/** One finding of a rule, pointing at a file (and a line where it helps). */
export interface Problem {
  readonly rule: string;
  readonly severity: Severity;
  readonly file: string;
  readonly line?: number;
  readonly message: string;
}

/**
 * Collects the findings of one rule, so rules don't repeat their own name.
 *
 * @example
 * const report = new Report("names");
 * report.error("package.json", "Use the @halonicjs scope.");
 */
export class Report {
  readonly rule: string;
  readonly problems: Problem[] = [];

  constructor(rule: string) {
    this.rule = rule;
  }

  /** Records a finding that fails the check. */
  error(file: string, message: string, line?: number): void {
    this.add("error", file, message, line);
  }

  /** Records a finding that is shown but does not fail the check. */
  warning(file: string, message: string, line?: number): void {
    this.add("warning", file, message, line);
  }

  private add(severity: Severity, file: string, message: string, line?: number): void {
    const problem: Problem =
      line === undefined
        ? { rule: this.rule, severity, file, message }
        : { rule: this.rule, severity, file, line, message };
    this.problems.push(problem);
  }
}

/** Formats a finding as `file:line: [rule] message`, the shape editors and CI annotate. */
export function formatProblem(problem: Problem): string {
  const location = problem.line === undefined ? problem.file : `${problem.file}:${problem.line}`;
  const label = problem.severity === "error" ? "error" : "warning";
  return `${location}: ${label} [${problem.rule}] ${problem.message}`;
}

/** Formats a finding as a GitHub Actions annotation, so it shows on the pull request diff. */
export function formatAnnotation(problem: Problem): string {
  const command = problem.severity === "error" ? "error" : "warning";
  const line = problem.line === undefined ? "" : `,line=${problem.line}`;
  const message = problem.message.replaceAll("%", "%25").replaceAll("\n", "%0A");
  return `::${command} file=${problem.file}${line},title=${problem.rule}::${message}`;
}
