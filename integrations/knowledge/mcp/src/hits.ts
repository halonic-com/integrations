import type { McpToolResult } from "@halonicjs/integration-mcp";
import { cutText } from "@halonicjs/integration-shared";
import type { KnowledgeHit } from "./kit.ts";
import { maxRefChars, maxSnippetChars, maxTextAnswerChars, maxTitleChars } from "./limits.ts";
import { asJsonObject, type JsonObject, parseJson, stringField, textsOf } from "./structured.ts";

/**
 * The field names servers use, in the order we look for them. There is no
 * standard for search results over MCP, so we read the common names and
 * treat anything else as plain text.
 */
const listFields = ["results", "hits", "documents", "items"] as const;
const refFields = ["ref", "id", "uri", "url"] as const;
const titleFields = ["title", "name"] as const;
const snippetFields = ["snippet", "summary", "text", "content", "description"] as const;

/**
 * Maps the search tool's answer to hits, at most `limit` of them, in the
 * server's order: it knows best which match is best, and a score can be a
 * distance, where lower is better.
 *
 * A structured answer becomes one hit per result: a JSON list of results,
 * a JSON object with one of {@link listFields}, or one JSON result per
 * text part. Every result needs a ref. Any other answer is plain text and
 * becomes one hit that holds it all, cut to {@link maxTextAnswerChars}.
 * An answer without text has no hits.
 */
export function toHits(result: McpToolResult, sourceId: string, limit: number): KnowledgeHit[] {
  const texts = textsOf(result);
  if (texts.length === 0) {
    return [];
  }
  const results = structuredResults(texts);
  if (results === undefined) {
    return [textAnswerHit(texts, sourceId)];
  }
  const kept = results.slice(0, limit);
  return hitsWithServerScores(kept) ?? kept.map((result, rank) => toHit(result, rankScore(rank)));
}

/**
 * The hits with the server's own scores, or `undefined` when one of them
 * has none: a server's score and a rank-based one aren't on the same
 * scale, so one list must not mix them.
 */
function hitsWithServerScores(results: readonly JsonObject[]): KnowledgeHit[] | undefined {
  const hits: KnowledgeHit[] = [];
  for (const result of results) {
    const score = serverScoreOf(result);
    if (score === undefined) {
      return undefined;
    }
    hits.push(toHit(result, score));
  }
  return hits;
}

/** The result's own `score`, when it is a finite number. */
function serverScoreOf(result: JsonObject): number | undefined {
  const score = Object.hasOwn(result, "score") ? result["score"] : undefined;
  return typeof score === "number" && Number.isFinite(score) ? score : undefined;
}

/** A score from the hit's place in the list: 1 for the first hit, 1/2 for the second. */
function rankScore(rank: number): number {
  return 1 / (rank + 1);
}

/** The results in the answer, or `undefined` when it isn't structured the way we read. */
function structuredResults(texts: readonly string[]): JsonObject[] | undefined {
  const [onlyText] = texts;
  const values =
    texts.length === 1 && onlyText !== undefined
      ? listIn(parseJson(onlyText))
      : texts.map(parseJson);
  if (values === undefined) {
    return undefined;
  }
  const results: JsonObject[] = [];
  for (const value of values) {
    const object = asJsonObject(value);
    if (object === undefined || refOf(object) === undefined) {
      return undefined;
    }
    results.push(object);
  }
  return results;
}

/** The list of results a JSON value holds: itself, one of its {@link listFields}, or itself as the only result. */
function listIn(value: unknown): readonly unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }
  const object = asJsonObject(value);
  if (object === undefined) {
    return undefined;
  }
  for (const field of listFields) {
    const list = Object.hasOwn(object, field) ? object[field] : undefined;
    if (Array.isArray(list)) {
      return list;
    }
  }
  return [object];
}

/** A result's ref, when it has one short enough to pass back to `get` whole. */
function refOf(result: JsonObject): string | undefined {
  const ref = stringField(result, refFields, true);
  return ref !== undefined && ref.length <= maxRefChars ? ref : undefined;
}

function toHit(result: JsonObject, score: number): KnowledgeHit {
  // structuredResults kept only results with a ref.
  const ref = refOf(result) ?? "";
  return {
    ref,
    title: cutText(stringField(result, titleFields) ?? ref, maxTitleChars),
    snippet: cutText(stringField(result, snippetFields) ?? "", maxSnippetChars),
    score,
  };
}

/**
 * The one hit for a plain-text answer. It is no document of its own: its
 * ref only names it.
 */
function textAnswerHit(texts: readonly string[], sourceId: string): KnowledgeHit {
  return {
    ref: `${sourceId}:search`,
    title: `${sourceId} results`,
    snippet: cutText(texts.join("\n\n"), maxTextAnswerChars),
    score: 1,
  };
}
