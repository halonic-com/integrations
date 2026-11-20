import type {
  IntegrationHost,
  IntegrationRequestInit,
  SecretPlacement,
} from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import { type ListedComment, listedCommentSchema } from "./comment.ts";
import { errorForStatus, unexpectedResponse } from "./error-for-status.ts";
import { paperclipUrl, type QueryValue } from "./paperclip-url.ts";
import { readSettings } from "./settings.ts";
import { type ListedTask, listedTaskSchema } from "./task.ts";

/** The secret the sheet declares; the kit adds its value, which we never see. */
const paperclipKey: SecretPlacement = { secret: "paperclip-key", as: "bearer" };

/**
 * The only method this integration ever sends. A tool that writes would
 * need a second one here, and a reviewer would see it.
 */
const readOnly = "GET";

const taskListSchema = z.array(listedTaskSchema);
const commentListSchema = z.array(listedCommentSchema);

/** One page of the company's tasks, most recently changed first. */
export interface ListTasksRequest {
  /** Statuses separated by commas, such as `todo,in_progress`. */
  status?: string | undefined;
  assigneeAgentId?: string | undefined;
  /** Paperclip's search in titles, identifiers and descriptions. */
  text?: string | undefined;
  limit: number;
  offset: number;
}

/** One page of a task's comments, oldest first. */
export interface ListCommentsRequest {
  /** The task's identifier, such as `HAL-12`, or its id. */
  issue: string;
  /**
   * Only comments from this one on. Paperclip's `after` includes the
   * comment itself (seen on a live server), so callers drop it.
   */
  after?: string | undefined;
  limit: number;
}

/**
 * Every Paperclip request goes through this class. It reads the settings,
 * names the key so the kit adds it, sends only `GET`, and turns Paperclip's
 * errors into `PaperclipError`. Tools call these methods and never build
 * requests themselves.
 *
 * Nothing is retried: a `429` or a `5xx` fails the call (README, "Limits").
 * The kit's own errors, such as a refused host or a timeout, pass through
 * unchanged (guide, section 7, rule 7).
 */
export class PaperclipClient {
  readonly #host: IntegrationHost;

  constructor(host: IntegrationHost) {
    this.#host = host;
  }

  /**
   * One request: a page of the company's tasks.
   * `GET /api/companies/{companyId}/issues`
   */
  async listTasks(request: ListTasksRequest, signal?: AbortSignal): Promise<ListedTask[]> {
    const { url, companyId } = readSettings(this.#host.settings);
    const href = paperclipUrl(url, ["api", "companies", companyId, "issues"], {
      status: request.status,
      assigneeAgentId: request.assigneeAgentId,
      q: request.text,
      limit: request.limit,
      offset: request.offset,
    });
    return await this.#getJson(href, taskListSchema, signal);
  }

  /**
   * One request: a page of one task's comments, oldest first.
   * `GET /api/issues/{issue}/comments`
   */
  async listComments(request: ListCommentsRequest, signal?: AbortSignal): Promise<ListedComment[]> {
    const { url } = readSettings(this.#host.settings);
    const query: Record<string, QueryValue> = {
      order: "asc",
      after: request.after,
      limit: request.limit,
    };
    const href = paperclipUrl(url, ["api", "issues", request.issue, "comments"], query);
    return await this.#getJson(href, commentListSchema, signal);
  }

  /** Sends one `GET`, then parses and checks the JSON answer. */
  async #getJson<Schema extends z.ZodType>(
    href: string,
    schema: Schema,
    signal: AbortSignal | undefined,
  ): Promise<z.infer<Schema>> {
    const init: IntegrationRequestInit = {
      method: readOnly,
      headers: { accept: "application/json" },
      auth: paperclipKey,
    };
    if (signal !== undefined) init.signal = signal;
    const response = await this.#host.http.fetch(href, init);
    if (!response.ok) {
      // The body is never read: Paperclip's text isn't passed on (rule 3).
      await response.body?.cancel().catch(() => undefined);
      throw errorForStatus(response.status, href);
    }
    return parseJson(await response.text(), schema, href);
  }
}

/** Neither the parse error nor the `ZodError` gets out (guide, section 7, rule 5). */
function parseJson<Schema extends z.ZodType>(
  text: string,
  schema: Schema,
  href: string,
): z.infer<Schema> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw unexpectedResponse(href);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw unexpectedResponse(href);
  }
  return parsed.data;
}
