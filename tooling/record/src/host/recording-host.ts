// The stand-in host for `pnpm record`, until `@halonicjs/integration-kit` is
// published. Delete this folder then, and record through the kit's
// `createIntegrationHost` with the recording transport underneath.
//
// Mirrors `createLimitedHttpClient` in halonic
// `packages/adapters/integration-kit/src/limited-http.ts` at 25b35b5: the same
// URL and placement checks, in the same order, and the same redirect rules.
// The kit's timeouts, size limits and response secret filter are left out:
// they protect a running workspace, and the scrubber and its safety net
// protect the recording. `wait` mirrors `wait.ts`. There are no tokens,
// because no sheet declares any yet.

import type { RecordValues } from "../command/record-values.ts";
import type { RecordingSheet } from "../command/sheet.ts";
import type { HttpTransport } from "../recording/recording-transport.ts";
import { allowedUrl, type IntegrationPolicy, resolvePolicy } from "./policy.ts";
import { HostRefused } from "./refused.ts";
import {
  checkPlacements,
  copyPlacements,
  place,
  readSecrets,
  type SecretPlacement,
} from "./secret-placement.ts";

/** What an integration may send: the Web `RequestInit`, plus where the host puts secrets. */
export interface IntegrationRequestInit extends RequestInit {
  readonly auth?: SecretPlacement | readonly SecretPlacement[];
}

/** What the integration's `connect` gets. The integrations' own `kit.ts` copies name parts of it. */
export interface IntegrationHost {
  readonly http: { fetch(url: string, init?: IntegrationRequestInit): Promise<Response> };
  readonly settings: Readonly<Record<string, unknown>>;
  wait(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface RecordingHost {
  readonly host: IntegrationHost;
  /**
   * Every refusal so far, in order, including ones the integration caught.
   * Any refusal fails the recording: the scenario asked for something the
   * sheet doesn't allow.
   */
  refusals(): readonly HostRefused[];
}

/** The longest `wait`, as `maxIntegrationWaitMs` in halonic's ports. */
const maxWaitMs = 30_000;
const maxRedirects = 5;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
/** Headers a browser drops when a redirect leaves the origin; the kit does the same. */
const originBoundHeaders = ["authorization", "cookie", "proxy-authorization"];

/**
 * Builds the host for one recording. It places keys only as the sheet says
 * and calls only the sheet's hosts, through `transport`.
 *
 * @throws HostRefused when a `{ fromSetting }` host's setting isn't a URL the kit accepts
 *
 * @example
 * const recording = createRecordingTransport({ fetch });
 * const { host, refusals } = createRecordingHost(sheet, values, recording.transport);
 */
export function createRecordingHost(
  sheet: RecordingSheet,
  values: RecordValues,
  transport: HttpTransport,
): RecordingHost {
  const policy = resolvePolicy(sheet, values);
  const refusals: HostRefused[] = [];
  const http = {
    async fetch(url: string, init: IntegrationRequestInit = {}) {
      try {
        return await send(policy, values.secrets, transport, url, init);
      } catch (error) {
        if (error instanceof HostRefused) refusals.push(error);
        throw error;
      }
    },
  };
  const host: IntegrationHost = Object.freeze({
    http: Object.freeze(http),
    settings: Object.freeze({ ...values.settings }),
    wait,
  });
  return { host, refusals: () => [...refusals] };
}

/** The parts of a request that change from one redirect hop to the next. */
interface Hop {
  url: URL;
  method: string;
  body: NonNullable<RequestInit["body"]> | null;
  readonly placements: readonly SecretPlacement[];
  readonly headers: Headers;
}

async function send(
  policy: IntegrationPolicy,
  secrets: ReadonlyMap<string, string>,
  transport: HttpTransport,
  rawUrl: string,
  init: IntegrationRequestInit,
): Promise<Response> {
  const { auth, redirect: _redirect, ...rest } = init;
  // From here on only the frozen copies are read, never the code's `auth`.
  const placements = copyPlacements(policy, auth === undefined ? [] : [auth].flat());
  const url = allowedUrl(policy, rawUrl);
  checkPlacements(policy, placements, url);
  const values = readSecrets(policy, secrets, placements);
  const hop: Hop = {
    url,
    method: (init.method ?? "GET").toUpperCase(),
    body: rest.body ?? null,
    placements,
    headers: new Headers(rest.headers),
  };

  for (let count = 0; ; count++) {
    const headers = new Headers(hop.headers);
    place(policy, hop.placements, values, hop.url, headers);
    const response = await transport.fetch(hop.url.href, {
      ...rest,
      method: hop.method,
      headers,
      body: hop.body,
      redirect: "manual",
    });
    const location = response.headers.get("location");
    if (!redirectStatuses.has(response.status) || location === null) {
      return response;
    }
    await response.body?.cancel();
    if (count >= maxRedirects) {
      throw new HostRefused(
        "too-many-redirects",
        `${policy.name}: ${hop.url.host}${hop.url.pathname} redirected more than ${maxRedirects} times`,
      );
    }
    follow(hop, response.status, allowedUrl(policy, location, hop.url));
  }
}

/** Moves the hop on to an allowed redirect target, the way `fetch` does. */
function follow(hop: Hop, status: number, next: URL): void {
  if (next.origin !== hop.url.origin) {
    for (const name of originBoundHeaders) hop.headers.delete(name);
  }
  const toGet = status === 303 || ((status === 301 || status === 302) && hop.method === "POST");
  if (toGet) {
    hop.method = hop.method === "HEAD" ? "HEAD" : "GET";
    hop.body = null;
    hop.headers.delete("content-type");
    hop.headers.delete("content-length");
  }
  hop.url = next;
}

/** Waits `ms`, at most 30 s, and rejects with the signal's reason as soon as it aborts. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const clamped = Number.isNaN(ms) || ms <= 0 ? 0 : Math.min(ms, maxWaitMs);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, clamped);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
