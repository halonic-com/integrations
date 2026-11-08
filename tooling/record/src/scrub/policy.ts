/**
 * What an integration declares about its own traffic, so the scrubber knows
 * what to remove beyond the rules that apply to everyone.
 *
 * Today an integration passes this as an object. Once the permission sheet
 * (`integration.yaml`) is settled, it gets a `recording:` section with the
 * same fields and the recorder reads it from there.
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
   * Paths use dots for nested fields, `[]` for every item of a list and `*`
   * for any field name, for example `messages[].snippet` or
   * `payload.parts[].body.data`. A form field is just its name. `$` means
   * the whole body.
   */
  readonly userContent: {
    readonly request: readonly string[];
    readonly response: readonly string[];
  };

  /**
   * Content types (without parameters, such as `text/plain`) that may be saved
   * as plain text. Text bodies still go through the key, e-mail and phone
   * rules, but have no field names to go by. Any body that is neither JSON
   * nor form data, and whose type isn't listed here, stops the recording.
   */
  readonly textContentTypes: readonly string[];
}

/** The parts of a policy an integration may leave out. */
export type ScrubPolicyInput = {
  readonly secretHeaders?: readonly string[];
  readonly secretFields?: readonly string[];
  readonly userContent?: {
    readonly request?: readonly string[];
    readonly response?: readonly string[];
  };
  readonly textContentTypes?: readonly string[];
};

/**
 * Fills in the empty defaults, so an integration only writes what applies to
 * it. The defaults are the strictest choice: no text bodies allowed.
 *
 * @example
 * const policy = definePolicy({
 *   secretHeaders: ["x-goog-api-key"],
 *   userContent: { response: ["messages[].snippet", "messages[].payload.body.data"] },
 * });
 */
export function definePolicy(input: ScrubPolicyInput = {}): ScrubPolicy {
  return {
    secretHeaders: (input.secretHeaders ?? []).map((name) => name.toLowerCase()),
    secretFields: input.secretFields ?? [],
    userContent: {
      request: input.userContent?.request ?? [],
      response: input.userContent?.response ?? [],
    },
    textContentTypes: (input.textContentTypes ?? []).map((type) => type.toLowerCase()),
  };
}
