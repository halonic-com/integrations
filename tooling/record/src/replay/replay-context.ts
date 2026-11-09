import { RecordingRefused, type ScrubContext } from "../scrub/context.ts";
import { Fakes } from "../scrub/fakes.ts";
import { KnownSecrets } from "../scrub/known-secrets.ts";
import type { ScrubPolicy } from "../scrub/policy.ts";
import { ReportBuilder } from "../scrub/report.ts";

/**
 * The scrub context of one replay. Its URLs and bodies share it, so
 * stand-ins stay stable across its calls, as they do in a recording.
 */
export function replayContext(policy: ScrubPolicy): ScrubContext {
  return {
    policy,
    // The replay never adds a key to a request, so there is none to look for.
    knownSecrets: new KnownSecrets([]),
    fakes: new Fakes(),
    report: new ReportBuilder(),
    matchedUserContent: new Set(),
  };
}

/** Turns a refusal into a test failure that says which part of the request the recorder couldn't read. */
export function asReplayError(part: string, error: unknown): unknown {
  if (error instanceof RecordingRefused) {
    return new Error(`The ${part} can't be read the way the recorder reads it: ${error.message}`);
  }
  return error;
}
