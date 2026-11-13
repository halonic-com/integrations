import { describe, expect, it } from "vitest";
import {
  bodyOffsetSchema,
  gmailIdSchema,
  includeInlineSchema,
  pageTokenSchema,
} from "./arguments.ts";

describe("gmailIdSchema", () => {
  it("refuses an empty or huge id", () => {
    expect(gmailIdSchema.safeParse("18c2f0a1b2c3d4e5").success).toBe(true);
    expect(gmailIdSchema.safeParse("").success).toBe(false);
    expect(gmailIdSchema.safeParse("i".repeat(201)).success).toBe(false);
  });
});

describe("pageTokenSchema", () => {
  it("refuses an empty or huge token", () => {
    expect(pageTokenSchema.safeParse("").success).toBe(false);
    expect(pageTokenSchema.safeParse("t".repeat(501)).success).toBe(false);
    expect(pageTokenSchema.safeParse("t".repeat(500)).success).toBe(true);
  });
});

describe("bodyOffsetSchema", () => {
  it("starts at the beginning when no offset is given", () => {
    expect(bodyOffsetSchema.parse(undefined)).toBe(0);
  });

  it("refuses a negative, fractional or too large offset", () => {
    expect(bodyOffsetSchema.safeParse(-1).success).toBe(false);
    expect(bodyOffsetSchema.safeParse(1.5).success).toBe(false);
    expect(bodyOffsetSchema.safeParse(10_000_001).success).toBe(false);
    expect(bodyOffsetSchema.safeParse(10_000_000).success).toBe(true);
  });
});

describe("includeInlineSchema", () => {
  it("leaves inline images out unless asked", () => {
    expect(includeInlineSchema.parse(undefined)).toBe(false);
    expect(includeInlineSchema.parse(true)).toBe(true);
  });
});
