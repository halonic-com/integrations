/**
 * What an integration declares about its own traffic, so the scrubber knows
 * what to remove beyond the rules that apply to everyone.
 *
 * In `integration.yaml`, `secretHeaders` come from the permission sheet's
 * `secrets` / `auth: { as }` declarations, and the rest from its
 * `recording:` section. The recorder reads both and builds this object.
 */
export interface ScrubPolicy {
  /**
   * Headers that carry a secret for this integration, on top of the standard
   * ones (`authorization`, `cookie`, `x-api-key` and so on). Any casing.
   */
  readonly secretHeaders: readonly string[];

  /**
   * Query parameters, form fields and JSON field names that carry a secret
   * for this integration, on top of the secret-like names every integration
   * gets (`*token*`, `*secret*`, `password`, `key`, `sig` and so on).
   */
  readonly secretFields: readonly string[];

  /**
   * Fields that hold the user's own content (mail bodies, subjects, chat
   * text, file contents). Their values are replaced with placeholders of the
   * same type. The scrubber never guesses these: if a field isn't listed, its
   * text stays (minus keys, e-mail addresses and phone numbers). The only
   * paths it adds by itself are a known service's error text, such as
   * Google's (`service-errors.ts`).
   *
   * Paths start at `request.body` or `response.body`, then use dots for
   * fields, `[*]` for every item of a list, `[n]` for one item and `*` for
   * any field name: `response.body.messages[*].snippet`. A form field is
   * `request.body.<name>`; a stream event's data is `response.body[*].data`.
   * The path `request.body` alone means the whole body.
   *
   * A query parameter of the request URL is `request.query.<name>`, such as
   * `request.query.q` for a search. It names one parameter, without wildcards.
   */
  readonly userContent: readonly string[];

  /**
   * Strings in an event stream that are pieces of one JSON text, such as a
   * streamed tool call's arguments: Anthropic's
   * `response.body[*].data.delta.partial_json` or OpenAI's
   * `response.body[*].data.choices[*].delta.tool_calls[*].function.arguments`.
   * No piece is JSON on its own, so the scrubber joins them first: the whole
   * text goes into the first piece and the others become empty. The
   * `userContent` paths and the other rules then see complete JSON.
   *
   * Pieces belong together when the objects along their path hold the same
   * `index` values: the event's `index` for Anthropic, `choices[*].index`
   * and `tool_calls[*].index` for OpenAI. Paths start at `response.body[*].data`.
   */
  readonly streamedJson: readonly string[];

  /**
   * Content types (without parameters, such as `text/plain`) that may be saved
   * as plain text. Text bodies still go through the key, e-mail and phone
   * rules, but have no field names to go by. Any body that isn't empty, JSON,
   * form data or an event stream, and whose type isn't listed here, stops the
   * recording.
   */
  readonly allowContentTypes: readonly string[];
}

/** The parts of a policy an integration may leave out. */
export type ScrubPolicyInput = {
  readonly [Key in keyof ScrubPolicy]?: ScrubPolicy[Key];
};

/**
 * Fills in the empty defaults, so an integration only writes what applies to
 * it. The defaults are the strictest choice: no text bodies allowed.
 *
 * @example
 * const policy = definePolicy({
 *   secretHeaders: ["x-goog-api-key"],
 *   userContent: ["response.body.messages[*].snippet", "request.body.raw"],
 * });
 */
export function definePolicy(input: ScrubPolicyInput = {}): ScrubPolicy {
  return {
    secretHeaders: (input.secretHeaders ?? []).map((name) => name.toLowerCase()),
    secretFields: input.secretFields ?? [],
    userContent: input.userContent ?? [],
    streamedJson: input.streamedJson ?? [],
    allowContentTypes: (input.allowContentTypes ?? []).map((type) => type.toLowerCase()),
  };
}
