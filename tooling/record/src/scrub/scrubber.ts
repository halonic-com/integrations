import { parseBody, scrubBody } from "./body.ts";
import type { ScrubContext } from "./context.ts";
import type { CapturedExchange, RecordedExchange } from "./exchange.ts";
import { Fakes } from "./fakes.ts";
import { FieldPaths } from "./field-paths.ts";
import { scrubHeaders } from "./headers.ts";
import { KnownSecrets } from "./known-secrets.ts";
import type { ScrubPolicy } from "./policy.ts";
import { ReportBuilder, type ScrubReport } from "./report.ts";
import { scrubUrl } from "./url.ts";

export interface ScrubOptions {
  /** What the integration declared about its own traffic. */
  readonly policy: ScrubPolicy;
  /**
   * The key values the kit added to requests during this recording (in
   * tests, the fake keys). They are found and removed wherever they appear,
   * whatever they look like.
   */
  readonly knownSecrets?: readonly string[];
}

export interface ScrubResult {
  readonly exchanges: RecordedExchange[];
  readonly report: ScrubReport;
}

/**
 * Scrubs every exchange of one recording. Pure: no I/O, no shared state
 * between calls. Stand-ins are stable within the call, so the same e-mail
 * address or ID gets the same stand-in in every exchange.
 *
 * Throws `RecordingRefused` when something can't be scrubbed safely; the
 * caller must then save nothing.
 */
export function scrubExchanges(
  exchanges: readonly CapturedExchange[],
  options: ScrubOptions,
): ScrubResult {
  const context: ScrubContext = {
    policy: options.policy,
    knownSecrets: new KnownSecrets(options.knownSecrets ?? []),
    fakes: new Fakes(),
    report: new ReportBuilder(),
    matchedUserContent: new Set(),
  };
  const scrubbed = exchanges.map((exchange, index) =>
    scrubExchange(exchange, `exchanges[${index}]`, context),
  );
  const declared = [...options.policy.userContent.request, ...options.policy.userContent.response];
  const unmatched = [...new Set(declared)].filter((path) => !context.matchedUserContent.has(path));
  return { exchanges: scrubbed, report: context.report.build(unmatched) };
}

function scrubExchange(
  exchange: CapturedExchange,
  where: string,
  context: ScrubContext,
): RecordedExchange {
  const { request, response } = exchange;
  const { policy } = context;
  const requestBody = parseBody(
    request.body,
    request.headers,
    policy.textContentTypes,
    `${where}.request.body`,
  );
  const responseBody = parseBody(
    response.body,
    response.headers,
    policy.textContentTypes,
    `${where}.response.body`,
  );
  return {
    request: {
      method: request.method.toUpperCase(),
      url: scrubUrl(request.url, `${where}.request.url`, context),
      headers: scrubHeaders(request.headers, `${where}.request.headers`, context),
      body: scrubBody(
        requestBody,
        `${where}.request.body`,
        new FieldPaths(policy.userContent.request),
        context,
      ),
    },
    response: {
      status: response.status,
      headers: scrubHeaders(response.headers, `${where}.response.headers`, context),
      body: scrubBody(
        responseBody,
        `${where}.response.body`,
        new FieldPaths(policy.userContent.response),
        context,
      ),
    },
  };
}
