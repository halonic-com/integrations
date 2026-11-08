import { describe, expect, it } from "vitest";
import { decodeBase64, decodeBody, decodeUtf8 } from "./encoding.ts";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("decodeBase64", () => {
  it("decodes base64url and plain base64, with or without padding", () => {
    expect([...decodeBase64("-_8")]).toEqual([0xfb, 0xff]);
    expect([...decodeBase64("+/8=")]).toEqual([0xfb, 0xff]);
    expect([...decodeBase64("aGk")]).toEqual([0x68, 0x69]);
  });

  it("skips line breaks and characters outside the alphabet instead of failing", () => {
    expect([...decodeBase64("aG\r\nk")]).toEqual([0x68, 0x69]);
    expect(() => decodeBase64("<scrubbed:content>")).not.toThrow();
  });
});

describe("decodeUtf8", () => {
  it("decodes one- to four-byte sequences", () => {
    expect(decodeUtf8(bytes(0x41, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80))).toBe(
      "Aé€😀",
    );
  });

  it("replaces each invalid sequence with U+FFFD and goes on", () => {
    // A stray continuation byte, an overlong "/", a surrogate, and a cut-off sequence.
    expect(decodeUtf8(bytes(0x80, 0x41))).toBe("�A");
    expect(decodeUtf8(bytes(0xc0, 0xaf))).toBe("��");
    expect(decodeUtf8(bytes(0xed, 0xa0, 0x80))).toBe("���");
    expect(decodeUtf8(bytes(0xe2, 0x82))).toBe("��");
  });
});

describe("decodeBody", () => {
  it("turns Gmail's body data into text", () => {
    // "Grüße\n" in base64url, as Gmail sends it.
    expect(decodeBody("R3LDvMOfZQo")).toBe("Grüße\n");
  });

  it("is empty for a part without data", () => {
    expect(decodeBody(undefined)).toBe("");
    expect(decodeBody("")).toBe("");
  });
});
