import {
  type ConformanceSubject,
  describeIntegrationConformance,
  type ToolCase,
} from "@halonicjs/testing/integration";
import { readSheetData } from "@halonicjs/tooling-record/sheet-data";
import { readSources } from "@halonicjs/tooling-record/sources";
import { gmail } from "./index.ts";
import { loadRecording } from "./test/replay.ts";

/**
 * The shared conformance suite (guide, section 9), on Gmail's recordings.
 * It checks the code against the sheet, replays each case below without a
 * leaked key and with the call cancelled, and scans the sources.
 *
 * Not here: the recordings of a refused or failed call (`send-refused`,
 * `send-unavailable`, `read-message-not-found`, `search-signed-out`). The
 * suite fails any call that throws, so the tools' own tests cover them.
 */

const query = "invoice newer_than:7d";

const cases: ToolCase[] = [
  { tool: "gmail_triage", scenario: "triage-two-messages", args: { query } },
  { tool: "gmail_search", scenario: "search-two-messages", args: { query, maxResults: 2 } },
  {
    tool: "gmail_search",
    scenario: "search-next-page",
    args: { query, maxResults: 2, pageToken: "scrubbed-secret-1" },
  },
  { tool: "gmail_search", scenario: "search-no-match", args: { query } },
  { tool: "gmail_read_message", scenario: "read-message", args: { messageId: "19a0c0ffee000001" } },
  {
    tool: "gmail_read_thread",
    scenario: "read-thread-two-pages",
    args: { threadId: "19a0c0ffee000101", maxMessages: 2 },
  },
  { tool: "gmail_list_labels", scenario: "list-labels", args: {} },
  {
    tool: "gmail_get_draft",
    scenario: "get-draft-with-bcc",
    args: { draftId: "r-5550001234567890123" },
  },
  {
    tool: "gmail_modify_labels",
    scenario: "modify-labels",
    args: {
      messageIds: ["19a0c0ffee000001", "19a0c0ffee000002"],
      addLabelIds: ["Label_7"],
      removeLabelIds: ["UNREAD", "INBOX"],
    },
  },
  {
    tool: "gmail_create_draft",
    scenario: "create-draft-reply",
    args: {
      to: ["Billing Team <billing@example.com>"],
      body: "Paid today, thank you.",
      replyToMessageId: "19a0c0ffee000001",
    },
  },
  {
    tool: "gmail_send",
    scenario: "send",
    args: {
      to: ["Robin Sample <robin@example.com>"],
      subject: "halonic-test agenda",
      body: "Agenda for Thursday is below.",
    },
  },
  { tool: "gmail_send_draft", scenario: "send-draft", args: { draftId: "r-5550001234567890123" } },
];

/**
 * The recordings the cases above replay, once each. The suite checks their
 * format itself, so they go in as read.
 */
const recordings = [...new Set(cases.map((toolCase) => toolCase.scenario))].map(
  (scenario) => loadRecording(scenario) as ConformanceSubject["recordings"][number],
);

describeIntegrationConformance({
  integration: gmail,
  sheet: readSheetData(new URL("../integration.yaml", import.meta.url)),
  recordings,
  cases,
  sources: {
    ...readSources(new URL("./", import.meta.url), "tools/google/gmail/src"),
    ...readSources(new URL("../../shared/src/", import.meta.url), "tools/google/shared/src"),
  },
});
