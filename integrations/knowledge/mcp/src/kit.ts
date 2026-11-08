/**
 * The interface types this integration is built against, kept here until
 * `@halonicjs/integration-kit` publishes them.
 *
 * Copied from `packages/core/ports/src` in halonic-com/halonic:
 * `knowledge-provider.ts` (port version 1, with `untrusted` from
 * halonic-com/halonic#175) and `integration.ts` on
 * `liam/HAL-135-01-port`. Only the parts this
 * integration uses are here.
 *
 * To swap: delete this file and import the same names from
 * `@halonicjs/integration-kit`. The host's `http` and `wait` are the MCP
 * client's `McpHost`, the part of the kit's host our MCP client uses, so
 * the MCP transport accepts this host as it is.
 */
import type { McpHost } from "@halonicjs/integration-mcp";

/** Version of the knowledge port these types are copied from. */
export const knowledgeProviderVersion = 1;

/** One search result. */
export interface KnowledgeHit {
  ref: string;
  title: string;
  snippet: string;
  score: number;
}

/** One whole document. */
export interface KnowledgeDoc {
  ref: string;
  title: string;
  content: string;
}

/** What a knowledge source can do. */
export interface KnowledgeCapabilities {
  search: boolean;
  semantic: boolean;
  ingest: boolean;
}

/** A knowledge source agents can search and read. */
export interface KnowledgeProvider {
  readonly id: string;
  readonly capabilities: KnowledgeCapabilities;
  /**
   * Whether hits and documents may hold text someone outside the workspace
   * wrote, such as a remote server's answers. Halonic fences that text off
   * like an untrusted tool result, so instructions in it aren't followed.
   * Leaving it out counts as `true`: only a source whose content the
   * workspace itself wrote, such as its own files, says `false`.
   */
  readonly untrusted?: boolean;
  /** The best matches first. */
  search(query: string, options?: { limit?: number }): Promise<KnowledgeHit[]>;
  /** The document, or `null` when there is no such ref. */
  get(ref: string): Promise<KnowledgeDoc | null>;
  /** Every document's ref and title, when the provider can list them (for prompts and summaries). */
  list?(): Promise<{ ref: string; title: string }[]>;
}

/** A knowledge source as the workspace configures it. */
export interface KnowledgeSource {
  id: string;
  config: Record<string, unknown>;
}

/**
 * What an integration is given: `http` for requests, `wait` for the pause
 * before resuming an answer stream, and `settings`. This one keeps no tokens.
 */
export interface IntegrationHost extends McpHost {
  /** The settings the workspace gives this integration, such as `url`. Never a secret value. */
  readonly settings: Readonly<Record<string, unknown>>;
}

/** One integration connected through its host. */
export interface IntegrationConnection {
  /** Calls one of the integration's tools and returns its text result. */
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
  /** Builds a knowledge source, for an integration whose sheet `provides` `knowledge`. */
  createKnowledgeProvider?(source: KnowledgeSource): KnowledgeProvider;
  /** Releases what the connection holds. Safe to call twice. */
  close(): Promise<void>;
}

/** An integration as its package exports it. */
export interface Integration {
  /** The sheet's `id`. */
  readonly name: string;
  /** The sheet's `version`. */
  readonly version: string;
  /** A knowledge source offers no tools, so the tool type isn't copied. */
  readonly tools: readonly never[];
  /** Connects through the host. Must not send a request before the first call. */
  connect(host: IntegrationHost): IntegrationConnection;
}

/** The Web `AbortSignal`, as far as this integration uses it: it only passes it on. */
export interface AbortSignal {
  readonly aborted: boolean;
}
