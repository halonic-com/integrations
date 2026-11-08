import { decodeBase64Text, encodeBase64 } from "./base64.ts";
import type { ScrubContext } from "./context.ts";
import { isExampleEmail, isExamplePhone, SECRET } from "./fakes.ts";
import {
  CANDIDATE_RUN,
  EMAIL,
  hasPhoneLength,
  looksRandom,
  PHONE,
  PLACEHOLDER,
  TOKEN_SHAPES,
} from "./patterns.ts";
import { replaceRanges } from "./text-ranges.ts";

/** How deep we look inside base64 that holds more base64. */
const MAX_DECODE_DEPTH = 2;

/**
 * The rules for free text, used on every string the other rules leave in
 * place: header values, URL parts, JSON strings, form values and text bodies.
 * In order:
 * 1. known key values (and their encodings and pieces)
 * 2. well-known token formats
 * 3. base64 text is decoded, scrubbed and encoded again; other random-looking
 *    runs are removed
 * 4. e-mail addresses
 * 5. phone numbers
 */
export function scrubText(text: string, where: string, context: ScrubContext, depth = 0): string {
  let result = replaceKnownSecrets(text, where, context);
  result = replaceTokenShapes(result, where, context);
  result = replaceCandidateRuns(result, where, context, depth);
  result = replaceEmails(result, where, context);
  return replacePhones(result, where, context);
}

function replaceKnownSecrets(text: string, where: string, context: ScrubContext): string {
  return replaceRanges(text, context.knownSecrets.find(text), () => {
    context.report.add("known-secret", where);
    return SECRET;
  });
}

function replaceTokenShapes(text: string, where: string, context: ScrubContext): string {
  let result = text;
  for (const shape of TOKEN_SHAPES) {
    result = result.replace(shape, (token) => {
      if (PLACEHOLDER.test(token)) {
        return token;
      }
      context.report.add("token-shape", where);
      return context.fakes.secret(token);
    });
  }
  return result;
}

function replaceCandidateRuns(
  text: string,
  where: string,
  context: ScrubContext,
  depth: number,
): string {
  return text.replace(CANDIDATE_RUN, (run) => {
    const decoded = depth < MAX_DECODE_DEPTH ? decodeBase64Text(run) : undefined;
    if (decoded !== undefined) {
      // Encoded text: clean what's inside and keep the encoding, so a test
      // that decodes the field still gets readable (scrubbed) text.
      const scrubbed = scrubText(decoded.text, where, context, depth + 1);
      return scrubbed === decoded.text ? run : encodeBase64(scrubbed, decoded.style);
    }
    if (looksRandom(run)) {
      context.report.add("random-token", where);
      return context.fakes.secret(run);
    }
    return run;
  });
}

function replaceEmails(text: string, where: string, context: ScrubContext): string {
  return text.replace(EMAIL, (address) => {
    if (isExampleEmail(address)) {
      return address;
    }
    context.report.add("email", where);
    return context.fakes.email(address);
  });
}

function replacePhones(text: string, where: string, context: ScrubContext): string {
  return text.replace(PHONE, (number) => {
    if (!hasPhoneLength(number) || isExamplePhone(number)) {
      return number;
    }
    context.report.add("phone", where);
    return context.fakes.phone(number);
  });
}
