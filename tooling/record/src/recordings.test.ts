import { describe, expect, it } from "vitest";
import { recordingFileSchema } from "./format.ts";
import { readRecording } from "./recordings.ts";

const calendarRecordings = new URL(
  "../../../integrations/tools/google/calendar/recordings/",
  import.meta.url,
);

describe("readRecording", () => {
  it("reads a real recording by its scenario name", () => {
    const recording = recordingFileSchema.parse(readRecording(calendarRecordings, "delete-event"));

    expect(recording.exchanges[0]?.request).toMatchObject({
      method: "DELETE",
      url: expect.stringContaining("/events/lunch01"),
    });
  });

  it("fails for a scenario that has no recording", () => {
    expect(() => readRecording(calendarRecordings, "no-such-scenario")).toThrow(/ENOENT/);
  });
});
