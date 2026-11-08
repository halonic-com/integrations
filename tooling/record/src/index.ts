// The public API of the recording tools. Everything under src/scrub is free
// of repo-specific imports, so it can move into the shared kit for
// "Offer to Halonic" (I6) without a rewrite.

export { RecordingRefused } from "./scrub/context.ts";
export type {
  CapturedExchange,
  CapturedRequest,
  CapturedResponse,
  HeaderEntry,
  JsonValue,
  RecordedBody,
  RecordedExchange,
  RecordedRequest,
  RecordedResponse,
} from "./scrub/exchange.ts";
export { definePolicy, type ScrubPolicy, type ScrubPolicyInput } from "./scrub/policy.ts";
export {
  type Replacement,
  type ScrubReport,
  type ScrubRule,
  summarizeReport,
} from "./scrub/report.ts";
export { type ScrubOptions, type ScrubResult, scrubExchanges } from "./scrub/scrubber.ts";
