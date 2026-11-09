import { describe, expect, it } from "vitest";
import {
  callTool,
  connectToFakeCalendar,
  connectToRecording,
  googleError,
} from "../test/replay.ts";

describe("calendar_list_calendars", () => {
  it("returns each calendar's id, name, time zone, access role and whether it is primary", async () => {
    const { connection, replay } = connectToRecording("list-calendars");
    const result = await callTool(connection, "calendar_list_calendars", {});
    replay.assertAllUsed();
    expect(result).toEqual({
      calendars: [
        {
          id: "alex@example.com",
          name: "<scrubbed:content>",
          timeZone: "Europe/Berlin",
          accessRole: "owner",
          primary: true,
        },
        {
          id: "person1@example.com",
          name: "<scrubbed:content>",
          timeZone: "Europe/London",
          accessRole: "reader",
          primary: false,
        },
      ],
    });
  });

  it("hands back Google's page token and follows it on the next call", async () => {
    const { connection, replay } = connectToRecording("list-calendars-two-pages");
    const first = await callTool(connection, "calendar_list_calendars", { maxResults: 1 });
    expect(first).toMatchObject({ nextPageToken: "scrubbed-secret-1" });
    const second = await callTool(connection, "calendar_list_calendars", {
      maxResults: 1,
      pageToken: "scrubbed-secret-1",
    });
    expect(second).not.toHaveProperty("nextPageToken");
    replay.assertAllUsed();
  });

  it("prefers the name the account gave a calendar over its own", async () => {
    const page = { items: [{ id: "team", summary: "Team", summaryOverride: "My team" }] };
    const { connection } = connectToFakeCalendar(200, JSON.stringify(page));
    const result = await callTool(connection, "calendar_list_calendars", {});
    expect(result).toMatchObject({ calendars: [{ id: "team", name: "My team", primary: false }] });
  });

  it("maps a refused sign-in to not-signed-in without Google's text", async () => {
    const { connection, requests } = connectToFakeCalendar(401, googleError(401, "authError"));
    const call = connection.callTool("calendar_list_calendars", {});
    await expect(call).rejects.toMatchObject({ code: "not-signed-in" });
    await expect(call).rejects.not.toThrow(/Dentist/);
    expect(requests).toHaveLength(1);
  });

  it("refuses more calendars than Google sends in one page, before any request", async () => {
    const { connection, requests } = connectToFakeCalendar(200, "{}");
    const call = connection.callTool("calendar_list_calendars", { maxResults: 251 });
    await expect(call).rejects.toMatchObject({
      code: "bad-arguments",
      message: "Check these arguments: maxResults.",
    });
    expect(requests).toHaveLength(0);
  });
});
