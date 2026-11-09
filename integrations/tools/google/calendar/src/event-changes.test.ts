import { describe, expect, it } from "vitest";
import { eventChanges, eventTimeBody } from "./event-changes.ts";

describe("eventTimeBody", () => {
  it("sends a date alone as an all-day date, and anything else as a date and time", () => {
    expect(eventTimeBody("2026-11-10")).toEqual({ date: "2026-11-10" });
    expect(eventTimeBody("2026-11-10T09:00:00+01:00")).toEqual({
      dateTime: "2026-11-10T09:00:00+01:00",
    });
  });
});

describe("eventChanges", () => {
  it("names the title summary, as Google does", () => {
    expect(eventChanges({ title: "Planning" })).toEqual({ summary: "Planning" });
  });

  it("keeps an empty text, which removes a field, and leaves out what wasn't passed", () => {
    expect(eventChanges({ location: "", description: undefined })).toEqual({ location: "" });
  });
});
