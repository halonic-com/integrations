import { describe, expect, it } from "vitest";
import { callTool, connectToFakeCalendar, connectToRecording } from "../test/replay.ts";

describe("calendar_update_event", () => {
  it("sends only the changed fields, without mailing anyone, and removes an emptied location", async () => {
    const { connection, replay } = connectToRecording("update-event");
    const result = await callTool(connection, "calendar_update_event", {
      eventId: "lunch01",
      title: "Lunch with the design team (moved)",
      start: "2026-11-12T13:00:00+01:00",
      end: "2026-11-12T14:00:00+01:00",
      location: "",
    });
    replay.assertAllUsed();
    expect(replay.sent[0]?.init.method).toBe("PATCH");
    expect(replay.sent[0]?.url).toContain("sendUpdates=none");
    expect(replay.sent[0]?.body).toEqual({
      summary: "Lunch with the design team (moved)",
      start: { dateTime: "2026-11-12T13:00:00+01:00" },
      end: { dateTime: "2026-11-12T14:00:00+01:00" },
      location: "",
    });
    expect(result).toEqual({
      event: {
        id: "lunch01",
        title: "<scrubbed:content>",
        start: "2026-11-12T13:00:00+01:00",
        end: "2026-11-12T14:00:00+01:00",
        link: "<scrubbed:content>",
      },
    });
  });

  it("turns Google's refusal to let a guest change an event into not-allowed", async () => {
    const { connection, replay } = connectToRecording("update-event-not-allowed");
    const call = connection.callTool("calendar_update_event", {
      eventId: "standup_1110",
      description: "Moved to the big room.",
    });
    await expect(call).rejects.toMatchObject({
      code: "not-allowed",
      message: expect.stringContaining("forbiddenForNonOrganizer"),
    });
    replay.assertAllUsed();
  });

  it("never sends again after a server error", async () => {
    const { connection, requests, waits } = connectToFakeCalendar(503, "{}");
    const call = connection.callTool("calendar_update_event", { eventId: "lunch01", title: "x" });
    await expect(call).rejects.toMatchObject({ code: "unavailable" });
    expect(requests).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it.each([
    ["(arguments)", { eventId: "lunch01" }],
    ["end", { eventId: "lunch01", start: "2026-11-12T13:00:00Z" }],
    ["start", { eventId: "lunch01", end: "2026-11-12T13:00:00Z" }],
    ["end", { eventId: "lunch01", start: "2026-11-12", end: "2026-11-12T13:00:00Z" }],
    [
      "end",
      { eventId: "lunch01", start: "2026-11-12T13:00:00Z", end: "2026-11-12T13:30:00+01:00" },
    ],
    ["eventId", { eventId: "a/b", title: "x" }],
  ])("refuses a bad %s before any request", async (field, args) => {
    const { connection, requests } = connectToFakeCalendar(200, "{}");
    const call = connection.callTool("calendar_update_event", args);
    await expect(call).rejects.toMatchObject({
      code: "bad-arguments",
      message: `Check these arguments: ${field}.`,
    });
    expect(requests).toHaveLength(0);
  });
});
