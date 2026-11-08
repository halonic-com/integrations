import {
  type GoogleApi,
  googleApi,
  googleBaseUrls,
  googleUrl,
  withNextPageToken,
} from "@halonicjs/integration-tool-google-shared";
import { z } from "zod";
import type { IntegrationHost } from "./kit.ts";
import { type Message, messageSchema, summaryHeaders } from "./message.ts";

/**
 * Every Gmail request goes through this class. The Google library adds the
 * account's access token, maps Google's errors to `GoogleError` and never
 * retries a request that sends something. Tools call these methods and
 * never build requests themselves.
 */

/** Every Gmail path starts here: the signed-in account's own mailbox. */
const mailbox = ["users", "me"] as const;

const messageListSchema = withNextPageToken(
  z.object({
    messages: z.array(z.object({ id: z.string(), threadId: z.string() })).default([]),
    resultSizeEstimate: z.number().optional(),
  }),
);
export type MessageList = z.infer<typeof messageListSchema>;

/** One page of a search: which messages match. */
export interface ListMessagesRequest {
  query: string;
  maxResults: number;
  pageToken?: string | undefined;
}

export class GmailClient {
  readonly #google: GoogleApi;

  constructor(host: IntegrationHost) {
    // Reads are retried as the Google library's rules allow, waiting with host.wait;
    // a request that changes the mailbox never is.
    this.#google = googleApi(host, { secret: "google-account", service: "Gmail" });
  }

  /** One request: the ids of one page of messages that match the query. */
  async listMessages(request: ListMessagesRequest, signal?: AbortSignal): Promise<MessageList> {
    const url = googleUrl(googleBaseUrls.gmail, [...mailbox, "messages"], {
      q: request.query,
      maxResults: request.maxResults,
      pageToken: request.pageToken,
    });
    return await this.#google.getJson(url, messageListSchema, signal);
  }

  /** One request: a message's labels, snippet and the headers a summary shows. */
  async getMessageSummary(messageId: string, signal?: AbortSignal): Promise<Message> {
    const url = googleUrl(googleBaseUrls.gmail, [...mailbox, "messages", messageId], {
      format: "metadata",
      metadataHeaders: summaryHeaders,
    });
    return await this.#google.getJson(url, messageSchema, signal);
  }
}
