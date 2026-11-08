import { decodeBase64Text } from "../scrub/base64.ts";
import { isExampleEmail, isExamplePhone } from "../scrub/fakes.ts";
import { KnownSecrets } from "../scrub/known-secrets.ts";
import {
  CANDIDATE_RUN,
  EMAIL,
  hasPhoneLength,
  PHONE,
  PLACEHOLDER,
  TOKEN_SHAPES,
} from "../scrub/patterns.ts";
import { decodePercentText, PERCENT_ENCODED_RUN } from "./percent-encoding.ts";
import { findSecretFields } from "./secret-fields.ts";

/** What the text scan finds, at a character offset. */
export type TextLeakKind = "known-secret" | "fake-key" | "token-shape" | "email" | "phone";

/** Something the safety net found. Names the kind and place, never the value. */
export type Leak =
  | {
      readonly kind: TextLeakKind;
      /** Character offset in the scanned text. */
      readonly offset: number;
    }
  | {
      /** A value under a secret name that isn't a stand-in. */
      readonly kind: "secret-field";
      /** Where in the file, such as `exchanges[0].request.headers.x-access-token`. */
      readonly path: string;
    };

export type LeakKind = Leak["kind"];

/** Every fake key in our tests starts with this (see TOKEN_SHAPES), so it can be found anywhere. */
const FAKE_KEY_MARKER = /^halonic-fake/i;

/**
 * The last check before a recording is saved: scans the finished file text,
 * after scrubbing, for anything that must never be in it. If the list isn't
 * empty, nothing is saved.
 *
 * It looks for the key values the kit added (and their encodings and
 * pieces), the fake-key marker, known token shapes, e-mail addresses and
 * phone numbers, and does the same inside base64 text and URL-encoded text
 * (`from%3Aperson%40mail.test` in a query string). It is deliberately
 * separate from the scrubber's rules: it scans the whole file as one string,
 * so it also catches what a rule never looked at. Then it reads the file and
 * checks that every value under a secret name is a stand-in.
 */
export function findLeaks(text: string, knownSecrets: readonly string[]): Leak[] {
  const fieldLeaks = findSecretFields(text).map((path): Leak => ({ kind: "secret-field", path }));
  return [...scanText(text, knownSecrets), ...fieldLeaks];
}

/** Text leaks in the order they appear. */
function scanText(text: string, knownSecrets: readonly string[]): TextLeak[] {
  const secrets = new KnownSecrets(knownSecrets);
  const leaks = scan(text, secrets);
  for (const run of text.matchAll(CANDIDATE_RUN)) {
    const decoded = decodeBase64Text(run[0]);
    if (decoded !== undefined) {
      // Inside base64, the place is the start of the encoded run.
      leaks.push(...scan(decoded.text, secrets).map((leak) => ({ ...leak, offset: run.index })));
    }
  }
  leaks.push(...scanPercentEncoded(text, secrets, leaks));
  return leaks.sort((a, b) => a.offset - b.offset);
}

/**
 * Leaks that only show once URL-encoded text is decoded, such as an address
 * whose `@` is written `%40`. The place is the start of the encoded run. A
 * kind the plain scan already found inside the run isn't counted again.
 */
function scanPercentEncoded(
  text: string,
  secrets: KnownSecrets,
  plainLeaks: readonly TextLeak[],
): TextLeak[] {
  const leaks: TextLeak[] = [];
  for (const run of text.matchAll(PERCENT_ENCODED_RUN)) {
    const start = run.index;
    const end = start + run[0].length;
    const foundPlain = new Set(
      plainLeaks
        .filter((leak) => leak.offset >= start && leak.offset < end)
        .map((leak) => leak.kind),
    );
    for (const leak of scan(decodePercentText(run[0]), secrets)) {
      if (!foundPlain.has(leak.kind)) {
        foundPlain.add(leak.kind);
        leaks.push({ kind: leak.kind, offset: start });
      }
    }
  }
  return leaks;
}

type TextLeak = Extract<Leak, { offset: number }>;

function scan(text: string, secrets: KnownSecrets): TextLeak[] {
  const leaks: TextLeak[] = [];
  const add = (kind: TextLeakKind, offset: number) => leaks.push({ kind, offset });

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
