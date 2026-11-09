import { describe, expect, it } from "vitest";
import {
  callTool,
  connectToFakeCalendar,
  connectToRecording,
  googleError,
} from "../test/replay.ts";

describe("calendar_delete_event", () => {
  it("deletes the event without mailing anyone and returns its id", async () => {
    const { connection, replay } = connectToRecording("delete-event");
    const result = await callTool(connection, "calendar_delete_event", { eventId: "lunch01" });
    replay.assertAllUsed();
    expect(replay.sent[0]?.init.method).toBe("DELETE");
    expect(replay.sent[0]?.url).toContain("sendUpdates=none");
    expect(result).toEqual({ id: "lunch01" });
  });

  it.each([
    [404, "notFound", "not-found"],
    [403, "forbiddenForNonOrganizer", "not-allowed"],
  ])("maps status %i with reason %s to %s", async (status, reason, code) => {
    const { connection } = connectToFakeCalendar(status, googleError(status, reason));
    const call = connection.callTool("calendar_delete_event", { eventId: "lunch01" });
    await expect(call).rejects.toMatchObject({ code });
    await expect(call).rejects.not.toThrow(/Dentist/);
  });

  it("never deletes again after a server error", async () => {
    const { connection, requests, waits } = connectToFakeCalendar(500, "{}");
    const call = connection.callTool("calendar_delete_event", { eventId: "lunch01" });
    await expect(call).rejects.toMatchObject({ code: "unavailable" });
    expect(requests).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it("refuses an event id that could change the path, before any request", async () => {
    const { connection, requests } = connectToFakeCalendar(204, "");
    const call = connection.callTool("calendar_delete_event", { eventId: ".." });
    await expect(call).rejects.toMatchObject({ code: "bad-arguments" });
    expect(requests).toHaveLength(0);
  });
});
