import { describe, expect, it } from "vitest";
import { FAKE } from "../test/fakes.ts";
import { findEmails } from "./emails.ts";

/**
 * The same rule as one regular expression. It finds the same addresses, but
 * tries again from every character, so it is too slow for large recordings.
 * Here it only checks `findEmails`.
 */
const REFERENCE = /[\w.%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

function addresses(text: string): string[] {
  return findEmails(text).map((found) => found.address);
}

function referenceMatches(text: string): { address: string; index: number }[] {
  return [...text.matchAll(REFERENCE)].map((match) => ({ address: match[0], index: match.index }));
}

describe("findEmails", () => {
  it("finds addresses with where they start", () => {
    expect(findEmails(`To: ${FAKE.email}, ${FAKE.otherEmail}`)).toEqual([
      { address: FAKE.email, index: 4 },
      { address: FAKE.otherEmail, index: 26 },
    ]);
  });

  it.each([
    ["a mailto link", `<a href="mailto:${FAKE.email}">`, [FAKE.email]],
    ["a mail header", `From: Person <${FAKE.email}>`, [FAKE.email]],
    ["a plus address", "one+tag@mail.test", ["one+tag@mail.test"]],
    ["an @ with nothing before it", "@mail.test", []],
    ["an @ without a domain", "one@ two@", []],
    ["a domain without a top-level part", "one@localhost", []],
  ])("handles %s", (_label, text, expected) => {
    expect(addresses(text)).toEqual(expected);
  });

  it.each([".", "_", "+", "-", "%2C"])(
    "finds an address glued onto another with %j",
    (separator) => {
      const text = `${FAKE.email}${separator}x@other.test`;
      expect(findEmails(text)).toEqual(referenceMatches(text));
      expect(addresses(text).at(-1)).toMatch(/x@other\.test$/);
    },
  );

  it("takes at most 64 characters before the @", () => {
    const text = `${"a".repeat(100)}@mail.test`;
    expect(addresses(text)).toEqual([`${"a".repeat(64)}@mail.test`]);
  });

  it("finds what the single regular expression finds", () => {
    const pieces = [
      "a",
      "b.",
      "x_",
      "+",
      "-",
      "%",
      "@",
      "@",
      "@",
      ".test",
      ".test",
      ".de",
      " ",
      "<",
      "9",
    ];
    let seed = 1;
    const random = () => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed;
    };
    for (let round = 0; round < 10_000; round++) {
      let text = "";
      while (text.length < 40) {
        text += pieces[random() % pieces.length];
      }
      expect(findEmails(text), text).toEqual(referenceMatches(text));
    }
  });

  it("scans a large base64 body quickly", () => {
    const body = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo".repeat(60_000).slice(0, 2_000_000);
    const started = performance.now();
    const found = addresses(`${body} ${FAKE.email}`);
    const elapsed = performance.now() - started;
    expect(found).toEqual([FAKE.email]);
    expect(elapsed).toBeLessThan(1_000);
  });
});
