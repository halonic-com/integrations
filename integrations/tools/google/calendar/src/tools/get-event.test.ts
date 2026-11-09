import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { describe, expect, it } from "vitest";
import {
  callTool,
  connectToFakeCalendar,
  connectToRecording,
  googleError,
} from "../test/replay.ts";

describe("calendar_get_event", () => {
  it("returns the event with its description, organizer, guests and series", async () => {
    const { connection, replay } = connectToRecording("get-event");
    const result = await callTool(connection, "calendar_get_event", { eventId: "standup_1110" });
    replay.assertAllUsed();
    const scrubbed = "<scrubbed:content>";
    expect(result).toEqual({
      event: {
        id: "standup_1110",
        title: scrubbed,
        start: "2026-11-10T09:00:00+01:00",
        end: "2026-11-10T09:15:00+01:00",
        allDay: false,
        location: scrubbed,
        status: "confirmed",
        type: "default",
        description: scrubbed,
        organizer: { address: scrubbed, name: scrubbed },
        guests: [
          { address: scrubbed, answer: "accepted" },
          { address: scrubbed, name: scrubbed, answer: "accepted" },
          { address: scrubbed, answer: "needsAction", optional: true },
        ],
        link: scrubbed,
        seriesId: "standup",
      },
    });
  });

  it("turns a missing event into not-found without Google's own text", async () => {
    const { connection, replay } = connectToRecording("get-event-not-found");
    const call = connection.callTool("calendar_get_event", { eventId: "missing" });
    await expect(call).rejects.toBeInstanceOf(GoogleError);
    await expect(call).rejects.toMatchObject({ code: "not-found" });
    replay.assertAllUsed();
  });

  it.each([
    [400, "badRequest", "bad-arguments"],
    [403, "forbiddenForNonOrganizer", "not-allowed"],
    [403, "rateLimitExceeded", "rate-limited"],
    [403, "quotaExceeded", "quota-exceeded"],
    [404, "notFound", "not-found"],
  ])(
    "maps status %i with reason %s to %s at once, without Google's text",
    async (status, reason, code) => {
      const { connection, requests } = connectToFakeCalendar(status, googleError(status, reason));
      const call = connection.callTool("calendar_get_event", { eventId: "standup_1110" });
      await expect(call).rejects.toMatchObject({ code });
      await expect(call).rejects.not.toThrow(/Dentist/);
      expect(requests).toHaveLength(1);
    },
  );

  it.each([
    [429, "rateLimitExceeded", "rate-limited"],
    [503, "backendError", "unavailable"],
  ])("reads again twice after status %i, then maps %s to %s", async (status, reason, code) => {
    const { connection, requests, waits } = connectToFakeCalendar(
      status,
      googleError(status, reason),
    );
    const call = connection.callTool("calendar_get_event", { eventId: "standup_1110" });
    await expect(call).rejects.toMatchObject({ code });
    expect(requests).toHaveLength(3);
    expect(waits).toEqual([1_000, 2_000]);
  });

  it("calls a body that isn't JSON an unexpected response", async () => {
    const { connection } = connectToFakeCalendar(200, "<html>Sign in</html>");
    const call = connection.callTool("calendar_get_event", { eventId: "standup_1110" });
    await expect(call).rejects.toMatchObject({ code: "unexpected-response" });
  });

  it("calls an event without an id an unexpected response", async () => {
    const { connection } = connectToFakeCalendar(200, JSON.stringify({ summary: "Dentist" }));
    const call = connection.callTool("calendar_get_event", { eventId: "standup_1110" });
    await expect(call).rejects.toMatchObject({ code: "unexpected-response" });
    await expect(call).rejects.not.toThrow(/Dentist/);
  });

  it("refuses an event id that could change the path, before any request", async () => {
    const { connection, requests } = connectToFakeCalendar(200, "{}");
    const call = connection.callTool("calendar_get_event", { eventId: "../settings" });
    await expect(call).rejects.toMatchObject({
      code: "bad-arguments",
      message: "Check these arguments: eventId.",
    });
    expect(requests).toHaveLength(0);
  });
});
