import { describe, expect, it } from "vitest";
import {
  driveIdSchema,
  fileIdSchema,
  fileNameSchema,
  pageTokenSchema,
  uploadTextSchema,
} from "./arguments.ts";

describe("driveIdSchema", () => {
  it.each(["root", "1AbC_dEf-123"])("takes %s", (id) => {
    expect(driveIdSchema.safeParse(id).success).toBe(true);
  });

  it.each(["", "a/b", "a b", "a.b", "..", "a".repeat(201)])("refuses %j", (id) => {
    expect(driveIdSchema.safeParse(id).success).toBe(false);
  });

  it("gives the file id the same rule", () => {
    expect(fileIdSchema.safeParse("a/b").success).toBe(false);
    expect(fileIdSchema.safeParse("abc").success).toBe(true);
  });
});

describe("pageTokenSchema", () => {
  it("refuses an empty or huge token", () => {
    expect(pageTokenSchema.safeParse("").success).toBe(false);
    expect(pageTokenSchema.safeParse("t".repeat(1_001)).success).toBe(false);
    expect(pageTokenSchema.safeParse("t".repeat(1_000)).success).toBe(true);
  });
});

describe("fileNameSchema", () => {
  it("takes a name up to the limit and refuses an empty or longer one", () => {
    expect(fileNameSchema.safeParse("notes.txt").success).toBe(true);
    expect(fileNameSchema.safeParse("").success).toBe(false);
    expect(fileNameSchema.safeParse("n".repeat(1_001)).success).toBe(false);
  });
});

describe("uploadTextSchema", () => {
  it("takes text up to a million characters, and empty text", () => {
    expect(uploadTextSchema.safeParse("").success).toBe(true);
    expect(uploadTextSchema.safeParse("x".repeat(1_000_000)).success).toBe(true);
    expect(uploadTextSchema.safeParse("x".repeat(1_000_001)).success).toBe(false);
  });
});
