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

const threadSchema = z.object({
  id: z.string(),
  /** Oldest first, as Gmail returns them. */
  messages: z.array(messageSchema).default([]),
});
export type Thread = z.infer<typeof threadSchema>;

const labelListSchema = z.object({
  labels: z
    .array(z.object({ id: z.string(), name: z.string(), type: z.string().optional() }))
    .default([]),
});
export type Label = z.infer<typeof labelListSchema>["labels"][number];

const draftSchema = z.object({ id: z.string(), message: messageSchema });
export type Draft = z.infer<typeof draftSchema>;

/** Label changes for a set of messages. */
export interface LabelChange {
  messageIds: readonly string[];
  addLabelIds: readonly string[];
  removeLabelIds: readonly string[];
}

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

  /** One request: a whole message, with every MIME part and its body. */
  async getMessage(messageId: string, signal?: AbortSignal): Promise<Message> {
    const url = googleUrl(googleBaseUrls.gmail, [...mailbox, "messages", messageId], {
      format: "full",
    });
    return await this.#google.getJson(url, messageSchema, signal);
  }

  /** One request: every message of a thread, whole. */
  async getThread(threadId: string, signal?: AbortSignal): Promise<Thread> {
    const url = googleUrl(googleBaseUrls.gmail, [...mailbox, "threads", threadId], {
      format: "full",
    });
    return await this.#google.getJson(url, threadSchema, signal);
  }

  /** One request: every label of the mailbox, the system ones included. */
  async listLabels(signal?: AbortSignal): Promise<Label[]> {
    const url = googleUrl(googleBaseUrls.gmail, [...mailbox, "labels"]);
    return (await this.#google.getJson(url, labelListSchema, signal)).labels;
  }

  /**
   * One request: adds and removes labels on up to 1,000 messages. Gmail
   * answers with an empty body, so `send` is used instead of `postJson`.
   * Not retried, like every request that changes something.
   */
  async modifyLabels(change: LabelChange, signal?: AbortSignal): Promise<void> {
    const url = googleUrl(googleBaseUrls.gmail, [...mailbox, "messages", "batchModify"]);
    await this.#google.send({
      method: "POST",
      url,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ids: change.messageIds,
        addLabelIds: change.addLabelIds,
        removeLabelIds: change.removeLabelIds,
      }),
      signal,
    });
  }

  /** One request: a draft with its whole message, the Bcc header included. */
  async getDraft(draftId: string, signal?: AbortSignal): Promise<Draft> {
    const url = googleUrl(googleBaseUrls.gmail, [...mailbox, "drafts", draftId], {
      format: "full",
    });
    return await this.#google.getJson(url, draftSchema, signal);
  }
}
