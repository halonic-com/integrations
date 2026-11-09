// Part of the stand-in host for `pnpm record`; see `policy.ts`. Mirrors
// halonic `packages/adapters/integration-kit/src/secret-placement.ts` at
// 25b35b5, without `form`, which no sheet uses yet: `copyPlacements`,
// `checkPlacements`, `readSecrets` and `place`.

import type { DeclaredPlacement } from "../command/sheet.ts";
import { hostIn, type IntegrationPolicy, isLoopback } from "./policy.ts";
import { HostRefused } from "./refused.ts";

/** Where the integration's code asks the host to put a secret. */
export type SecretPlacement =
  | { readonly secret: string; readonly as: "bearer" }
  | {
      readonly secret: string;
      readonly as: "header";
      readonly header: string;
      readonly prefix?: string;
    };

/** A placement as the integration's code may give it, with nothing trusted. */
interface GivenPlacement {
  readonly secret?: unknown;
  readonly as?: unknown;
  readonly header?: unknown;
  readonly prefix?: unknown;
}

/**
 * Copies the placements the code gave into frozen objects of text fields,
 * reading each field once, so the code can't change them after the check.
 */
export function copyPlacements(
  policy: IntegrationPolicy,
  placements: readonly unknown[],
): readonly SecretPlacement[] {
  return Object.freeze(placements.map((placement) => copyPlacement(policy, placement)));
}

function copyPlacement(policy: IntegrationPolicy, placement: unknown): SecretPlacement {
  if (typeof placement !== "object" || placement === null) {
    throw notText(policy, "a secret placement");
  }
  const given: GivenPlacement = placement;
  const secret = given.secret;
  const as = given.as;
  if (typeof secret !== "string") throw notText(policy, "the secret's name");
  if (typeof as !== "string") throw notText(policy, `the "as" of the secret "${secret}"`);
  const copy: Record<string, string> = { secret, as };
  for (const key of ["header", "prefix"] as const) {
    const value = given[key];
    if (value === undefined) continue;
    if (typeof value !== "string") throw notText(policy, `the "${key}" of the secret "${secret}"`);
    copy[key] = value;
  }
  return Object.freeze(copy) as unknown as SecretPlacement;
}

function notText(policy: IntegrationPolicy, what: string): HostRefused {
  return new HostRefused(
    "placement-not-in-sheet",
    `${policy.name}: ${what} in a secret placement is not text`,
  );
}

/** Checks every placement against the sheet before anything is sent. */
export function checkPlacements(
  policy: IntegrationPolicy,
  placements: readonly SecretPlacement[],
  url: URL,
): void {
  for (const placement of placements) {
    const declared = Object.hasOwn(policy.secrets, placement.secret)
      ? policy.secrets[placement.secret]
      : undefined;
    if (declared === undefined) {
      throw new HostRefused(
        "secret-not-declared",
        `${policy.name}: the secret "${placement.secret}" is not in its permission sheet`,
      );
    }
    if (!matchesSheet(placement, declared.placement)) {
      throw new HostRefused(
        "placement-not-in-sheet",
        `${policy.name}: the secret "${placement.secret}" goes ${describe(declared.placement)} in its permission sheet, not ${describe(placement)}`,
      );
    }
    if (!hostIn(declared.hosts, url)) {
      throw new HostRefused(
        "secret-not-allowed-for-host",
        `${policy.name}: the secret "${placement.secret}" may not go to ${url.host}`,
      );
    }
    if (!mayCarrySecret(url)) {
      throw new HostRefused(
        "secret-over-plain-http",
        `${policy.name}: the secret "${placement.secret}" may not go over plain http to another machine (${url.host})`,
      );
    }
  }
}

/**
 * Whether the code places the secret the way the sheet says. Header names
 * match ignoring ASCII case; a missing prefix and `""` send the same bytes.
 */
function matchesSheet(placement: SecretPlacement, sheet: DeclaredPlacement): boolean {
  switch (sheet.as) {
    case "bearer":
      return placement.as === "bearer";
    case "header":
      return (
        placement.as === "header" &&
        typeof placement.header === "string" &&
        asciiLowerCase(placement.header) === asciiLowerCase(sheet.header) &&
        (placement.prefix ?? "") === (sheet.prefix ?? "")
      );
  }
}

/** Lower-cases `A` to `Z` only, so the Kelvin sign doesn't pass as `k`. */
function asciiLowerCase(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** A placement in words, for a refusal message. It never holds a value. */
function describe(placement: DeclaredPlacement | SecretPlacement): string {
  switch (placement.as) {
    case "bearer":
      return "as a bearer token";
    case "header": {
      const prefix = placement.prefix ?? "";
      return prefix === ""
        ? `in the header ${quoted(placement.header)}`
        : `in the header ${quoted(placement.header)} after ${quoted(prefix)}`;
    }
    default:
      return `as ${quoted((placement as { as: unknown }).as)}`;
  }
}

/** Text from the integration's code, cut short and quoted, so it can't break the message. */
function quoted(text: unknown): string {
  const characters = Array.from(String(text));
  const shown =
    characters.length <= 50 ? characters.join("") : `${characters.slice(0, 50).join("")}…`;
  return JSON.stringify(shown);
}

/** A secret goes over `https`, or over plain `http` only to this machine. */
function mayCarrySecret(url: URL): boolean {
  return url.protocol === "https:" || isLoopback(url.hostname);
}

/**
 * Reads each secret's value once. An optional secret without a value gets
 * no entry, so `place` leaves it out.
 */
export function readSecrets(
  policy: IntegrationPolicy,
  secrets: ReadonlyMap<string, string>,
  placements: readonly SecretPlacement[],
): Map<string, string> {
  const values = new Map<string, string>();
  for (const { secret } of placements) {
    if (values.has(secret)) continue;
    const value = secrets.get(secret);
    if (value === undefined || value === "") {
      if (policy.secrets[secret]?.optional === true) continue;
      throw new HostRefused(
        "secret-not-configured",
        `${policy.name}: the secret "${secret}" is not configured`,
      );
    }
    values.set(secret, value);
  }
  return values;
}

/**
 * Puts the secrets allowed for this hop's host into the headers. A
 * placement whose secret may not go to this hop is left out, which happens
 * after a redirect to another declared host.
 */
export function place(
  policy: IntegrationPolicy,
  placements: readonly SecretPlacement[],
  values: ReadonlyMap<string, string>,
  url: URL,
  headers: Headers,
): void {
  for (const placement of placements) {
    const declared = policy.secrets[placement.secret];
    const value = values.get(placement.secret);
    if (
      declared === undefined ||
      value === undefined ||
      !hostIn(declared.hosts, url) ||
      !mayCarrySecret(url)
    )
      continue;
    switch (placement.as) {
      case "bearer":
        headers.set("authorization", `Bearer ${value}`);
        break;
      case "header":
        headers.set(placement.header, `${placement.prefix ?? ""}${value}`);
        break;
    }
  }
}
