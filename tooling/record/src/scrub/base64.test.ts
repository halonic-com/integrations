import { describe, expect, it } from "vitest";
import { FAKE, testContext } from "../test/fakes.ts";
import { type Base64Style, decodeBase64Text, encodeBase64 } from "./base64.ts";
import { scrubText } from "./text.ts";

/**
 * 22 bytes, so padded base64 ends in `=`. The `?` and `>` bytes encode to `/`
 * and `+` in the standard alphabet, `_` and `-` in the URL-safe one.
 */
const TEXT_WITH_SYMBOL_BYTES = "fake text ??? >>> ends";

/** Base64 of raw bytes, for inputs that aren't valid UTF-8 text. */
function encodeBytes(bytes: readonly number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

describe("encodeBase64", () => {
  it("uses the standard alphabet with padding", () => {
    const encoded = encodeBase64(TEXT_WITH_SYMBOL_BYTES, { urlSafe: false, padded: true });
    expect(encoded).toMatch(/[+/]/);
    expect(encoded).not.toMatch(/[-_]/);
    expect(encoded).toMatch(/=$/);
  });

  it("uses the URL-safe alphabet without padding", () => {
    const encoded = encodeBase64(TEXT_WITH_SYMBOL_BYTES, { urlSafe: true, padded: false });
    expect(encoded).toMatch(/[-_]/);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("encodes text as UTF-8", () => {
    const encoded = encodeBase64("fake café", { urlSafe: false, padded: true });
    expect(atob(encoded)).toBe("fake cafÃ©");
  });
});

describe("decodeBase64Text", () => {
  const styles: Base64Style[] = [
    { urlSafe: false, padded: true },
    { urlSafe: false, padded: false },
    { urlSafe: true, padded: true },
    { urlSafe: true, padded: false },
  ];

  it.each(styles)("decodes text and reports the style it found (%o)", (style) => {
    const encoded = encodeBase64(TEXT_WITH_SYMBOL_BYTES, style);
    expect(decodeBase64Text(encoded)).toEqual({ text: TEXT_WITH_SYMBOL_BYTES, style });
  });

  it.each(styles)("encodes again to exactly the same value (%o)", (style) => {
    // The text rules re-encode scrubbed text in the style they found, so a
    // field that was URL-safe and unpadded stays that way.
    const encoded = encodeBase64(TEXT_WITH_SYMBOL_BYTES, style);
    const decoded = decodeBase64Text(encoded);
    expect(decoded && encodeBase64(decoded.text, decoded.style)).toBe(encoded);
  });

  it("decodes text with characters outside ASCII", () => {
    const text = "fake café, 東京, 🙂";
    const encoded = encodeBase64(text, { urlSafe: true, padded: false });
    expect(decodeBase64Text(encoded)?.text).toBe(text);
  });

  it("refuses a value that mixes both alphabets", () => {
    const standard = encodeBase64(TEXT_WITH_SYMBOL_BYTES, { urlSafe: false, padded: false });
    const mixed = standard.replace("/", "_");
    expect(mixed).toMatch(/[+]/);
    expect(mixed).toMatch(/_/);
    expect(decodeBase64Text(mixed)).toBeUndefined();
  });

  it("refuses a length no base64 value can have", () => {
    // One character past a full group of four can't hold a whole byte.
    const encoded = encodeBase64("fake text!!!", { urlSafe: false, padded: false });
    expect(encoded.length % 4).toBe(0);
    expect(decodeBase64Text(`${encoded}Q`)).toBeUndefined();
  });

  it("refuses characters outside both alphabets", () => {
    expect(decodeBase64Text("ZmFrZSB0ZXh0!!")).toBeUndefined();
    expect(decodeBase64Text("ZmFr ZSB0 ZXh0")).toBeUndefined();
  });

  describe("minimum length", () => {
    it("ignores text shorter than 8 characters", () => {
      const encoded = encodeBase64("seven!!", { urlSafe: false, padded: true });
      expect(decodeBase64Text(encoded)).toBeUndefined();
    });

    it("decodes text of exactly 8 characters", () => {
      const encoded = encodeBase64("eight!!!", { urlSafe: false, padded: true });
      expect(decodeBase64Text(encoded)?.text).toBe("eight!!!");
    });

    it("counts bytes, not characters", () => {
      // Four characters, eight bytes of UTF-8.
      const encoded = encodeBase64("éééé", { urlSafe: false, padded: true });
      expect(decodeBase64Text(encoded)?.text).toBe("éééé");
    });
  });

  describe("binary data", () => {
    /** Twenty bytes of text with `controls` of them replaced by control characters. */
    function withControls(controls: number): string {
      const bytes = [...new TextEncoder().encode("fake text of twenty!")];
      for (let i = 0; i < controls; i += 1) {
        bytes[i * 2] = 0x01;
      }
      return encodeBytes(bytes);
    }

    it("still decodes text with 1 control character in 20 (5%)", () => {
      expect(decodeBase64Text(withControls(1))).toBeDefined();
    });

    it("treats text with 2 control characters in 20 (10%) as binary", () => {
      expect(decodeBase64Text(withControls(2))).toBeUndefined();
    });

    it("doesn't count tabs, line feeds and carriage returns", () => {
      const text = "fake\t\t\t\r\n\r\n\r\nlines";
      expect(decodeBase64Text(encodeBase64(text, { urlSafe: false, padded: true }))?.text).toBe(
        text,
      );
    });

    it("counts DEL and the replacement character as unreadable", () => {
      const del = encodeBase64("fake\u007f\u007ftext", { urlSafe: false, padded: true });
      const replacement = encodeBase64("fake��text", { urlSafe: false, padded: true });
      expect(decodeBase64Text(del)).toBeUndefined();
      expect(decodeBase64Text(replacement)).toBeUndefined();
    });

    it("refuses bytes that aren't valid UTF-8", () => {
      // "fake " then a lone continuation byte, then a truncated two-byte sequence.
      const encoded = encodeBytes([0x66, 0x61, 0x6b, 0x65, 0x20, 0x80, 0x74, 0x65, 0x78, 0xc3]);
      expect(decodeBase64Text(encoded)).toBeUndefined();
    });

    it("refuses a typical binary file header", () => {
      // The first bytes of a PNG file.
      const encoded = encodeBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
      expect(decodeBase64Text(encoded)).toBeUndefined();
    });
  });

  describe("a secret hidden inside base64", () => {
    it.each(styles)("is readable once decoded (%o)", (style) => {
      const encoded = encodeBase64(`user=fake&key=${FAKE.apiKey}`, style);
      expect(encoded).not.toContain(FAKE.apiKey);
      expect(decodeBase64Text(encoded)?.text).toContain(FAKE.apiKey);
    });

    it.each(styles)("is found and removed by the text rules (%o)", (style) => {
      // No known secrets: only decoding the base64 can reveal these.
      const context = testContext();
      const encoded = encodeBase64(`To: ${FAKE.email}\nX-Key: ${FAKE.apiKey}\n`, style);
      const scrubbed = scrubText(`raw=${encoded}`, "request.body.raw", context);

      const decoded = decodeBase64Text(scrubbed.slice("raw=".length));
      expect(decoded?.text).not.toContain(FAKE.email);
      expect(decoded?.text).not.toContain(FAKE.apiKey);
      expect(decoded?.text).toContain("person1@example.com");
    });
  });
});
