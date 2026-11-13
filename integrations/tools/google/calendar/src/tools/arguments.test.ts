import { describe, expect, it } from "vitest";
import {
  calendarIdSchema,
  calendarIdValueSchema,
  dateTimeSchema,
  eventIdSchema,
  eventTimeSchema,
  pageTokenSchema,
} from "./arguments.ts";

describe("calendarIdValueSchema", () => {
  it.each([
    "primary",
    "team@group.calendar.google.com",
    "en.usa#holiday@group.v.calendar.google.com",
  ])("takes %s", (id) => {
    expect(calendarIdValueSchema.safeParse(id).success).toBe(true);
  });

  it.each(["", "a/b", "a b", "a?x=1", "a%2Fb", "a".repeat(301)])(
    "refuses %j before a request is made",
    (id) => {
      expect(calendarIdValueSchema.safeParse(id).success).toBe(false);
    },
  );
});

describe("calendarIdSchema", () => {
  it("falls back to the primary calendar", () => {
    expect(calendarIdSchema.parse(undefined)).toBe("primary");
  });
});

describe("eventIdSchema", () => {
  it("takes an id and an occurrence of a repeating event", () => {
    expect(eventIdSchema.safeParse("abc123").success).toBe(true);
    expect(eventIdSchema.safeParse("abc123_20261110T090000Z").success).toBe(true);
  });

  it("refuses characters that would change the path", () => {
    expect(eventIdSchema.safeParse("a/b").success).toBe(false);
    expect(eventIdSchema.safeParse("..").success).toBe(false);
    expect(eventIdSchema.safeParse("").success).toBe(false);
  });
});

describe("pageTokenSchema", () => {
  it("refuses an empty or huge token", () => {
    expect(pageTokenSchema.safeParse("").success).toBe(false);
    expect(pageTokenSchema.safeParse("t".repeat(2_001)).success).toBe(false);
    expect(pageTokenSchema.safeParse("t".repeat(2_000)).success).toBe(true);
  });
});

describe("dateTimeSchema and eventTimeSchema", () => {
  it("takes a date and time with an offset, and Z", () => {
    expect(dateTimeSchema.safeParse("2026-11-10T09:00:00Z").success).toBe(true);
    expect(dateTimeSchema.safeParse("2026-11-10T09:00:00+01:00").success).toBe(true);
  });

  it("refuses a date and time without an offset", () => {
    expect(dateTimeSchema.safeParse("2026-11-10T09:00:00").success).toBe(false);
  });

  it("takes an all-day date or a date and time, nothing else", () => {
    expect(eventTimeSchema.safeParse("2026-11-10").success).toBe(true);
    expect(eventTimeSchema.safeParse("2026-11-10T09:00:00Z").success).toBe(true);
    expect(eventTimeSchema.safeParse("tomorrow").success).toBe(false);
    expect(eventTimeSchema.safeParse("2026-13-40").success).toBe(false);
  });
});
