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
   * text stays (minus keys, e-mail addresses and phone numbers).
   *
   * Paths start at `request.body` or `response.body`, then use dots for
   * fields, `[*]` for every item of a list, `[n]` for one item and `*` for
   * any field name: `response.body.messages[*].snippet`. A form field is
   * `request.body.<name>`; a stream event's data is `response.body[*].data`.
   * The path `request.body` alone means the whole body.
   */
  readonly userContent: readonly string[];

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
    allowContentTypes: (input.allowContentTypes ?? []).map((type) => type.toLowerCase()),
  };
}
