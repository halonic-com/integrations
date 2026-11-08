import type { ScrubContext } from "../scrub/context.ts";
import { Fakes } from "../scrub/fakes.ts";
import { KnownSecrets } from "../scrub/known-secrets.ts";
import { definePolicy, type ScrubPolicyInput } from "../scrub/policy.ts";
import { ReportBuilder } from "../scrub/report.ts";

/**
 * Obviously fake values for tests. Never put a real key, token, address or
 * phone number in a test, not even an expired one: both repos are public.
 */
export const FAKE = {
  /** Shaped like the keys the kit adds; the `halonic-fake-` prefix marks every fake key. */
  apiKey: "halonic-fake-key-0aB1cD2eF3gH4iJ5kL6mN7oP8",
  /** A fake key with no known shape: only the known-secret rule can find it. */
  plainKey: "plainvaluewithoutanyshapeatall",
  /** Random-looking, but with FAKE in it so nobody mistakes it for a real one. */
  randomToken: "FAKE0aB1cD2eF3gH4iJ5kL6mN7oP8qR9",
  /** Shaped like a JWT; the payload decodes to {"sub":"fake"}. */
  jwt: "eyJhbGciOiJub25lIn0.eyJzdWIiOiJmYWtlIn0.ZmFrZS1zaWduYXR1cmU",
  openAiKey: "sk-FAKEFAKEFAKEFAKEFAKEFAKE",
  googleKey: "AIzaFAKEfakeFAKEfakeFAKEfakeFAKEfakeFAK",
  /** `.test` is a reserved top-level domain (RFC 2606). */
  email: "ada.fake@mail.test",
  otherEmail: "grace.fake@mail.test",
  /** 555-01xx numbers are reserved for fiction in North America. */
  phone: "+1 555 010 0199",
} as const;

/** A fresh scrub context, as `scrubExchanges` builds one, for testing a single rule. */
export function testContext(
  policy: ScrubPolicyInput = {},
  knownSecrets: readonly string[] = [],
): ScrubContext {
  return {
    policy: definePolicy(policy),
    knownSecrets: new KnownSecrets(knownSecrets),
    fakes: new Fakes(),
    report: new ReportBuilder(),
    matchedUserContent: new Set(),
  };
}

/** The rules a context's report recorded, in order. */
export function rulesUsed(context: ScrubContext): string[] {
  return context.report.build([]).replacements.map((replacement) => replacement.rule);
}
