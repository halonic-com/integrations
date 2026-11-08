import { describe, expect, it } from "vitest";
import { isRepeatable, isRetryableStatus, retryDelayMs } from "./retry-policy.ts";

const sentAt = "Thu, 15 Jan 2026 12:00:00 GMT";

/** A response's headers, looked up case-insensitively as `Headers` does. */
function headers(values: Record<string, string> = {}) {
  const lowerCase = new Map(
    Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return { get: (name: string) => lowerCase.get(name.toLowerCase()) ?? null };
}

/** The headers of a response Google sent at {@link sentAt}, with this `retry-after`. */
function retryAfter(value: string) {
  return headers({ date: sentAt, "retry-after": value });
}

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
    expect(retryDelayMs(headers({ date: sentAt }), 0)).toBe(1_000);
    expect(retryDelayMs(headers(), 1)).toBe(2_000);
  });

  it("honours retry-after in seconds up to 30 s", () => {
    expect(retryDelayMs(retryAfter("0"), 0)).toBe(0);
    expect(retryDelayMs(retryAfter(" 7 "), 0)).toBe(7_000);
    expect(retryDelayMs(retryAfter("30"), 0)).toBe(30_000);
  });

  it("gives up when retry-after asks for more than 30 s", () => {
    expect(retryDelayMs(retryAfter("31"), 0)).toBeUndefined();
    expect(retryDelayMs(retryAfter("Thu, 15 Jan 2026 12:05:00 GMT"), 0)).toBeUndefined();
  });

  it("honours retry-after as a date, measured from the response's date header", () => {
    expect(retryDelayMs(retryAfter("Thu, 15 Jan 2026 12:00:10 GMT"), 0)).toBe(10_000);
  });

  it("doesn't wait for a date in the past", () => {
    expect(retryDelayMs(retryAfter("Thu, 15 Jan 2026 11:00:00 GMT"), 0)).toBe(0);
  });

  it("backs off as usual for a retry-after date without a date header to measure it from", () => {
    const noDate = headers({ "retry-after": "Thu, 15 Jan 2026 12:00:10 GMT" });
    expect(retryDelayMs(noDate, 0)).toBe(1_000);
    const badDate = headers({ date: "-5", "retry-after": "Thu, 15 Jan 2026 12:00:10 GMT" });
    expect(retryDelayMs(badDate, 1)).toBe(2_000);
  });

  it("backs off as usual when retry-after can't be read", () => {
    expect(retryDelayMs(retryAfter("soon"), 1)).toBe(2_000);
    expect(retryDelayMs(retryAfter("-5"), 0)).toBe(1_000);
  });
});
