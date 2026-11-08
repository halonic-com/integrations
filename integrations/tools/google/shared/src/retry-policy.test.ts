import { describe, expect, it } from "vitest";
import { isRepeatable, isRetryableStatus, retryDelayMs } from "./retry-policy.ts";

const now = new Date("2026-01-15T12:00:00Z");

describe("isRepeatable", () => {
  it.each(["GET", "HEAD"])("repeats a %s", (method) => {
    expect(isRepeatable(method, false)).toBe(true);
  });

  it.each(["POST", "PUT", "PATCH"])(
    "repeats a %s only when the caller says it's safe",
    (method) => {
      expect(isRepeatable(method, false)).toBe(false);
      expect(isRepeatable(method, true)).toBe(true);
    },
  );

  it("never repeats a DELETE, whatever the caller says", () => {
    expect(isRepeatable("DELETE", true)).toBe(false);
  });
});

describe("isRetryableStatus", () => {
  it.each([429, 500, 502, 503, 504, 599])("retries %i", (status) => {
    expect(isRetryableStatus(status)).toBe(true);
  });

  it.each([400, 401, 403, 404, 408, 409, 600])("doesn't retry %i", (status) => {
    expect(isRetryableStatus(status)).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("backs off 1 s, then 2 s, without a retry-after", () => {
    expect(retryDelayMs(null, 0, now)).toBe(1_000);
    expect(retryDelayMs(null, 1, now)).toBe(2_000);
  });

  it("honours retry-after in seconds up to 30 s", () => {
    expect(retryDelayMs("0", 0, now)).toBe(0);
    expect(retryDelayMs(" 7 ", 0, now)).toBe(7_000);
    expect(retryDelayMs("30", 0, now)).toBe(30_000);
  });

  it("gives up when retry-after asks for more than 30 s", () => {
    expect(retryDelayMs("31", 0, now)).toBeUndefined();
    expect(retryDelayMs("Thu, 15 Jan 2026 12:05:00 GMT", 0, now)).toBeUndefined();
  });

  it("honours retry-after as a date, measured from the clock", () => {
    expect(retryDelayMs("Thu, 15 Jan 2026 12:00:10 GMT", 0, now)).toBe(10_000);
  });

  it("doesn't wait for a date in the past", () => {
    expect(retryDelayMs("Thu, 15 Jan 2026 11:00:00 GMT", 0, now)).toBe(0);
  });

  it("backs off as usual when retry-after can't be read", () => {
    expect(retryDelayMs("soon", 1, now)).toBe(2_000);
    expect(retryDelayMs("-5", 0, now)).toBe(1_000);
  });
});
