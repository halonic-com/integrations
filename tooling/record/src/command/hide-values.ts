/** What a hidden value is shown as. */
export const HIDDEN = "<hidden>";

/**
 * Removes the key and setting values from text before it is printed: an
 * error message or stack trace can quote a request, a header or a URL.
 * Each value is removed as written and URL-encoded, and a URL setting's
 * host is removed too, because a message about a request names its host.
 *
 * @example
 * hideValues(`401 for key ${key}`, [key]); // "401 for key <hidden>"
 */
export function hideValues(text: string, values: readonly string[]): string {
  const forms = new Set<string>();
  for (const value of values) {
    forms.add(value);
    forms.add(encodeURIComponent(value));
    const url = URL.parse(value);
    if (url !== null && url.host !== "") {
      forms.add(url.host);
      forms.add(url.hostname);
    }
  }
  // Longest first, so a value inside another is never left half removed.
  const ordered = [...forms].filter((form) => form !== "").sort((a, b) => b.length - a.length);
  let hidden = text;
  for (const form of ordered) {
    hidden = hidden.replaceAll(form, HIDDEN);
  }
  return hidden;
}

/** An error as text with its stack and causes, for a person to read once the values are hidden. */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const own = error.stack ?? `${error.name}: ${error.message}`;
  return error.cause === undefined ? own : `${own}\nCaused by: ${errorText(error.cause)}`;
}
