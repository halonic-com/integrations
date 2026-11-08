/**
 * The short account of what the scrubber replaced. It names rules and places,
 * never values: the report is printed and may be pasted into a pull request.
 */

export type ScrubRule =
  | "secret-header"
  | "secret-field"
  | "url-userinfo"
  | "known-secret"
  | "token-shape"
  | "random-token"
  | "email"
  | "phone"
  | "user-content";

export interface Replacement {
  readonly rule: ScrubRule;
  /** Where in the exchange, such as `response.body.messages[0].snippet`. */
  readonly where: string;
}

export interface ScrubReport {
  readonly replacements: readonly Replacement[];
  /**
   * User-content paths the integration declared that matched nothing in the
   * whole recording. Usually a typo in the path, so the recorder shows them:
   * a typo here means content would be saved that was meant to be removed.
   */
  readonly unmatchedUserContent: readonly string[];
}

const RULE_LABELS: Record<ScrubRule, string> = {
  "secret-header": "secret headers",
  "secret-field": "secret fields",
  "url-userinfo": "URL user names or passwords",
  "known-secret": "known keys",
  "token-shape": "token-shaped values",
  "random-token": "random-looking values",
  email: "e-mail addresses",
  phone: "phone numbers",
  "user-content": "user-content fields",
};

/** Collects replacements while one recording is scrubbed. */
export class ReportBuilder {
  private readonly replacements: Replacement[] = [];

  add(rule: ScrubRule, where: string): void {
    this.replacements.push({ rule, where });
  }

  build(unmatchedUserContent: readonly string[]): ScrubReport {
    return { replacements: [...this.replacements], unmatchedUserContent };
  }
}

/**
 * One line per rule, for the terminal.
 *
 * @example
 * summarizeReport(report) // ["2 secret headers", "1 e-mail addresses"]
 */
export function summarizeReport(report: ScrubReport): string[] {
  const counts = new Map<ScrubRule, number>();
  for (const { rule } of report.replacements) {
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }
  return [...counts].map(([rule, count]) => `${count} ${RULE_LABELS[rule]}`);
}
