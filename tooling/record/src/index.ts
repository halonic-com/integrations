// The public API of the recording tools. Everything under src/scrub is free
// of repo-specific imports, so it can move into the shared kit for
// "Offer to Halonic" (I6) without a rewrite.

export { RecordingRefused } from "./scrub/context.ts";
export { definePolicy, type ScrubPolicy, type ScrubPolicyInput } from "./scrub/policy.ts";
export {
  type Replacement,
  type ReportEntry,
  reportEntries,
  type ScrubReport,
  type ScrubRule,
  summarizeReport,
} from "./scrub/report.ts";
