import type { IntegrationHost, TokenStore } from "@halonicjs/adapters/integration-kit";
import type { GoogleHost } from "@halonicjs/integration-tool-google-shared";

/** Drive keeps no tokens, so a test host refuses every token call. */
const noTokens: TokenStore = {
  get: () => Promise.reject(new Error("Drive keeps no tokens.")),
  set: () => Promise.reject(new Error("Drive keeps no tokens.")),
  remove: () => Promise.reject(new Error("Drive keeps no tokens.")),
};

/**
 * A whole kit host around the part Drive uses (`http` and `wait`), for
 * tests that call `drive.connect`.
 *
 * The fakes answer with only the parts of a `Response` the Google library
 * reads (`status`, `ok`, `headers.get` and `text`), and the library sends
 * only string bodies and plain header objects. So a fake with those parts
 * stands in for the kit's client, which is what the one cast below says.
 */
export function hostFor({ http, wait = async () => {} }: TestHostParts): IntegrationHost {
  return {
    http: http as unknown as IntegrationHost["http"],
    wait,
    tokens: noTokens,
    settings: {},
  };
}

/** What a test gives {@link hostFor}: a fake client and, when it checks pauses, a `wait`. */
export interface TestHostParts {
  readonly http: GoogleHost["http"];
  readonly wait?: GoogleHost["wait"];
}
