import type { McpToolResult } from "@halonicjs/integration-mcp";
import { describe, expect, it } from "vitest";
import { toHits } from "./hits.ts";
import { maxRefChars, maxSnippetChars, maxTextAnswerChars, maxTitleChars } from "./limits.ts";

/** A tool answer made of these text parts. */
function answer(...texts: string[]): McpToolResult {
  return { content: texts.map((text) => ({ type: "text", text })), isError: false };
}

const twoResults = [
  { id: "doc-1", title: "Holiday policy", snippet: "Staff get 25 days.", score: 0.9 },
  { id: "doc-2", title: "Travel policy", snippet: "Book trains first.", score: 0.4 },
];

describe("toHits", () => {
  it("maps a JSON list to one hit per result, in the server's order", () => {
    expect(toHits(answer(JSON.stringify(twoResults)), "handbook", 5)).toEqual([
      { ref: "doc-1", title: "Holiday policy", snippet: "Staff get 25 days.", score: 0.9 },
      { ref: "doc-2", title: "Travel policy", snippet: "Book trains first.", score: 0.4 },
    ]);
  });

  it.each(["results", "hits", "documents", "items"])("reads the list under %s", (field) => {
    const hits = toHits(answer(JSON.stringify({ [field]: twoResults, total: 2 })), "handbook", 5);
    expect(hits.map((hit) => hit.ref)).toEqual(["doc-1", "doc-2"]);
  });

  it("maps one JSON result per text part", () => {
    const parts = twoResults.map((result) => JSON.stringify(result));
    expect(toHits(answer(...parts), "handbook", 5).map((hit) => hit.ref)).toEqual([
      "doc-1",
      "doc-2",
    ]);
  });

  it("reads the other common field names, and numeric ids", () => {
    const results = [
      { uri: "file:///guides/setup.md", name: "Setup", summary: "Install it." },
      { url: "https://docs.example.com/faq", name: "FAQ", content: "Questions." },
      { id: 42, text: "Numbered page." },
    ];
    expect(toHits(answer(JSON.stringify(results)), "handbook", 5)).toEqual([
      { ref: "file:///guides/setup.md", title: "Setup", snippet: "Install it.", score: 1 },
      { ref: "https://docs.example.com/faq", title: "FAQ", snippet: "Questions.", score: 1 / 2 },
      { ref: "42", title: "42", snippet: "Numbered page.", score: 1 / 3 },
    ]);
  });

  it("uses rank-based scores for all hits when only some results have a score", () => {
    const results = [{ id: "doc-1", score: 12.5 }, { id: "doc-2" }, { id: "doc-3", score: "high" }];
    expect(toHits(answer(JSON.stringify(results)), "handbook", 5).map((hit) => hit.score)).toEqual([
      1,
      1 / 2,
      1 / 3,
    ]);
  });

  it("judges the scores only on the hits it keeps", () => {
    const results = [{ id: "doc-1", score: 0.9 }, { id: "doc-2", score: 0.4 }, { id: "doc-3" }];
    expect(toHits(answer(JSON.stringify(results)), "handbook", 2).map((hit) => hit.score)).toEqual([
      0.9, 0.4,
    ]);
  });

  it("keeps at most `limit` hits", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ id: `doc-${index}` }));
    expect(toHits(answer(JSON.stringify(many)), "handbook", 3)).toHaveLength(3);
  });

  it("cuts long titles and snippets", () => {
    const long = [{ id: "doc-1", title: "t".repeat(1_000), snippet: "s".repeat(5_000) }];
    const [hit] = toHits(answer(JSON.stringify(long)), "handbook", 5);
    expect(hit?.title).toHaveLength(maxTitleChars);
    expect(hit?.snippet).toHaveLength(maxSnippetChars);
    expect(hit?.snippet.endsWith("…")).toBe(true);
  });

  it("returns no hits for an empty list, which isn't the same as a failure", () => {
    expect(toHits(answer("[]"), "handbook", 5)).toEqual([]);
    expect(toHits(answer(JSON.stringify({ results: [] })), "handbook", 5)).toEqual([]);
  });

  it("returns no hits for an answer without text", () => {
    expect(toHits({ content: [{ type: "other", kind: "image" }], isError: false }, "h", 5)).toEqual(
      [],
    );
  });

  it("makes one hit of a plain-text answer, cut to its limit", () => {
    const text = `Two pages mention holidays.\n${"x".repeat(5_000)}`;
    const hits = toHits(answer(text), "handbook", 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ ref: "handbook:search", title: "handbook results", score: 1 });
    expect(hits[0]?.snippet).toHaveLength(maxTextAnswerChars);
    expect(hits[0]?.snippet.startsWith("Two pages mention holidays.")).toBe(true);
  });

  it("joins the text parts of a plain-text answer", () => {
    const [hit] = toHits(answer("First page.", "Second page."), "handbook", 5);
    expect(hit?.snippet).toBe("First page.\n\nSecond page.");
  });

  it.each([
    ["a result without a ref", JSON.stringify([{ id: "doc-1" }, { title: "No ref" }])],
    ["a ref too long to pass back whole", JSON.stringify([{ id: "r".repeat(maxRefChars + 1) }])],
    ["a list of strings", JSON.stringify(["doc-1", "doc-2"])],
    ["JSON that holds no results", JSON.stringify({ answer: "Staff get 25 days." })],
    ["a number", "42"],
  ])("treats %s as plain text", (_case, text) => {
    const hits = toHits(answer(text), "handbook", 5);
    expect(hits).toEqual([
      { ref: "handbook:search", title: "handbook results", snippet: expect.any(String), score: 1 },
    ]);
  });

  it("treats text parts as plain text unless every one is a result", () => {
    const hits = toHits(answer(JSON.stringify({ id: "doc-1" }), "A note."), "handbook", 5);
    expect(hits.map((hit) => hit.ref)).toEqual(["handbook:search"]);
  });
});
