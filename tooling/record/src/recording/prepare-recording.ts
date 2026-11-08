import {
  formatRecording,
  RECORDING_FORMAT,
  type RecordingFile,
  recordingFileSchema,
} from "../format.ts";
import { findLeaks, type Leak } from "../safety-net.ts";
import { RecordingRefused } from "../scrub/context.ts";
import type { CapturedExchange } from "../scrub/exchange.ts";
import type { ScrubPolicy } from "../scrub/policy.ts";
import { reportEntries, type ScrubReport } from "../scrub/report.ts";
import { scrubExchanges } from "../scrub/scrubber.ts";

export interface RecordingInput {
  readonly integration: string;
  readonly scenario: string;
  readonly exchanges: readonly CapturedExchange[];
  readonly policy: ScrubPolicy;
  /** The key values the kit added during the recording (fake keys in tests). */
  readonly knownSecrets: readonly string[];
}

export type PreparedRecording =
  | { readonly ok: true; readonly text: string; readonly report: ScrubReport }
  | {
      readonly ok: false;
      readonly reason: "refused";
      readonly where: string;
      readonly message: string;
    }
  | { readonly ok: false; readonly reason: "leak"; readonly leaks: readonly Leak[] };

/**
 * Turns captured traffic into the exact text of a recording file, or says
 * why it must not be saved. Pure: the caller writes `text` only when `ok`.
 *
 * Three checks, in order: the scrubber's rules; the file must match the
 * recording format; and the safety net over the finished text, report
 * included. If the safety net finds anything, a rule missed it; the
 * recording is refused rather than saved with a leak.
 *
 * @param scrub - only for tests, to show the safety net catches what a broken rule lets through
 */
export function prepareRecording(
  input: RecordingInput,
  scrub: typeof scrubExchanges = scrubExchanges,
): PreparedRecording {
  let scrubbed: ReturnType<typeof scrubExchanges>;
  try {
    scrubbed = scrub(input.exchanges, { policy: input.policy, knownSecrets: input.knownSecrets });
  } catch (error) {
    if (error instanceof RecordingRefused) {
      return { ok: false, reason: "refused", where: error.where, message: error.message };
    }
    throw error;
  }

  const file: RecordingFile = {
    format: RECORDING_FORMAT,
    integration: input.integration,
    scenario: input.scenario,
    exchanges: scrubbed.exchanges,
    scrubReport: reportEntries(scrubbed.report),
  };
  const checked = recordingFileSchema.safeParse(file);
  if (!checked.success) {
    // Only the place is named: a Zod message could quote the value.
    const where = checked.error.issues[0]?.path.join(".") ?? "";
    return {
      ok: false,
      reason: "refused",
      where,
      message: "the file doesn't match the recording format",
    };
  }
  const text = formatRecording(checked.data);

  const leaks = findLeaks(text, input.knownSecrets);
  if (leaks.length > 0) {
    return { ok: false, reason: "leak", leaks };
  }
  return { ok: true, text, report: scrubbed.report };
}
