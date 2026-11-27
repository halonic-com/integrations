import {
  type ConformanceSubject,
  describeIntegrationConformance,
  type ToolCase,
} from "@halonicjs/testing/integration";
import { readRecording } from "@halonicjs/tooling-record/recordings";
import { readSheetData } from "@halonicjs/tooling-record/sheet-data";
import { readSources } from "@halonicjs/tooling-record/sources";
import { calendar } from "./index.ts";

/**
 * The shared conformance suite (guide, section 9), on Calendar's
 * recordings. It checks the code against the sheet, replays each case below
 * without a leaked key and with the call cancelled, and scans the sources.
 *
 * Not here:
 * - the recordings of a refused or failed call (`get-event-not-found`,
 *   `update-event-not-allowed`, `list-events-signed-out`). The suite fails
 *   any call that throws, so the tools' own tests cover them.
 * - `list-calendars-two-pages`, which holds two calls; a case makes one.
 */

/** Any text: the recordings hold `q` as a placeholder, and the replay scrubs it the same way. */
const text = "dentist";

const cases: ToolCase[] = [
  { tool: "calendar_list_calendars", scenario: "list-calendars", args: {} },
  {
    tool: "calendar_list_events",
    scenario: "list-events",
    args: { timeMin: "2026-11-10T00:00:00+01:00", timeMax: "2026-11-13T00:00:00+01:00" },
  },
  {
    tool: "calendar_list_events",
    scenario: "list-events-search-next-page",
    args: {
      calendarId: "person1@example.com",
      timeMin: "2026-11-01T00:00:00Z",
      text,
      maxResults: 1,
    },
  },
  {
    tool: "calendar_list_events",
    scenario: "list-events-no-match",
    args: { timeMin: "2026-11-10T00:00:00+01:00", text },
  },
  { tool: "calendar_get_event", scenario: "get-event", args: { eventId: "standup_1110" } },
  {
    tool: "calendar_create_event",
    scenario: "create-event",
    args: {
      title: "Lunch with the design team",
      start: "2026-11-12T12:30:00+01:00",
      end: "2026-11-12T13:30:00+01:00",
      location: "Canteen, 2nd floor",
      description: "Talk about the new icons.",
    },
  },
  {
    tool: "calendar_create_event",
    scenario: "create-event-all-day",
    args: {
      calendarId: "person1@example.com",
      title: "Trip to the coast",
      start: "2026-11-20",
      end: "2026-11-23",
    },
  },
  {
    tool: "calendar_update_event",
    scenario: "update-event",
    args: {
      eventId: "lunch01",
      title: "Lunch with the design team (moved)",
      start: "2026-11-12T13:00:00+01:00",
      end: "2026-11-12T14:00:00+01:00",
      location: "",
    },
  },
  { tool: "calendar_delete_event", scenario: "delete-event", args: { eventId: "lunch01" } },
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
  integration: calendar,
  sheet: readSheetData(new URL("../integration.yaml", import.meta.url)),
  recordings,
  cases,
  // In-repo packages the build bundles into this integration.
  bundled: ["@halonicjs/integration-tool-google-shared"],
  sources: {
    ...readSources(new URL("./", import.meta.url), "tools/google/calendar/src"),
    ...readSources(new URL("../../shared/src/", import.meta.url), "tools/google/shared/src"),
  },
});
