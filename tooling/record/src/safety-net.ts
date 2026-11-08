import { decodeBase64Text } from "./scrub/base64.ts";
import { isExampleEmail, isExamplePhone } from "./scrub/fakes.ts";
import { KnownSecrets } from "./scrub/known-secrets.ts";
import {
  CANDIDATE_RUN,
  EMAIL,
  hasPhoneLength,
  PHONE,
  PLACEHOLDER,
  TOKEN_SHAPES,
} from "./scrub/patterns.ts";

export type LeakKind = "known-secret" | "fake-key" | "token-shape" | "email" | "phone";

/** Something the safety net found. Names the kind and place, never the value. */
export interface Leak {
  readonly kind: LeakKind;
  /** Character offset in the scanned text. */
  readonly offset: number;
}

/** Every fake key in our tests starts with this (see TOKEN_SHAPES), so it can be found anywhere. */
const FAKE_KEY_MARKER = /^halonic-fake/i;

/**
 * The last check before a recording is saved: scans the finished file text,
 * after scrubbing, for anything that must never be in it. If the list isn't
 * empty, nothing is saved.
 *
 * It looks for the key values the kit added (and their encodings and
 * pieces), the fake-key marker, known token shapes, e-mail addresses and
 * phone numbers, and does the same inside base64 text. It is deliberately
 * separate from the scrubber's rules: it scans the whole file as one string,
 * so it also catches what a rule never looked at.
 */
export function findLeaks(text: string, knownSecrets: readonly string[]): Leak[] {
  const secrets = new KnownSecrets(knownSecrets);
  const leaks = scan(text, secrets);
  for (const run of text.matchAll(CANDIDATE_RUN)) {
    const decoded = decodeBase64Text(run[0]);
    if (decoded !== undefined) {
      // Inside base64, the place is the start of the encoded run.
      leaks.push(...scan(decoded.text, secrets).map((leak) => ({ ...leak, offset: run.index })));
    }
  }
  return leaks.sort((a, b) => a.offset - b.offset);
}

function scan(text: string, secrets: KnownSecrets): Leak[] {
  const leaks: Leak[] = [];
  const add = (kind: LeakKind, offset: number) => leaks.push({ kind, offset });

  for (const range of secrets.find(text)) {
    add("known-secret", range.start);
  }
  for (const shape of TOKEN_SHAPES) {
    for (const match of text.matchAll(shape)) {
      if (!PLACEHOLDER.test(match[0])) {
        add(FAKE_KEY_MARKER.test(match[0]) ? "fake-key" : "token-shape", match.index);
      }
    }
  }
  for (const match of text.matchAll(EMAIL)) {
    if (!isExampleEmail(match[0])) {
      add("email", match.index);
    }
  }
  for (const match of text.matchAll(PHONE)) {
    if (hasPhoneLength(match[0]) && !isExamplePhone(match[0])) {
      add("phone", match.index);
    }
  }
  return leaks;
}
