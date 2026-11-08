import { describe, expect, it } from "vitest";
import {
  allOf,
  inFolder,
  nameOrContentHas,
  notTrashed,
  quoted,
  staysInOneClause,
} from "./query.ts";

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

  it("accepts balanced brackets, also with brackets and escaped quotes inside strings", () => {
    expect(staysInOneClause("name = 'a' or name = 'b'")).toBe(true);
    expect(staysInOneClause("(name = 'a' or name = 'b') and mimeType = 'text/plain'")).toBe(true);
    expect(staysInOneClause("name = 'a)'")).toBe(true);
    expect(staysInOneClause("name = 'Tom\\'s (plan'")).toBe(true);
    expect(staysInOneClause("name = 'a\\\\' and (starred = true)")).toBe(true);
    expect(staysInOneClause(`fullText contains '"exact words"'`)).toBe(true);
  });

  it("refuses a query that closes a bracket it didn't open, or leaves one open", () => {
    expect(staysInOneClause("name = 'a') or (trashed = true")).toBe(false);
    expect(staysInOneClause("(name = 'a'")).toBe(false);
    expect(staysInOneClause("name = 'a')")).toBe(false);
  });

  it("refuses a string that is left open, which would hide a bracket", () => {
    expect(staysInOneClause("name = 'a) or (trashed = true")).toBe(false);
    expect(staysInOneClause("name = 'a\\')")).toBe(false);
  });

  it("refuses a double quote outside a string, which Drive might read as a string of its own", () => {
    expect(staysInOneClause(`name = "'") or (trashed = true or name = "'"`)).toBe(false);
    expect(staysInOneClause(`name = "report"`)).toBe(false);
  });

  it("joins clauses with and", () => {
    expect(allOf([notTrashed, inFolder("folder-projects-01")])).toBe(
      "trashed = false and 'folder-projects-01' in parents",
    );
  });
});
