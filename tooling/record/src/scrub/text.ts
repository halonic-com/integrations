import { decodeBase64Text, encodeBase64 } from "./base64.ts";
import type { ScrubContext } from "./context.ts";
import { findEmails } from "./emails.ts";
import { isExampleEmail, isExamplePhone, SECRET } from "./fakes.ts";
import {
  CANDIDATE_RUN,
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
 * 1. base64 text is decoded, scrubbed with all these rules and encoded again.
 *    This comes first, so a key inside a longer encoded value is removed from
 *    the decoded text and the saved value still decodes.
 * 2. known key values (and their encodings and pieces)
 * 3. well-known token formats
 * 4. other random-looking runs
 * 5. e-mail addresses
 * 6. phone numbers
 */
export function scrubText(text: string, where: string, context: ScrubContext, depth = 0): string {
  let result = scrubEncodedText(text, where, context, depth);
  result = replaceKnownSecrets(result, where, context);
  result = replaceTokenShapes(result, where, context);
  result = replaceRandomRuns(result, where, context, depth);
  result = replaceEmails(result, where, context);
  return replacePhones(result, where, context);
}

function scrubEncodedText(
  text: string,
  where: string,
  context: ScrubContext,
  depth: number,
): string {
  return text.replace(CANDIDATE_RUN, (run) => {
    // A run that is exactly an encoded key is left to the known-key rule,
    // which gives it the fixed stand-in the suite looks for.
    if (context.knownSecrets.isWhole(run)) {
      return run;
    }
    const decoded = decodeEncodedText(run, depth);
    if (decoded === undefined) {
      return run;
    }
    // Clean what's inside and keep the encoding, so a test that decodes the
    // field still gets readable (scrubbed) text.
    const scrubbed = scrubText(decoded.text, where, context, depth + 1);
    return scrubbed === decoded.text ? run : encodeBase64(scrubbed, decoded.style);
  });
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

/** Encoded text was already cleaned in step 1, so it is kept here. */
function replaceRandomRuns(
  text: string,
  where: string,
  context: ScrubContext,
  depth: number,
): string {
  return text.replace(CANDIDATE_RUN, (run) => {
    if (decodeEncodedText(run, depth) !== undefined || !looksRandom(run)) {
      return run;
    }
    context.report.add("random-token", where);
    return context.fakes.secret(run);
  });
}

/** The text inside a base64 run, unless we are already as deep as we look. */
function decodeEncodedText(run: string, depth: number): ReturnType<typeof decodeBase64Text> {
  return depth < MAX_DECODE_DEPTH ? decodeBase64Text(run) : undefined;
}

function replaceEmails(text: string, where: string, context: ScrubContext): string {
  let result = "";
  let position = 0;
  for (const { address, index } of findEmails(text)) {
    result += text.slice(position, index) + replaceEmail(address, where, context);
    position = index + address.length;
  }
  return result + text.slice(position);
}

function replaceEmail(address: string, where: string, context: ScrubContext): string {
  if (isExampleEmail(address)) {
    return address;
  }
  context.report.add("email", where);
  return context.fakes.email(address);
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
