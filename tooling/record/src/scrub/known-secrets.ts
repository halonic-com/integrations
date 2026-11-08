import { encodeBase64 } from "./base64.ts";
import { mergeRanges, type TextRange } from "./text-ranges.ts";

/*
 * The replay imports this file, and integration tests typecheck it with the
 * integration preset, which has no Web or Node globals. Node and the cloud
 * runtimes all have these, so only the parts used here are declared.
 */
declare const URLSearchParams: new (pairs: [string, string][]) => { toString(): string };

/** Secrets shorter than this are only found whole; pieces of them would match too often. */
const MIN_LENGTH_FOR_PIECES = 20;

/** The shortest piece of a secret that still counts as a leak. */
const PIECE_LENGTH = 10;

/**
 * Finds the exact key values the kit added during a recording (in tests,
 * the fake keys). This is the strongest rule: it doesn't depend on what a
 * key looks like. It also finds:
 * - the key URL-encoded (as `encodeURIComponent` and as form data do it)
 *   or base64-encoded
 * - long pieces of the key, so a key split across the URL and the body
 *   is still found in both places
 *
 * The values only live in memory for the length of the recording.
 */
export class KnownSecrets {
  private readonly wholeValues: readonly string[];
  private readonly pieceSources: readonly string[];

  constructor(secrets: readonly string[]) {
    const nonEmpty = secrets.filter((secret) => secret.length > 0);
    this.wholeValues = unique(nonEmpty.flatMap(encodingsOf)).sort((a, b) => b.length - a.length);
    this.pieceSources = nonEmpty.filter((secret) => secret.length >= MIN_LENGTH_FOR_PIECES);
  }

  /** Every place in `text` that holds a known secret, an encoding of one, or a long piece of one. */
  find(text: string): TextRange[] {
    return mergeRanges([...this.findWhole(text), ...this.findPieces(text)]);
  }

  /** True when all of `value` is a known secret (or an encoding of one). */
  isWhole(value: string): boolean {
    return this.wholeValues.includes(value);
  }

  private findWhole(text: string): TextRange[] {
    const found: TextRange[] = [];
    for (const value of this.wholeValues) {
      let start = text.indexOf(value);
      while (start !== -1) {
        found.push({ start, end: start + value.length });
        start = text.indexOf(value, start + value.length);
      }
    }
    return found;
  }

  private findPieces(text: string): TextRange[] {
    const found: TextRange[] = [];
    for (const secret of this.pieceSources) {
      let start = 0;
      while (start + PIECE_LENGTH <= text.length) {
        const piece = text.slice(start, start + PIECE_LENGTH);
        if (!secret.includes(piece)) {
          start += 1;
          continue;
        }
        // Grow the piece for as long as it is still part of the secret.
        let end = start + PIECE_LENGTH;
        while (end < text.length && secret.includes(text.slice(start, end + 1))) {
          end += 1;
        }
        found.push({ start, end });
        start = end;
      }
    }
    return found;
  }
}

function encodingsOf(secret: string): string[] {
  const base64 = encodeBase64(secret, { urlSafe: false, padded: true });
  const base64Url = encodeBase64(secret, { urlSafe: true, padded: false });
  // As it appears inside a JSON string, for when a saved file is scanned.
  const jsonEscaped = JSON.stringify(secret).slice(1, -1);
  // Form data and `URLSearchParams` encode `~!'()*` and spaces differently
  // from `encodeURIComponent`, so both forms are looked for.
  const formEncoded = new URLSearchParams([["", secret]]).toString().slice(1);
  return [
    secret,
    jsonEscaped,
    encodeURIComponent(secret),
    formEncoded,
    base64,
    base64.replace(/=+$/, ""),
    base64Url,
  ];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
