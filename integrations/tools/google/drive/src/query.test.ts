import { describe, expect, it } from "vitest";
import { allOf, inFolder, nameOrContentHas, notTrashed, quoted } from "./query.ts";

describe("Drive query", () => {
  it("quotes a value and escapes backslashes and single quotes", () => {
    expect(quoted("plan")).toBe("'plan'");
    expect(quoted("Tom's plan")).toBe("'Tom\\'s plan'");
    expect(quoted("a\\b")).toBe("'a\\\\b'");
  });

  it("keeps a value that tries to end the string inside it", () => {
    // Without escaping, this would close the string and add a clause.
    expect(nameOrContentHas("x' or name != '")).toBe(
      "(name contains 'x\\' or name != \\'' or fullText contains 'x\\' or name != \\'')",
    );
  });

  it("joins clauses with and", () => {
    expect(allOf([notTrashed, inFolder("folder-projects-01")])).toBe(
      "trashed = false and 'folder-projects-01' in parents",
    );
  });
});
