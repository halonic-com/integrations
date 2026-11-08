/**
 * What keys, tokens, e-mail addresses and phone numbers look like. Shared by
 * the scrubber and the safety net, so both judge text the same way.
 *
 * Every pattern is global; use it with `matchAll` or `replace`, which work on
 * a copy and never share `lastIndex` between calls.
 */

/** Well-known key and token formats, by provider. */
export const TOKEN_SHAPES: readonly RegExp[] = [
  // JSON Web Tokens: header and payload are base64url JSON, so both start with "eyJ".
  /eyJ[\w-]{5,}\.eyJ[\w-]{5,}\.[\w-]*/g,
  // The value after an auth scheme, wherever it appears in text.
  /(?<=\b(?:Bearer|Basic|Token|token)\s+)[\w.~+/=-]{8,}/g,
  // OpenAI, Anthropic and others: sk-..., sk-ant-...
  /\bsk-[\w-]{16,}/g,
  // GitHub
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_\w{20,}/g,
  // Slack
  /\bxox[abprs]-[\w-]{10,}/g,
  // Google API keys, OAuth access tokens and refresh tokens
  /\bAIza[\w-]{35,}/g,
  /\bya29\.[\w-]{20,}/g,
  /(?<![\w/])1\/\/[\w-]{20,}/g,
  // AWS access key IDs
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // Stripe-style keys
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  // GitLab
  /\bglpat-[\w-]{20,}/g,
  // Our own fake keys in tests always start with this, so they're caught anywhere.
  /halonic-fake-[\w-]*/gi,
];

/**
 * A run of characters that could be base64, hex or a random token. Each run
 * is then checked: is it encoded text, or does it look random?
 */
export const CANDIDATE_RUN = /(?<![\w+/-])[\w+/-]{16,}={0,2}(?![\w+/=-])/g;

/** E-mail addresses, including ones in HTML, URLs and mail headers. */
export const EMAIL = /[\w.%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/**
 * Phone numbers written the way people write them: with a country code
 * (+44 7700 900123), with an area code in brackets ((555) 010-0123) or
 * split 3-3-4 (555-010-0123). A plain run of digits is not matched: IDs and
 * timestamps look the same.
 */
export const PHONE =
  /(?<![\w+])(?:\+\d{1,3}[\s.-]?(?:\(\d{1,4}\)[\s.-]?)?\d{1,4}(?:[\s.-]?\d{2,4}){1,4}|\(\d{3}\)\s?\d{3}[\s.-]\d{4}|\d{3}[.-]\d{3}[.-]\d{4})(?!\w)/g;

/** A phone match needs this many digits to count; fewer is a version, a price or a time. */
export function hasPhoneLength(match: string): boolean {
  const digits = match.replace(/\D/g, "").length;
  return digits >= 10 && digits <= 15;
}

/** The stand-ins the scrubber writes; never treated as something to remove. */
export const PLACEHOLDER = /^scrubbed(?:-secret-\d+)?$/;

/** The shortest mixed run that can count as random. */
const MIN_RANDOM_LENGTH = 24;

/** Hex runs this long are keys or hashes; either way, not worth keeping. */
const MIN_HEX_LENGTH = 32;

/** UUIDs are IDs, not secrets: tests need to see them. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bits per character; English-like identifiers stay below this. */
const MIN_RANDOM_ENTROPY = 3.5;

/**
 * True when a run looks like a random key rather than a word, a path or an ID
 * we want to keep. A heuristic: the known-secret rule is the real defence
 * for keys the kit adds, and this catches what the integration itself
 * receives (session IDs, upload URLs, signed links).
 */
export function looksRandom(run: string): boolean {
  const value = run.replace(/=+$/, "");
  if (value.split("/").some((part) => isLongHex(part))) {
    return true;
  }
  if (UUID.test(value)) {
    return false;
  }
  if (value.length < MIN_RANDOM_LENGTH || entropy(value) < MIN_RANDOM_ENTROPY) {
    return false;
  }
  const digits = count(value, /\d/g);
  const lower = count(value, /[a-z]/g);
  const upper = count(value, /[A-Z]/g);
  if (upper >= 2 && lower >= 2 && digits >= 2) {
    return true;
  }
  // Lower-case tokens (base36 and similar) need plenty of digits, and no
  // slashes, so a lower-case path like /v1/users/me/messages isn't caught.
  const digitShare = digits / value.length;
  return upper === 0 && !value.includes("/") && digitShare >= 0.2 && digitShare <= 0.8;
}

function isLongHex(value: string): boolean {
  return value.length >= MIN_HEX_LENGTH && /^[0-9a-f]+$/i.test(value);
}

function count(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

/** Shannon entropy in bits per character. */
function entropy(value: string): number {
  const frequencies = new Map<string, number>();
  for (const char of value) {
    frequencies.set(char, (frequencies.get(char) ?? 0) + 1);
  }
  let bits = 0;
  for (const frequency of frequencies.values()) {
    const share = frequency / value.length;
    bits -= share * Math.log2(share);
  }
  return bits;
}
