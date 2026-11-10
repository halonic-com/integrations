// Part of the stand-in host for `pnpm record`; see `policy.ts`. Mirrors
// `IntegrationRefusedError` in halonic `packages/adapters/integration-kit/src/refused.ts`.

/**
 * The codes of the kit's refusals that the stand-in host can give, plus the
 * codes halonic `integrationPolicy` gives for a setting it can't use
 * (`plain-http-not-local`, `setting-outside-class`).
 */
export type RefusalCode =
  | "bad-url"
  | "scheme-not-allowed"
  | "plain-http-not-local"
  | "host-not-allowed"
  | "secret-not-declared"
  | "placement-not-in-sheet"
  | "secret-not-allowed-for-host"
  | "secret-over-plain-http"
  | "setting-outside-class"
  | "secret-not-configured"
  | "too-many-redirects"
  | "not-supported";

/**
 * The host refused something the permission sheet doesn't allow. The
 * message names the integration, the host and the path, never a query, a
 * header or a secret value.
 */
export class HostRefused extends Error {
  override readonly name = "IntegrationRefusedError";
  readonly code: RefusalCode;

  constructor(code: RefusalCode, message: string) {
    super(message);
    this.code = code;
  }
}
