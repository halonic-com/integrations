import {
  type ConformanceSubject,
  describeIntegrationConformance,
  type ToolCase,
} from "@halonicjs/testing/integration";
import { readRecording } from "@halonicjs/tooling-record/recordings";
import { readSheetData } from "@halonicjs/tooling-record/sheet-data";
import { readSources } from "@halonicjs/tooling-record/sources";
import { drive } from "./index.ts";

/**
 * The shared conformance suite (guide, section 9), on Drive's recordings.
 * It checks the code against the sheet, replays each case below without a
 * leaked key and with the call cancelled, and scans the sources.
 *
 * Not here: the recordings of a refused or failed call
 * (`create-file-folder-not-found`, `get-file-not-found`,
 * `move-file-not-allowed`, `read-doc-too-large`, `search-signed-out`). The
 * suite fails any call that throws, so the tools' own tests cover them.
 */

const projects = "folder-projects-01";
const notes = "file-notes-02";

const cases: ToolCase[] = [
  { tool: "drive_tree", scenario: "tree-two-levels", args: { folderId: projects, depth: 2 } },
  {
    tool: "drive_tree",
    scenario: "tree-stops-at-max-items",
    args: { folderId: projects, maxItems: 2 },
  },
  {
    tool: "drive_tree",
    scenario: "tree-folders-only",
    args: { folderId: "root", depth: 1, foldersOnly: true },
  },
  {
    tool: "drive_search",
    scenario: "search-text-two-files",
    args: { text: "halonic-test", pageSize: 2 },
  },
  {
    tool: "drive_search",
    scenario: "search-folder-next-page",
    args: { folderId: projects, pageSize: 2, pageToken: "scrubbed-secret-1" },
  },
  {
    tool: "drive_search",
    scenario: "search-no-match",
    args: { query: "name = 'halonic-test nothing'" },
  },
  { tool: "drive_get_file", scenario: "get-file", args: { fileId: notes } },
  { tool: "drive_read_file", scenario: "read-doc-markdown", args: { fileId: "file-plan-01" } },
  { tool: "drive_read_file", scenario: "read-doc-plain-text", args: { fileId: "file-plan-01" } },
  {
    tool: "drive_read_file",
    scenario: "read-text-file-in-parts",
    args: { fileId: notes, maxChars: 40 },
  },
  { tool: "drive_read_file", scenario: "read-binary-file", args: { fileId: "file-scan-05" } },
  {
    tool: "drive_create_file",
    scenario: "create-file",
    args: {
      name: "Launch plan",
      content: "# Launch plan\n\n- Pick a date\n- Book the room",
      mimeType: "text/markdown",
      folderId: projects,
      convertTo: "document",
    },
  },
  {
    tool: "drive_update_file",
    scenario: "update-file",
    args: { fileId: notes, content: "Notes for the next meeting:\nBring the plan." },
  },
  {
    tool: "drive_create_folder",
    scenario: "create-folder",
    args: { name: "Drafts", parentId: projects },
  },
  {
    tool: "drive_move_file",
    scenario: "move-file",
    args: { fileId: notes, toFolderId: "folder-archive-08", newName: "Old team notes" },
  },
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
  integration: drive,
  sheet: readSheetData(new URL("../integration.yaml", import.meta.url)),
  recordings,
  cases,
  // In-repo packages the build bundles into this integration.
  bundled: ["@halonicjs/integration-tool-google-shared"],
  sources: {
    ...readSources(new URL("./", import.meta.url), "tools/google/drive/src"),
    ...readSources(new URL("../../shared/src/", import.meta.url), "tools/google/shared/src"),
  },
});
