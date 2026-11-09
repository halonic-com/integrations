import { scrubBody } from "../scrub/body.ts";
import type { JsonValue, RecordedBody, RecordedRequest } from "../scrub/exchange.ts";
import { USER_CONTENT } from "../scrub/fakes.ts";
import { parseNestedJson } from "../scrub/json.ts";
import type { ScrubPolicy } from "../scrub/policy.ts";
import { responseUserContent } from "../scrub/service-errors.ts";
import { shown } from "./compare-text.ts";
import { firstDifference } from "./compare-value.ts";
import { asReplayError, replayContext } from "./replay-context.ts";

/** Where a response place is reported from, in the same terms as a `userContent` path. */
const BODY = "response.body";

/**
 * Checks that a recorded response still matches the integration's policy.
 *
 * The replay gives the recorded response back as it is, so without this
 * check a test passes whatever the sheet declares about responses. Two
 * things are checked:
 * - scrubbing the response again with the policy changes nothing, so every
 *   path the sheet declares was scrubbed when it was recorded
 * - every text placeholder in the response sits at a path the policy
 *   declares, so a response path taken out of the sheet fails a test
 *
 * Only text placeholders can be found: the ones for numbers and booleans
 * (`0` and `false`) look like any other value.
 */
export class ResponseBodies {
  private readonly policy: ScrubPolicy;

  constructor(policy: ScrubPolicy) {
    this.policy = policy;
  }

  /** Throws when the recorded response of `request` doesn't match the policy. */
  check(request: RecordedRequest, response: RecordedBody): void {
    // Its own context, so its report holds this response's places only.
    const context = replayContext(this.policy);
    const declared = responseUserContent(this.policy, request.url, response);
    let scrubbed: RecordedBody;
    try {
      scrubbed = scrubBody(response, BODY, declared, context);
    } catch (error) {
      throw asReplayError("recorded response body", error);
    }
    const difference = firstDifference(contentOf(response), contentOf(scrubbed), BODY);
    if (difference !== undefined) {
      throw new Error(
        `The recorded response doesn't match the recording policy at ${difference.path}: the policy scrubs ${shown(difference.recorded)} to ${shown(difference.other)}. Record the scenario again.`,
      );
    }
    const declaredPlaces = context.report
      .build([])
      .replacements.filter(({ rule }) => rule === "user-content")
      .map(({ where }) => where);
    const undeclared = placeholderPlaces(response).find(
      (place) => !declaredPlaces.some((declaredPlace) => isWithin(place, declaredPlace)),
    );
    if (undeclared !== undefined) {
      throw new Error(
        `The recorded response has user content at ${undeclared}, which the recording policy doesn't declare. Add its path to recording.userContent in the sheet.`,
      );
    }
  }
}

/** What a body holds, for comparing two bodies of the same kind. */
function contentOf(body: RecordedBody): unknown {
  return body.kind === "empty" ? undefined : body.value;
}

/** Where a body has the text placeholder for user content, in the places the scrub report uses. */
function placeholderPlaces(body: RecordedBody): string[] {
  switch (body.kind) {
    case "empty":
      return [];
    case "text":
      return body.value === USER_CONTENT.text ? [BODY] : [];
    case "form":
      return body.value
        .filter(([, value]) => value === USER_CONTENT.text)
        .map(([name]) => `${BODY}.${name}`);
    case "json":
      return jsonPlaceholderPlaces(body.value, BODY);
    case "sse":
      return body.value.flatMap(({ data }, index) =>
        jsonPlaceholderPlaces(data, `${BODY}[${index}].data`),
      );
  }
}

/** Like `scrubJson`, this goes on inside a string that holds JSON, at the same place. */
function jsonPlaceholderPlaces(value: JsonValue, place: string): string[] {
  if (typeof value === "string") {
    if (value === USER_CONTENT.text) {
      return [place];
    }
    const nested = parseNestedJson(value);
    return nested === undefined ? [] : jsonPlaceholderPlaces(nested, place);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => jsonPlaceholderPlaces(item, `${place}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([name, child]) =>
      jsonPlaceholderPlaces(child, `${place}.${name}`),
    );
  }
  return [];
}

/** True when `place` is `declared` or inside it: a declared object is replaced whole. */
function isWithin(place: string, declared: string): boolean {
  return place === declared || place.startsWith(`${declared}.`) || place.startsWith(`${declared}[`);
}
