import { describe, expect, it } from "vitest";
import { isConventionalTitle } from "./pr-title.ts";

describe("isConventionalTitle", () => {
  it.each([
    "feat: add the layer check",
    "fix(check): read nested lockfile fields",
    "ci!: require ci-ok",
  ])("accepts %s", (title) => {
    expect(isConventionalTitle(title)).toBe(true);
  });

  it.each(["Add stuff", "feature: x", "fix:missing space", `feat: ${"x".repeat(120)}`])(
    "rejects %s",
    (title) => {
      expect(isConventionalTitle(title)).toBe(false);
    },
  );
});
