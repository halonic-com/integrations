import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { describe, expect, it } from "vitest";
import {
  callTool,
  connectToFakeCalendar,
  connectToRecording,
  googleError,
} from "../test/replay.ts";

/** What the recorder left of the text searched for. A replay must send the same. */
const recordedText = "<scrubbed:content>";

describe("calendar_list_events", () => {
  it("lists a time range's events, timed and all-day, earliest first", async () => {
    const { connection, replay } = connectToRecording("list-events");
    const result = await callTool(connection, "calendar_list_events", {
      timeMin: "2026-11-10T00:00:00+01:00",
      timeMax: "2026-11-13T00:00:00+01:00",
    });
    replay.assertAllUsed();
    expect(result).toEqual({
      events: [
        {
          id: "standup_1110",
          title: "<scrubbed:content>",
          start: "2026-11-10T09:00:00+01:00",
          end: "2026-11-10T09:15:00+01:00",
          allDay: false,
          location: "<scrubbed:content>",
          status: "confirmed",
          type: "default",
        },
        {
          id: "dayoff",
          title: "<scrubbed:content>",
          start: "2026-11-11",
          end: "2026-11-12",
          allDay: true,
          status: "confirmed",
          type: "outOfOffice",
        },
      ],
    });
  });

  it("searches another calendar and hands back the next page's token", async () => {
    const { connection, replay } = connectToRecording("list-events-search-next-page");
    const result = await callTool(connection, "calendar_list_events", {
      calendarId: "person1@example.com",
      timeMin: "2026-11-01T00:00:00Z",
      text: recordedText,
      maxResults: 1,
    });
    replay.assertAllUsed();
    expect(result).toMatchObject({
      events: [{ id: "standup_1110" }],
      nextPageToken: "scrubbed-secret-1",
    });
  });

  it("returns no events, and no page token, when nothing matches", async () => {
    const { connection, replay } = connectToRecording("list-events-no-match");
    const result = await callTool(connection, "calendar_list_events", {
      timeMin: "2026-11-10T00:00:00+01:00",
      text: recordedText,
    });
    replay.assertAllUsed();
    expect(result).toEqual({ events: [] });
  });

  it("turns a refused sign-in into not-signed-in without Google's own text", async () => {
    const { connection, replay } = connectToRecording("list-events-signed-out");
    const call = connection.callTool("calendar_list_events", {
      timeMin: "2026-11-10T00:00:00+01:00",
    });
    await expect(call).rejects.toBeInstanceOf(GoogleError);
    await expect(call).rejects.toMatchObject({ code: "not-signed-in" });
    replay.assertAllUsed();
  });

  it("keeps the search text out of the error when the calendar is missing", async () => {
    const { connection } = connectToFakeCalendar(404, googleError(404, "notFound"));
    const call = connection.callTool("calendar_list_events", {
      calendarId: "gone@example.com",
      timeMin: "2026-11-10T00:00:00Z",
      text: "dentist appointment",
    });
    await expect(call).rejects.toMatchObject({ code: "not-found" });
    await expect(call).rejects.not.toThrow(/dentist|Dentist/);
  });

  it.each([
    ["timeMin", { timeMin: "2026-11-10T09:00:00" }],
    ["timeMin", { timeMin: "2026-11-10" }],
    ["timeMin", {}],
    ["timeMax", { timeMin: "2026-11-10T00:00:00Z", timeMax: "tomorrow" }],
    ["calendarId", { timeMin: "2026-11-10T00:00:00Z", calendarId: "a/b" }],
    ["maxResults", { timeMin: "2026-11-10T00:00:00Z", maxResults: 101 }],
  ])("refuses a bad %s before any request", async (field, args) => {
    const { connection, requests } = connectToFakeCalendar(200, "{}");
    const call = connection.callTool("calendar_list_events", args);
    await expect(call).rejects.toMatchObject({
      code: "bad-arguments",
      message: `Check these arguments: ${field}.`,
    });
    expect(requests).toHaveLength(0);
  });

  it("refuses a calendar id that would change the path, before any request", async () => {
    const { connection, requests } = connectToFakeCalendar(200, "{}");
    const call = connection.callTool("calendar_list_events", {
      calendarId: "..",
      timeMin: "2026-11-10T00:00:00Z",
    });
    await expect(call).rejects.toMatchObject({ code: "bad-arguments" });
    expect(requests).toHaveLength(0);
  });
});
