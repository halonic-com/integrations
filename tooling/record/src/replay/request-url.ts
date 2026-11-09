import type { ScrubContext } from "../scrub/context.ts";
import type { RecordedRequest } from "../scrub/exchange.ts";
import { QueryPaths } from "../scrub/query-paths.ts";
import { scrubUrl } from "../scrub/url.ts";
import { sameText, userContentHint } from "./compare-text.ts";
import { asReplayError } from "./replay-context.ts";

/**
 * Compares the method and URL an integration sends on replay with the
 * recorded ones.
 *
 * A recorded URL is scrubbed, so the sent URL is scrubbed first, by the same
 * rules and with the integration's policy: a query parameter the sheet
 * declares as user content (`request.query.q`) matches its placeholder
 * whatever the test searches for, and one the sheet forgot to declare fails.
 */
export class RequestUrls {
  private readonly context: ScrubContext;
  private readonly userContent: QueryPaths;

  constructor(context: ScrubContext) {
    this.context = context;
    this.userContent = new QueryPaths(context.policy.userContent);
  }

  /** Throws when the method or the scrubbed `url` differs from the recorded request's. */
  check(recorded: RecordedRequest, method: string, url: string): void {
    const scrubbed = this.scrub(url);
    if (recorded.method !== method || !sameText(recorded.url, scrubbed)) {
      throw new Error(
        `Expected ${recorded.method} ${recorded.url}, got ${method} ${scrubbed}.${userContentHint(recorded.url, scrubbed)}`,
      );
    }
  }

  private scrub(url: string): string {
    try {
      return scrubUrl(url, "request.url", this.context, this.userContent);
    } catch (error) {
      throw asReplayError("request URL", error);
    }
  }
}
