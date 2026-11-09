import { parseBody, scrubBody } from "./body.ts";
import type { ScrubContext } from "./context.ts";
import type { CapturedExchange, RecordedBody, RecordedExchange } from "./exchange.ts";
import { Fakes } from "./fakes.ts";
import { FieldPaths } from "./field-paths.ts";
import { scrubHeaders } from "./headers.ts";
import { KnownSecrets } from "./known-secrets.ts";
import type { ScrubPolicy } from "./policy.ts";
import { QueryPaths } from "./query-paths.ts";
import { ReportBuilder, type ScrubReport } from "./report.ts";
import { serviceErrorPaths } from "./service-errors.ts";
import { StreamedJson } from "./streamed-json.ts";
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
 * The recording is scrubbed twice. Example addresses and drama numbers are
 * kept as they are, and one can look like a stand-in (`person2@example.com`)
 * anywhere in the recording, even after a real address got that number. The
 * first pass only finds them; the second skips their numbers.
 *
 * Throws `RecordingRefused` when something can't be scrubbed safely, or a
 * declared user-content path can't be read; the caller must then save nothing.
 */
export function scrubExchanges(
  exchanges: readonly CapturedExchange[],
  options: ScrubOptions,
): ScrubResult {
  const firstPass = new Fakes();
  scrubWith(exchanges, options, firstPass);
  return scrubWith(exchanges, options, new Fakes(firstPass.kept()));
}

function scrubWith(
  exchanges: readonly CapturedExchange[],
  options: ScrubOptions,
  fakes: Fakes,
): ScrubResult {
  const { policy } = options;
  const context: ScrubContext = {
    policy,
    knownSecrets: new KnownSecrets(options.knownSecrets ?? []),
    fakes,
    report: new ReportBuilder(),
    matchedUserContent: new Set(),
  };
  const requestUserContent: RequestUserContent = {
    query: new QueryPaths(policy.userContent),
    body: new FieldPaths(policy.userContent, "request"),
  };
  const streamedJson = new StreamedJson(policy.streamedJson);
  const scrubbed = exchanges.map((exchange, index) =>
    scrubExchange(exchange, `exchanges[${index}]`, requestUserContent, streamedJson, context),
  );
  const unmatched = [...new Set(policy.userContent)].filter(
    (path) => !context.matchedUserContent.has(path),
  );
  return { exchanges: scrubbed, report: context.report.build(unmatched) };
}

/** The declared user-content paths that reach into a request. */
interface RequestUserContent {
  readonly query: QueryPaths;
  readonly body: FieldPaths;
}

/**
 * The policy's response paths, then the error paths the recorder adds for
 * this service's error format. The policy's come first, so a path the sheet
 * declares itself is the one that matches and counts as used.
 */
function responseUserContent(
  policy: ScrubPolicy,
  url: string,
  responseBody: RecordedBody,
): FieldPaths {
  return new FieldPaths(
    [...policy.userContent, ...serviceErrorPaths(url, responseBody)],
    "response",
  );
}

function scrubExchange(
  exchange: CapturedExchange,
  where: string,
  requestUserContent: RequestUserContent,
  streamedJson: StreamedJson,
  context: ScrubContext,
): RecordedExchange {
  const { request, response } = exchange;
  const allowed = context.policy.allowContentTypes;
  const requestBody = parseBody(request.body, request.headers, allowed, `${where}.request.body`);
  // Streamed JSON is joined before any rule runs, so the rules see whole JSON.
  const responseBody = streamedJson.join(
    parseBody(response.body, response.headers, allowed, `${where}.response.body`),
  );
  const responsePaths = responseUserContent(context.policy, request.url, responseBody);
  return {
    transport: "http",
    request: {
      method: request.method.toUpperCase(),
      url: scrubUrl(request.url, `${where}.request.url`, context, requestUserContent.query),
      headers: scrubHeaders(request.headers, `${where}.request.headers`, context),
      body: scrubBody(requestBody, `${where}.request.body`, requestUserContent.body, context),
    },
    response: {
      status: response.status,
      headers: scrubHeaders(response.headers, `${where}.response.headers`, context),
      body: scrubBody(responseBody, `${where}.response.body`, responsePaths, context),
    },
  };
}
