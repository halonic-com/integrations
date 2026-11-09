import { describe, expect, it } from "vitest";
import { FAKE } from "../test/fakes.ts";
import { errorText, HIDDEN, hideValues } from "./hide-values.ts";

describe("hideValues", () => {
  it("hides a value as written and URL-encoded", () => {
    const key = "a/b+c";
    expect(hideValues(`key ${key} or ${encodeURIComponent(key)}`, [key])).toBe(
      `key ${HIDDEN} or ${HIDDEN}`,
    );
  });

  it("hides the host of a URL setting, which a message about a request names", () => {
    const url = "https://mcp.home.example:8443/mcp";
    expect(
      hideValues("mcp.home.example:8443 is not allowed; mcp.home.example said no", [url]),
    ).toBe(`${HIDDEN} is not allowed; ${HIDDEN} said no`);
  });

  it("hides a longer value whole when a shorter one is inside it", () => {
    expect(hideValues(`${FAKE.apiKey}`, ["fake", FAKE.apiKey])).toBe(HIDDEN);
  });

  it("ignores empty values", () => {
    expect(hideValues("text", [""])).toBe("text");
  });
});

describe("errorText", () => {
  it("includes the stack and each cause", () => {
    const error = new Error("outer", { cause: new TypeError("inner") });
    const text = errorText(error);

    expect(text).toMatch(/^Error: outer\n\s+at /);
    expect(text).toContain("Caused by: TypeError: inner");
  });

  it("turns anything else into text", () => {
    expect(errorText("plain")).toBe("plain");
  });
});
