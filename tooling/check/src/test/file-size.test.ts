import { describe, expect, it } from "vitest";
import { integration, rulesHit } from "./fixture-repo.ts";

describe("tooling/check: file size", () => {
  it("fails files over 500 lines", () => {
    const big = integration("gmail", {}, { "src/index.ts": "export const x = 1;\n".repeat(501) });
    expect(rulesHit([big])).toEqual(["file-size"]);
  });
});
