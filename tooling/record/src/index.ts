// The public API of the recording tools. Everything under src/scrub is free
// of repo-specific imports, so it can move into the shared kit for
// "Offer to Halonic" (I6) without a rewrite.

export {
  formatRecording,
  RECORDING_FORMAT,
  type RecordingFile,
  recordingFileSchema,
} from "./format.ts";
export {
  type PreparedRecording,
  prepareRecording,
  type RecordingInput,
} from "./recording/prepare-recording.ts";
export {
  createRecordingTransport,
  type HttpTransport,
  type RecordingTransport,
} from "./recording/recording-transport.ts";
export {
  findLeaks,
  type Leak,
  type LeakKind,
  type TextLeakKind,
} from "./safety-net/find-leaks.ts";
export { RecordingRefused } from "./scrub/context.ts";
export type {
  CapturedExchange,
  CapturedRequest,
  CapturedResponse,
  HeaderEntry,
  JsonValue,
  RecordedBody,
  RecordedExchange,
  RecordedHeaders,
  RecordedRequest,
  RecordedResponse,
  StreamEvent,
} from "./scrub/exchange.ts";
export { definePolicy, type ScrubPolicy, type ScrubPolicyInput } from "./scrub/policy.ts";
export {
  type Replacement,
  type ReportEntry,
  reportEntries,
  type ScrubReport,
  type ScrubRule,
  summarizeReport,
} from "./scrub/report.ts";
export { type ScrubOptions, type ScrubResult, scrubExchanges } from "./scrub/scrubber.ts";
