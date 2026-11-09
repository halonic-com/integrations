import { describe, expect, it } from "vitest";
import {
  callTool,
  connectToFakeCalendar,
  connectToRecording,
  googleError,
} from "../test/replay.ts";

/** The arguments of the `create-event` recording. */
const lunch = {
  title: "Lunch with the design team",
  start: "2026-11-12T12:30:00+01:00",
  end: "2026-11-12T13:30:00+01:00",
  location: "Canteen, 2nd floor",
  description: "Talk about the new icons.",
};

describe("calendar_create_event", () => {
  it("creates a timed event without mailing anyone and returns its id, title, times and link", async () => {
    const { connection, replay } = connectToRecording("create-event");
    const result = await callTool(connection, "calendar_create_event", lunch);
    replay.assertAllUsed();
    expect(replay.sent[0]?.url).toContain("sendUpdates=none");
    expect(result).toEqual({
      event: {
        id: "lunch01",
        title: "<scrubbed:content>",
        start: "2026-11-12T12:30:00+01:00",
        end: "2026-11-12T13:30:00+01:00",
        link: "<scrubbed:content>",
      },
    });
  });

  it("creates an all-day event from two dates, in another calendar", async () => {
    const { connection, replay } = connectToRecording("create-event-all-day");
    const result = await callTool(connection, "calendar_create_event", {
      calendarId: "person1@example.com",
      title: "Trip to the coast",
      start: "2026-11-20",
      end: "2026-11-23",
    });
    replay.assertAllUsed();
    expect(replay.sent[0]?.body).toEqual({
      summary: "Trip to the coast",
      start: { date: "2026-11-20" },
      end: { date: "2026-11-23" },
    });
    expect(result).toMatchObject({ event: { id: "trip02", start: "2026-11-20" } });
  });

  it.each([
    [500, "backendError", "unavailable"],
    [429, "rateLimitExceeded", "rate-limited"],
  ])("never sends again after status %i, and maps it to %s", async (status, reason, code) => {
    const { connection, requests, waits } = connectToFakeCalendar(
      status,
      googleError(status, reason),
    );
    const call = connection.callTool("calendar_create_event", lunch);
    await expect(call).rejects.toMatchObject({ code });
    expect(requests).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it.each([
    ["end", { ...lunch, end: undefined }],
    ["end", { ...lunch, end: "2026-11-12" }],
    ["end", { ...lunch, end: "2026-11-12T12:00:00+01:00" }],
    ["end", { ...lunch, start: "2026-11-20", end: "2026-11-20" }],
    ["start", { ...lunch, start: "noon" }],
    ["title", { ...lunch, title: "" }],
    ["(arguments)", { ...lunch, attendees: ["sam@example.com"] }],
  ])("refuses a bad %s before any request", async (field, args) => {
    const { connection, requests } = connectToFakeCalendar(200, "{}");
    const call = connection.callTool("calendar_create_event", args);
    await expect(call).rejects.toMatchObject({
      code: "bad-arguments",
      message: `Check these arguments: ${field}.`,
    });
    expect(requests).toHaveLength(0);
  });
});
