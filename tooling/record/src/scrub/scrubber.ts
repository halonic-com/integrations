import { parseBody, scrubBody } from "./body.ts";
import type { ScrubContext } from "./context.ts";
import type { CapturedExchange, RecordedExchange } from "./exchange.ts";
import { Fakes } from "./fakes.ts";
import { FieldPaths } from "./field-paths.ts";
import { scrubHeaders } from "./headers.ts";
import { KnownSecrets } from "./known-secrets.ts";
import type { ScrubPolicy } from "./policy.ts";
import { ReportBuilder, type ScrubReport } from "./report.ts";
import { serviceErrorPaths } from "./service-errors.ts";
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
 * Throws `RecordingRefused` when something can't be scrubbed safely, or a
 * declared user-content path can't be read; the caller must then save nothing.
 */
export function scrubExchanges(
  exchanges: readonly CapturedExchange[],
  options: ScrubOptions,
): ScrubResult {
  const { policy } = options;
  const context: ScrubContext = {
    policy,
    knownSecrets: new KnownSecrets(options.knownSecrets ?? []),
    fakes: new Fakes(),
    report: new ReportBuilder(),
    matchedUserContent: new Set(),
  };
  const requestUserContent = new FieldPaths(policy.userContent, "request");
  const scrubbed = exchanges.map((exchange, index) => {
    const userContent: UserContentPaths = {
      request: requestUserContent,
      response: responseUserContent(policy, exchange.request.url),
    };
    return scrubExchange(exchange, `exchanges[${index}]`, userContent, context);
  });
  const unmatched = [...new Set(policy.userContent)].filter(
    (path) => !context.matchedUserContent.has(path),
  );
  return { exchanges: scrubbed, report: context.report.build(unmatched) };
}

interface UserContentPaths {
  readonly request: FieldPaths;
  readonly response: FieldPaths;
}

/**
 * The policy's response paths, then the error paths the recorder adds for
 * this service. The policy's come first, so a path the sheet declares
 * itself is the one that matches and counts as used.
 */
function responseUserContent(policy: ScrubPolicy, url: string): FieldPaths {
  return new FieldPaths([...policy.userContent, ...serviceErrorPaths(url)], "response");
}

function scrubExchange(
  exchange: CapturedExchange,
  where: string,
  userContent: UserContentPaths,
  context: ScrubContext,
): RecordedExchange {
  const { request, response } = exchange;
  const allowed = context.policy.allowContentTypes;
  const requestBody = parseBody(request.body, request.headers, allowed, `${where}.request.body`);
  const responseBody = parseBody(
    response.body,
    response.headers,
    allowed,
    `${where}.response.body`,
  );
  return {
    transport: "http",
    request: {
      method: request.method.toUpperCase(),
      url: scrubUrl(request.url, `${where}.request.url`, context),
      headers: scrubHeaders(request.headers, `${where}.request.headers`, context),
      body: scrubBody(requestBody, `${where}.request.body`, userContent.request, context),
    },
    response: {
      status: response.status,
      headers: scrubHeaders(response.headers, `${where}.response.headers`, context),
      body: scrubBody(responseBody, `${where}.response.body`, userContent.response, context),
    },
  };
}
