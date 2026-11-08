import { type Fakes, SECRET } from "./fakes.ts";
import type { KnownSecrets } from "./known-secrets.ts";
import type { ScrubPolicy } from "./policy.ts";
import type { ReportBuilder } from "./report.ts";

/** Everything the rules share while one recording is scrubbed. */
export interface ScrubContext {
  readonly policy: ScrubPolicy;
  readonly knownSecrets: KnownSecrets;
  readonly fakes: Fakes;
  readonly report: ReportBuilder;
  /** The declared user-content paths that matched something so far. */
  readonly matchedUserContent: Set<string>;
}

/** Thrown when something can't be scrubbed safely. Nothing gets saved. */
export class RecordingRefused extends Error {
  /** Where in the recording, such as `exchanges[2].response.body`. */
  readonly where: string;

  /** The message names the place and the reason, never a value. */
  constructor(where: string, reason: string) {
    super(`${where}: ${reason}`);
    this.name = "RecordingRefused";
    this.where = where;
  }
}

/**
 * The stand-in for a value in a secret field: the fixed `SECRET` when it is
 * one of the integration's own keys (the suite puts its fake key back
 * there), otherwise a numbered stand-in that stays the same within the
 * recording.
 */
export function secretStandIn(value: string, context: ScrubContext): string {
  return context.knownSecrets.isWhole(value) ? SECRET : context.fakes.secret(value);
}
