// Part of the stand-in host for `pnpm record`. Delete the `host` folder once
// `@halonicjs/integration-kit` is published and record through its
// `createIntegrationHost`.
//
// Mirrors halonic-com/halonic at 25b35b5: `allowedUrl` and `hostIn` from
// `packages/adapters/integration-kit/src/policy.ts`, `isLoopback` and
// `isLocalAddress` from `.../local-address.ts`, and `integrationPolicy` from
// `packages/core/format/src/kinds/integration/policy.ts`, which may read the
// URL with `URL` here. Change the rules there first, then copy them.

import type { RecordValues } from "../command/record-values.ts";
import type { DeclaredPlacement, RecordingSheet, SheetHost } from "../command/sheet.ts";
import { HostRefused } from "./refused.ts";

/** What one integration may do: the kit's `IntegrationPolicy`, without tokens. */
export interface IntegrationPolicy {
  readonly name: string;
  /** Hosts it may call over `https`: a host name, or `host:port` for a port other than 443. */
  readonly hosts: readonly string[];
  /** Hosts the user chose that it may call over plain `http`: on this machine or a private network. */
  readonly localHosts: readonly string[];
  readonly secrets: Readonly<Record<string, DeclaredSecret>>;
}

export interface DeclaredSecret {
  readonly hosts: readonly string[];
  readonly optional: boolean;
  readonly placement: DeclaredPlacement;
}

/**
 * Turns the sheet and the settings into the policy the host enforces. A
 * `{ fromSetting }` host becomes the host of the URL in that setting. Plain
 * `http` is allowed only to this machine or a private network, and a
 * required secret only to this machine.
 *
 * @throws HostRefused when a setting isn't a URL the kit would accept. The message names the setting, never its value.
 */
export function resolvePolicy(sheet: RecordingSheet, values: RecordValues): IntegrationPolicy {
  const hosts: string[] = [];
  const localHosts: string[] = [];
  for (const host of sheet.hosts) {
    const found = resolveHost(sheet, host, values);
    (found.plain ? localHosts : hosts).push(found.host);
  }
  const secrets: Record<string, DeclaredSecret> = {};
  for (const [name, secret] of Object.entries(sheet.secrets)) {
    const secretHosts = secret.hosts.map((host) => {
      const found = resolveHost(sheet, host, values);
      if (found.plain && !secret.optional && !isLoopback(found.hostname)) {
        throw new HostRefused(
          "secret-over-plain-http",
          `${sheet.id}: the secret "${name}" may go over plain http only to this machine`,
        );
      }
      return found.host;
    });
    secrets[name] = {
      hosts: unique(secretHosts),
      optional: secret.optional,
      placement: secret.placement,
    };
  }
  return { name: sheet.id, hosts: unique(hosts), localHosts: unique(localHosts), secrets };
}

interface FoundHost {
  /** As the host matches it: `URL.host`, without the scheme's default port. */
  readonly host: string;
  readonly hostname: string;
  readonly plain: boolean;
}

function resolveHost(sheet: RecordingSheet, host: SheetHost, values: RecordValues): FoundHost {
  if (typeof host === "string") {
    return { host, hostname: host, plain: false };
  }
  const setting = host.fromSetting;
  const url = URL.parse(values.settings[setting] ?? "");
  if (
    url === null ||
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new HostRefused(
      "bad-url",
      `${sheet.id}: the setting "${setting}" must be an http or https URL without a user name or password`,
    );
  }
  const plain = url.protocol === "http:";
  if (plain && !isLocalAddress(url.hostname)) {
    throw new HostRefused(
      "scheme-not-allowed",
      `${sheet.id}: the setting "${setting}" may use plain http only to this machine or a private network address; use https`,
    );
  }
  return { host: url.host, hostname: url.hostname, plain };
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

/**
 * Parses a URL the integration asked for, refusing anything but an allowed
 * `https` host or an allowed local `http` host.
 */
export function allowedUrl(policy: IntegrationPolicy, raw: unknown, base?: URL): URL {
  let url: URL;
  try {
    if (typeof raw !== "string") throw new TypeError("not a string");
    url = new URL(raw, base);
  } catch {
    throw new HostRefused("bad-url", `${policy.name}: the request URL is not a valid absolute URL`);
  }
  const plainLocal =
    url.protocol === "http:" && hostIn(policy.localHosts, url) && isLocalAddress(url.hostname);
  if (url.protocol !== "https:" && !plainLocal) {
    throw new HostRefused(
      "scheme-not-allowed",
      `${policy.name}: only https is allowed, not ${url.protocol.replace(/:$/, "")}`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new HostRefused("bad-url", `${policy.name}: a URL may not carry a user name or password`);
  }
  if (!plainLocal && !hostIn(policy.hosts, url)) {
    throw new HostRefused(
      "host-not-allowed",
      `${policy.name}: ${url.host} is not one of the hosts in its permission sheet`,
    );
  }
  return url;
}

/** Whether the URL's host is in the list, by exact match ignoring case. */
export function hostIn(hosts: readonly string[], url: URL): boolean {
  const host = url.host.toLowerCase();
  return hosts.some((allowed) => allowed.toLowerCase() === host);
}

/** `localhost`, `127.0.0.0/8` or `::1`: the user's own machine. */
export function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "[::1]") return true;
  return ipv4(host)?.[0] === 127;
}

/**
 * Loopback, or a private network address (`10/8`, `172.16/12`,
 * `192.168/16`, IPv6 `fc00::/7`). Link-local addresses don't count:
 * `169.254.169.254` is where cloud machines serve their credentials.
 */
function isLocalAddress(hostname: string): boolean {
  if (isLoopback(hostname)) return true;
  const host = hostname.toLowerCase();
  const v4 = ipv4(host);
  if (v4 !== undefined) {
    const [a = 0, b = 0] = v4;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return /^\[f[cd][0-9a-f]{2}:/.test(host);
}

function ipv4(host: string): readonly number[] | undefined {
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return parts?.slice(1).map(Number);
}
