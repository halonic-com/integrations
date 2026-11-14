import type {
  IntegrationHost,
  IntegrationHttpClient,
  TokenStore,
} from "@halonicjs/adapters/integration-kit";
import type { ReplayHttpClient } from "@halonicjs/tooling-record/replay";

/**
 * A replay's or a fake's client as the kit's client.
 *
 * The replay answers with only the parts of a `Response` Gemini reads
 * (`ok`, `status`, `headers.get`, `body` and `json`), and Gemini sends only
 * string bodies and plain header objects. So the replay stands in for the
 * kit's client, which is what the one cast below says.
 */
export function kitHttp(http: ReplayHttpClient): IntegrationHttpClient {
  return http as unknown as IntegrationHttpClient;
}

/** Gemini keeps no tokens, so a test host refuses every token call. */
const noTokens: TokenStore = {
  get: () => Promise.reject(new Error("Gemini keeps no tokens.")),
  set: () => Promise.reject(new Error("Gemini keeps no tokens.")),
  remove: () => Promise.reject(new Error("Gemini keeps no tokens.")),
};

/** A whole kit host around a replay's client, for tests that call `gemini.connect`. */
export function hostFor(http: ReplayHttpClient): IntegrationHost {
  return { http: kitHttp(http), wait: async () => {}, tokens: noTokens, settings: {} };
}
