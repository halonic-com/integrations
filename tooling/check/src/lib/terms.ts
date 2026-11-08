import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The personal-terms guard (plan 11.1). The list of protected terms never
 * enters the repo: CI reads it from an encrypted secret, and a person can
 * keep a local copy outside the repo. Nothing here ever prints a term.
 */

/** The environment variable CI fills from the encrypted secret. */
export const termsEnvironmentVariable = "HALONIC_DENY_TERMS";

/** Set to `true` in CI once the secret must exist: a missing list then fails instead of skipping. */
export const termsRequiredVariable = "HALONIC_TERMS_REQUIRED";

/** The optional local copy of the list, outside the repo. */
export const localTermsFile = join(homedir(), ".config", "halonic", "deny-terms");

/** Shortest allowed phrase: a short one would hide too much from the guard. */
export const minimumAllowedPhraseLength = 5;

/**
 * Makes look-alike spellings equal before matching: percent escapes are
 * decoded (`blue%20whale`), compatibility forms are folded (full-width
 * letters, ligatures), invisible format characters are dropped (zero-width
 * spaces) and accents are removed.
 */
export function normalise(text: string): string {
  const decoded = text.replace(/(?:%[0-9a-f]{2})+/gi, (escapes) => {
    try {
      return decodeURIComponent(escapes);
    } catch {
      return " ";
    }
  });
  return decoded
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Splits text into lowercase words, also inside identifiers: `someNameHelper` → some, name, helper. */
export function words(text: string): string[] {
  const spaced = normalise(text)
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2");
  return spaced
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

/**
 * Matches text against the protected terms. A term may be several words;
 * it matches when its words appear in a row or are written as one word
 * (`blue whale`, `blueWhale`, `bluewhale`, `blue%20whale`). Matching is
 * case-insensitive and works inside identifiers (`some_name`).
 */
export class TermMatcher {
  private readonly terms: readonly (readonly string[])[];
  private readonly allowedPhrases: readonly string[];

  /**
   * @param terms - the protected terms, one per entry
   * @param allowedPhrases - harmless technical phrases that contain a term
   *   (such as CSS `font-family`); they are removed before matching
   * @throws when an allowed phrase is too short or is a protected term itself;
   *   the message names the entry's number, never the text
   */
  constructor(terms: readonly string[], allowedPhrases: readonly string[] = []) {
    this.terms = terms.map(words).filter((term) => term.length > 0);
    this.allowedPhrases = allowedPhrases.map((phrase, index) => {
      const normalised = normalise(phrase).toLowerCase();
      if (normalised.length < minimumAllowedPhraseLength) {
        throw new Error(
          `Allowed phrase number ${index + 1} is shorter than ${minimumAllowedPhraseLength} characters.`,
        );
      }
      const phraseWords = words(phrase);
      if (this.terms.some((term) => term.join("") === phraseWords.join(""))) {
        throw new Error(`Allowed phrase number ${index + 1} is a protected term itself.`);
      }
      return normalised;
    });
  }

  /** True when there are no terms, which means the list isn't configured. */
  get isEmpty(): boolean {
    return this.terms.length === 0;
  }

  /** True when the text contains any protected term. */
  matches(text: string): boolean {
    const tokens = words(stripPhrases(text, this.allowedPhrases));
    return this.terms.some((term) => containsTerm(tokens, term));
  }

  /**
   * Replaces each part of a path that contains a protected term with
   * `[withheld]`, so the path can be printed without showing the term.
   */
  redactPath(path: string): string {
    return path
      .split("/")
      .map((part) => (this.matches(part) ? "[withheld]" : part))
      .join("/");
  }

  /** The 1-based line numbers of the lines that contain a protected term. */
  matchingLines(text: string): number[] {
    const result: number[] = [];
    text.split("\n").forEach((line, index) => {
      if (this.matches(line)) {
        result.push(index + 1);
      }
    });
    return result;
  }
}

/** Removes each allowed phrase where it stands alone, not inside a longer word. */
function stripPhrases(text: string, phrases: readonly string[]): string {
  let result = normalise(text);
  for (const phrase of phrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
    result = result.replace(pattern, " ");
  }
  return result;
}

/** True when the term's words come in a row, or the term is written as one word. */
function containsTerm(tokens: readonly string[], term: readonly string[]): boolean {
  if (term.length > 1 && tokens.includes(term.join(""))) {
    return true;
  }
  for (let start = 0; start + term.length <= tokens.length; start += 1) {
    if (term.every((word, offset) => tokens[start + offset] === word)) {
      return true;
    }
  }
  return false;
}

/** Parses a list: one term per line or comma-separated; `#` starts a comment. */
export function parseTermList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((entry) => entry.replace(/#.*$/, "").trim())
    .filter((entry) => entry !== "");
}

/**
 * Loads the protected terms from the environment (CI) or the local file.
 *
 * @returns the terms and where they came from, or an empty list when neither is set
 */
export function loadTerms(environment: NodeJS.ProcessEnv = process.env): {
  terms: string[];
  source: string;
} {
  const fromEnvironment = environment[termsEnvironmentVariable];
  if (fromEnvironment !== undefined && fromEnvironment.trim() !== "") {
    return {
      terms: parseTermList(fromEnvironment),
      source: `the ${termsEnvironmentVariable} secret`,
    };
  }
  if (existsSync(localTermsFile)) {
    return {
      terms: parseTermList(readFileSync(localTermsFile, "utf8")),
      source: "the local deny-terms file",
    };
  }
  return { terms: [], source: "nowhere" };
}

/** The in-repo list of harmless technical phrases, relative to the repo root. */
export const allowedPhrasesFile = join("tooling", "check", "terms-allowed-phrases.txt");

/**
 * Reads a list of harmless technical phrases (never terms). A missing file
 * means no phrases are allowed, which can only make the guard stricter.
 */
export function loadAllowedPhrases(file: string): string[] {
  return existsSync(file) ? parseTermList(readFileSync(file, "utf8")) : [];
}
