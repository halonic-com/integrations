/**
 * Stable stand-ins for removed values. Within one recording the same input
 * always gets the same stand-in, so a test can still see that the ID in one
 * response is the one sent in the next request.
 *
 * Every stand-in is chosen so that no rule (and not the safety net) treats it
 * as something to remove again:
 * - tokens the service issued become `scrubbed-secret-<n>`: numbered, so a
 *   page token still matches between responses and requests, and URL-safe
 * - e-mail addresses use `example.com`, which is reserved for examples (RFC 2606)
 * - phone numbers use `+44 7700 900xxx`, a UK range reserved for drama (Ofcom)
 *
 * The integration's own keys get the fixed `SECRET` instead: on replay, the
 * conformance suite puts its fake keys back in where it sees it.
 */
export class Fakes {
  private readonly secrets = new Map<string, string>();
  private readonly emails = new Map<string, string>();
  private readonly phones = new Map<string, string>();

  /** The stand-in for a token or other secret value the service issued. */
  secret(value: string): string {
    return remember(this.secrets, value, (n) => `scrubbed-secret-${n}`);
  }

  /** The stand-in for an e-mail address. Case doesn't matter for the match. */
  email(address: string): string {
    return remember(this.emails, address.toLowerCase(), (n) => `person${n}@example.com`);
  }

  /** The stand-in for a phone number. Spacing and punctuation don't matter. */
  phone(number: string): string {
    const digitsOnly = number.replace(/\D/g, "");
    return remember(this.phones, digitsOnly, (n) => `+447700900${String(n).padStart(3, "0")}`);
  }
}

/** The fixed stand-in for the integration's own keys: secret headers, cookies and known key values. */
export const SECRET = "<scrubbed:secret>";

/** The fixed stand-in for user content, by type, so the shape of a body stays valid. */
export const USER_CONTENT = { text: "<scrubbed:content>", number: 0, boolean: false } as const;

function remember(seen: Map<string, string>, key: string, make: (n: number) => string): string {
  const known = seen.get(key);
  if (known !== undefined) {
    return known;
  }
  const fake = make(seen.size + 1);
  seen.set(key, fake);
  return fake;
}

/** True for addresses on the domains reserved for examples, which are never personal. */
export function isExampleEmail(address: string): boolean {
  const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
  const reserved = ["example.com", "example.org", "example.net", "example"];
  return reserved.some((name) => domain === name || domain.endsWith(`.${name}`));
}

/** True for numbers in the reserved drama range our phone stand-ins use. */
export function isExamplePhone(number: string): boolean {
  return number.replace(/\D/g, "").startsWith("447700900");
}
