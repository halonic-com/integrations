/**
 * Limits on what the source sends to the server and passes on from it.
 * Hits and documents go into the model's context, so every list and every
 * text has a limit (guide, section 5), whatever the server sends.
 */

/** Hits per search when the caller doesn't say: the old source's default. */
export const defaultHits = 5;
/** Hits per search at most, whatever the caller asks for. */
export const maxHits = 20;

/** A hit's snippet: enough to judge the hit, short enough for twenty of them. */
export const maxSnippetChars = 500;
/**
 * The one hit made from a plain-text answer holds every result the server
 * wrote, so it gets more room than one snippet.
 */
export const maxTextAnswerChars = 2_000;
export const maxTitleChars = 200;
/** A longer ref is refused rather than cut: a cut ref would read another document, or none. */
export const maxRefChars = 1_000;
/** About 25,000 tokens: a long document, but not a whole book in one context. */
export const maxDocumentChars = 100_000;
/** What the caller may send as a query. */
export const maxQueryChars = 1_000;

/** The number of hits to ask for and keep: {@link defaultHits} unless the caller says, never above {@link maxHits}. */
export function hitLimit(requested: number | undefined): number {
  if (requested === undefined || Number.isNaN(requested)) {
    return defaultHits;
  }
  return Math.min(maxHits, Math.max(1, Math.floor(requested)));
}
