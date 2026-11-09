/**
 * Reads `advisories-ignored.json`, the only place a security advisory may be
 * ignored. Strict like the other config files: an unknown field, a missing
 * reason, a bad date or a repeated advisory is a problem, and so is an entry
 * that has expired or expires too far out.
 */

/** One deliberately ignored advisory. */
export interface IgnoredAdvisory {
  /** The GitHub advisory ID, which `pnpm audit --ignore` takes. */
  readonly ghsa: string;
  readonly cve?: string;
  readonly package: string;
  readonly reason: string;
  /** A calendar day, `YYYY-MM-DD`. The entry still holds on this day. */
  readonly expires: string;
}

/** The longest an entry may run, counted from the day it is checked. */
export const maxIgnoreDays = 90;

const known = ["ghsa", "package", "reason", "expires"];
const optional = ["cve"];
const ghsaId = /^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/;
const cveId = /^CVE-\d{4}-\d{4,}$/;
const minReasonLength = 20;
const dayMs = 86_400_000;

/** `YYYY-MM-DD` of a date in UTC. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A real calendar day as a UTC time, or `undefined` for text such as `2026-02-30`. */
function parseDay(text: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return undefined;
  }
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isNaN(time) || isoDay(new Date(time)) !== text ? undefined : time;
}

/** The entries of the file and everything wrong with it. Without a problem, `entries` is complete. */
export interface AdvisoryReading {
  readonly entries: readonly IgnoredAdvisory[];
  readonly problems: readonly string[];
}

/**
 * Reads the file text and checks every entry against `today`.
 *
 * @example
 * readAdvisories(text, new Date()).problems; // [] when every entry is valid and current
 */
export function readAdvisories(text: string, today: Date): AdvisoryReading {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { entries: [], problems: ["the file isn't valid JSON"] };
  }
  const file = asRecord(value);
  if (file === undefined || !Array.isArray(file["ignored"])) {
    return { entries: [], problems: ['the file must be an object with an "ignored" list'] };
  }
  const problems: string[] = [];
  const unknownTop = Object.keys(file).find((key) => key !== "ignored" && key !== "//");
  if (unknownTop !== undefined) {
    problems.push(`"${unknownTop}" is not a known setting (known: ignored)`);
  }
  const entries: IgnoredAdvisory[] = [];
  const seen = new Set<string>();
  (file["ignored"] as unknown[]).forEach((raw, index) => {
    const entry = readEntry(raw, `ignored[${index}]`, today, problems);
    if (entry === undefined) {
      return;
    }
    if (seen.has(entry.ghsa)) {
      problems.push(`ignored[${index}] repeats ${entry.ghsa}`);
    }
    seen.add(entry.ghsa);
    entries.push(entry);
  });
  return { entries, problems };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readEntry(
  raw: unknown,
  at: string,
  today: Date,
  problems: string[],
): IgnoredAdvisory | undefined {
  const record = asRecord(raw);
  if (record === undefined) {
    problems.push(`${at} must be an object`);
    return undefined;
  }
  const before = problems.length;
  for (const key of Object.keys(record)) {
    if (key !== "//" && !known.includes(key) && !optional.includes(key)) {
      problems.push(
        `${at}.${key} is not a known field (known: ${[...known, ...optional].join(", ")})`,
      );
    }
  }
  const text = (key: string): string => {
    const field = record[key];
    if (typeof field !== "string" || field.trim() === "") {
      problems.push(`${at}.${key} is missing or not a non-empty string`);
      return "";
    }
    return field;
  };
  const ghsa = text("ghsa");
  if (ghsa !== "" && !ghsaId.test(ghsa)) {
    problems.push(`${at}.ghsa "${ghsa}" must look like GHSA-xxxx-xxxx-xxxx`);
  }
  if (record["cve"] !== undefined && !cveId.test(String(record["cve"]))) {
    problems.push(`${at}.cve must look like CVE-2026-12345`);
  }
  const packageName = text("package");
  const reason = text("reason");
  if (reason !== "" && reason.trim().length < minReasonLength) {
    problems.push(
      `${at}.reason must explain the decision (at least ${minReasonLength} characters)`,
    );
  }
  const expires = text("expires");
  if (expires !== "") {
    checkExpiry(`${at}.expires`, ghsa, expires, today, problems);
  }
  if (problems.length > before) {
    return undefined;
  }
  return {
    ghsa,
    ...(record["cve"] === undefined ? {} : { cve: String(record["cve"]) }),
    package: packageName,
    reason,
    expires,
  };
}

function checkExpiry(
  at: string,
  ghsa: string,
  expires: string,
  today: Date,
  problems: string[],
): void {
  const time = parseDay(expires);
  if (time === undefined) {
    problems.push(`${at} "${expires}" must be a real day written YYYY-MM-DD`);
    return;
  }
  const days = Math.round((time - Date.parse(`${isoDay(today)}T00:00:00Z`)) / dayMs);
  if (days < 0) {
    problems.push(
      `${at} ${expires} has passed, so ${ghsa} is no longer ignored. Fix or update the dependency, or renew the entry with a new reason and date.`,
    );
  } else if (days > maxIgnoreDays) {
    problems.push(
      `${at} ${expires} is ${days} days out; at most ${maxIgnoreDays} days are allowed`,
    );
  }
}
