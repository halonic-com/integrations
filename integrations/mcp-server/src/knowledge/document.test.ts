import type { McpToolResult } from "@halonicjs/integration-mcp";
import { describe, expect, it } from "vitest";
import { cutNote, toDocument } from "./document.ts";
import { maxDocumentChars, maxTitleChars } from "./limits.ts";

function answer(...texts: string[]): McpToolResult {
  return { content: texts.map((text) => ({ type: "text", text })), isError: false };
}

describe("toDocument", () => {
  it("reads the title and content of a JSON document", () => {
    const text = JSON.stringify({ title: "Holiday policy", content: "Staff get 25 days." });
    expect(toDocument(answer(text), "doc-1")).toEqual({
      ref: "doc-1",
      title: "Holiday policy",
      content: "Staff get 25 days.",
    });
  });

  it("reads the other common field names", () => {
    const text = JSON.stringify({ name: "FAQ", text: "Questions." });
    expect(toDocument(answer(text), "doc-2")).toEqual({
      ref: "doc-2",
      title: "FAQ",
      content: "Questions.",
    });
  });

  it("keeps the caller's ref, whatever ref the server sends", () => {
    const text = JSON.stringify({ ref: "other-doc", content: "Staff get 25 days." });
    expect(toDocument(answer(text), "doc-1")?.ref).toBe("doc-1");
  });

  it("takes plain text as the content, titled by the ref", () => {
    expect(toDocument(answer("# Setup\n\nInstall it."), "guides/setup.md")).toEqual({
      ref: "guides/setup.md",
      title: "guides/setup.md",
      content: "# Setup\n\nInstall it.",
    });
  });

  it("takes JSON without a content field as text, as it is", () => {
    const text = JSON.stringify({ rows: [1, 2] });
    expect(toDocument(answer(text), "doc-1")?.content).toBe(text);
  });

  it("joins several text parts", () => {
    expect(toDocument(answer("Part one.", "Part two."), "doc-1")?.content).toBe(
      "Part one.\n\nPart two.",
    );
  });

  it("returns null for an answer without text", () => {
    expect(toDocument({ content: [], isError: false }, "doc-1")).toBeNull();
  });

  it("cuts a long document and says so at the end", () => {
    const doc = toDocument(answer("x".repeat(maxDocumentChars * 2)), "doc-1");
    expect(doc?.content).toHaveLength(maxDocumentChars);
    expect(doc?.content.endsWith(cutNote)).toBe(true);
  });

  it("leaves a document of exactly the limit whole", () => {
    const text = "x".repeat(maxDocumentChars);
    expect(toDocument(answer(text), "doc-1")?.content).toBe(text);
  });

  it("cuts a long title", () => {
    const text = JSON.stringify({ title: "t".repeat(1_000), content: "c" });
    expect(toDocument(answer(text), "doc-1")?.title).toHaveLength(maxTitleChars);
  });
});
