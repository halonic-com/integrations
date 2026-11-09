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
 *
 * Example addresses and drama numbers the traffic already has are kept as
 * they are, and may look like a stand-in (`person2@example.com`). Pass them
 * in as `kept`, or mark them with `keepEmail` and `keepPhone`, and no other
 * value gets the same stand-in: their numbers are skipped.
 */
export class Fakes {
  private readonly secrets = new StandIns((n) => `scrubbed-secret-${n}`);
  private readonly emails = new StandIns((n) => `person${n}@example.com`);
  private readonly phones = new StandIns((n) => `+447700900${String(n).padStart(3, "0")}`);

  constructor(kept: KeptExamples = { emails: [], phones: [] }) {
    for (const address of kept.emails) {
      this.keepEmail(address);
    }
    for (const number of kept.phones) {
      this.keepPhone(number);
    }
  }

  /** The stand-in for a token or other secret value the service issued. */
  secret(value: string): string {
    return this.secrets.for(value);
  }

  /** The stand-in for an e-mail address. Case doesn't matter for the match. */
  email(address: string): string {
    return this.emails.for(address.toLowerCase());
  }

  /** The stand-in for a phone number. Spacing and punctuation don't matter. */
  phone(number: string): string {
    return this.phones.for(digitsOnly(number));
  }

  /** Notes an example address the recording keeps, so no other address gets it as a stand-in. */
  keepEmail(address: string): void {
    this.emails.take(address.toLowerCase());
  }

  /** Notes a drama number the recording keeps, so no other number gets it as a stand-in. */
  keepPhone(number: string): void {
    this.phones.take(`+${digitsOnly(number)}`);
  }

  /** The example values noted so far, for a `Fakes` that numbers the same recording again. */
  kept(): KeptExamples {
    return { emails: [...this.emails.taken], phones: [...this.phones.taken] };
  }
}

/** Example values a recording keeps as they are. */
export interface KeptExamples {
  readonly emails: readonly string[];
  readonly phones: readonly string[];
}

/** Numbered stand-ins of one kind: the same value always gets the same one, and a taken one is skipped. */
class StandIns {
  private readonly byValue = new Map<string, string>();
  readonly taken = new Set<string>();
  private readonly make: (n: number) => string;
  private next = 1;

  constructor(make: (n: number) => string) {
    this.make = make;
  }

  for(value: string): string {
    const known = this.byValue.get(value);
    if (known !== undefined) {
      return known;
    }
    let standIn = this.make(this.next++);
    while (this.taken.has(standIn)) {
      standIn = this.make(this.next++);
    }
    this.byValue.set(value, standIn);
    return standIn;
  }

  /**
   * Marks a value that is kept as it is, so no later value gets it. A stand-in
   * this instance gave out itself may be marked too; that only skips a number.
   */
  take(value: string): void {
    this.taken.add(value);
  }
}

function digitsOnly(number: string): string {
  return number.replace(/\D/g, "");
}

/** The fixed stand-in for the integration's own keys: secret headers, cookies and known key values. */
export const SECRET = "<scrubbed:secret>";

/** The fixed stand-in for user content, by type, so the shape of a body stays valid. */
export const USER_CONTENT = { text: "<scrubbed:content>", number: 0, boolean: false } as const;

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
