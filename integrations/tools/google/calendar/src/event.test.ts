import { describe, expect, it } from "vitest";
import { eventDetails, eventSummary, maxDescriptionChars } from "./event.ts";

describe("eventSummary", () => {
  it("gives an all-day event its dates and a timed one its times", () => {
    const allDay = eventSummary({
      id: "a",
      start: { date: "2026-11-11" },
      end: { date: "2026-11-12" },
    });
    expect(allDay).toMatchObject({ start: "2026-11-11", end: "2026-11-12", allDay: true });
    const timed = eventSummary({
      id: "b",
      start: { dateTime: "2026-11-10T09:00:00Z" },
      end: { dateTime: "2026-11-10T10:00:00Z" },
    });
    expect(timed).toMatchObject({ start: "2026-11-10T09:00:00Z", allDay: false });
  });

  it("leaves out what Google didn't send", () => {
    expect(JSON.parse(JSON.stringify(eventSummary({ id: "c" })))).toEqual({
      id: "c",
      allDay: false,
    });
  });
});

describe("eventDetails", () => {
  it("cuts a long description and says so", () => {
    const description = "x".repeat(maxDescriptionChars + 1);
    const details = eventDetails({ id: "d", description });
    expect(details.description).toHaveLength(maxDescriptionChars);
    expect(details.descriptionTruncated).toBe(true);
  });

  it("keeps a description at the limit whole", () => {
    const details = eventDetails({ id: "e", description: "x".repeat(maxDescriptionChars) });
    expect(details).not.toHaveProperty("descriptionTruncated");
  });

  it("says when Google left guests out", () => {
    expect(eventDetails({ id: "f", attendeesOmitted: true }).moreGuests).toBe(true);
    expect(eventDetails({ id: "g" })).not.toHaveProperty("moreGuests");
  });
});
