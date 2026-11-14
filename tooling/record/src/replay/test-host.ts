import type {
  IntegrationHost,
  IntegrationHttpClient,
  TokenStore,
} from "@halonicjs/adapters/integration-kit";

/*
 * The parts of a kit host that integration tests build around a replay or a
 * fake. Exported from `@halonicjs/tooling-record/replay`.
 */

/**
 * A client that answers every request with `status` and `body`, for error
 * paths that recordings can't show, such as a body that isn't JSON.
 */
export function fakeResponse(status: number, body: string): IntegrationHttpClient {
  return {
    fetch: async () => new Response(new TextEncoder().encode(body), { status }),
  };
}

/** Refuses every token call, for integrations that keep no tokens. */
const noTokens: TokenStore = {
  get: () => Promise.reject(new Error("This test host keeps no tokens.")),
  set: () => Promise.reject(new Error("This test host keeps no tokens.")),
  remove: () => Promise.reject(new Error("This test host keeps no tokens.")),
};

/**
 * A whole kit host around a client, for tests that call `connect`. The host
 * keeps no tokens and doesn't wait, unless the test gives a `wait`.
 */
export function testHost(
  http: IntegrationHttpClient,
  { settings = {}, wait = async () => {} }: TestHostOptions = {},
): IntegrationHost {
  return { http, wait, tokens: noTokens, settings };
}

/** What a test may set on {@link testHost}. */
export interface TestHostOptions {
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly wait?: IntegrationHost["wait"];
}
