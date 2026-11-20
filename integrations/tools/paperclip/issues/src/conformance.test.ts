import {
  type ConformanceSubject,
  describeIntegrationConformance,
  type ToolCase,
} from "@halonicjs/testing/integration";
import { readRecording } from "@halonicjs/tooling-record/recordings";
import { readSheetData } from "@halonicjs/tooling-record/sheet-data";
import { readSources } from "@halonicjs/tooling-record/sources";
import { paperclipIssues } from "./index.ts";
import { settings } from "./test/replay.ts";

/**
 * The shared conformance suite (guide, section 9), on the invented
 * recordings (README, "Recordings"). It checks the code against the sheet,
 * replays each case below without a leaked key and with the call
 * cancelled, and scans the sources.
 *
 * Not here: the recordings of a failed call (`list-issues-signed-out`,
 * `list-comments-not-found`, `get-document-not-found`), since the suite
 * fails any call that throws, and `list-comments-two-pages`, whose two
 * calls the suite can't make as one case. The tools' own tests replay them.
 */

const cases: ToolCase[] = [
  {
    tool: "issues_list",
    scenario: "list-issues-next-page",
    args: { status: "todo,in_progress,blocked", maxResults: 2 },
  },
  { tool: "issues_get", scenario: "get-issue", args: { issue: "HAL-12" } },
  { tool: "issues_list_comments", scenario: "list-comments", args: { issue: "HAL-12" } },
  {
    tool: "issues_get_document",
    scenario: "get-document",
    args: { issue: "HAL-12", key: "notes" },
  },
  { tool: "issues_list_inbox", scenario: "list-inbox", args: {} },
];

/**
 * The recordings the cases above replay, once each. The suite checks their
 * format itself, so they go in as read.
 */
const recordingsFolder = new URL("../recordings/", import.meta.url);
const recordings = [...new Set(cases.map((toolCase) => toolCase.scenario))].map(
  (scenario) =>
    readRecording(recordingsFolder, scenario) as ConformanceSubject["recordings"][number],
);

describeIntegrationConformance({
  integration: paperclipIssues,
  sheet: readSheetData(new URL("../integration.yaml", import.meta.url)),
  recordings,
  cases,
  settings,
  sources: readSources(new URL("./", import.meta.url), "tools/paperclip/issues/src"),
});
