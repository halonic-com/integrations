import { describe, expect, it } from "vitest";
import { decodePercentText, PERCENT_ENCODED_RUN } from "./percent-encoding.ts";

describe("decodePercentText", () => {
  it("decodes the escapes of printable ASCII characters", () => {
    expect(decodePercentText("person%40example.com")).toBe("person@example.com");
    expect(decodePercentText("%2B447700900123")).toBe("+447700900123");
  });

  it("decodes a value that was encoded twice", () => {
    expect(decodePercentText("person%2540example.com")).toBe("person@example.com");
  });

  it("decodes no further than twice", () => {
    expect(decodePercentText("%252540")).toBe("%40");
  });

  it("leaves a broken escape as it is, without throwing", () => {
    expect(decodePercentText("100%")).toBe("100%");
    expect(decodePercentText("%zz")).toBe("%zz");
  });

  it("leaves non-ASCII and control escapes as they are", () => {
    expect(decodePercentText("%C3%A9")).toBe("%C3%A9");
    expect(decodePercentText("%0A")).toBe("%0A");
  });

  it("keeps a plus sign as a plus sign", () => {
    expect(decodePercentText("a+b")).toBe("a+b");
  });
});

describe("PERCENT_ENCODED_RUN", () => {
  function runsIn(text: string): string[] {
    return text.match(PERCENT_ENCODED_RUN) ?? [];
  }

  it("finds the whole run around an escape", () => {
    expect(runsIn("to=person%40example.com&x=1 next")).toEqual(["to=person%40example.com&x=1"]);
  });

  it("stops at whitespace, quotes and backslashes", () => {
    expect(runsIn('{"q":"a%20b"}')).toEqual(["a%20b"]);
    expect(runsIn("a%20b\\nc%20d")).toEqual(["a%20b", "nc%20d"]);
  });

  it("finds nothing in text without an escape", () => {
    expect(runsIn("plain text, 100% sure")).toEqual([]);
  });

  it("is quick on a long run without an escape", () => {
    const started = Date.now();
    runsIn("A".repeat(200_000));
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
