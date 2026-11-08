/**
 * The interface types this integration is built against, kept here until
 * `@halonicjs/integration-kit` publishes them.
 *
 * Copied from `packages/core/ports/src` in halonic-com/halonic on `main`
 * (`integration.ts` and `connector-client.ts`, port version 1). Only the
 * parts this integration uses are here.
 *
 * To swap: delete this file and import the same names from
 * `@halonicjs/integration-kit`. The host's HTTP client is the shared
 * library's `HttpClient`, the part of the kit's client our MCP client uses,
 * so the MCP transport accepts this host as it is.
 */
import type { HttpClient } from "@halonicjs/integration-shared";

/** What calling a tool can do. Approvals and the "allow sending" check act on it. */
export type ToolRisk = "read" | "write" | "send";

/** A tool as the model and the permission sheet see it. */
export interface IntegrationTool {
  /** The tool's name, unique within its integration. */
  name: string;
  /** What the tool does, written for the model. */
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>;
  risk: ToolRisk;
  /** Whether its result carries outside content, which Halonic fences off. */
  untrusted: boolean;
}

/** What an integration is given. This one keeps no tokens, so only `http` and `settings`. */
export interface IntegrationHost {
  readonly http: HttpClient;
  /** The settings the workspace gives this integration, such as `url`. Never a secret value. */
  readonly settings: Readonly<Record<string, unknown>>;
}

/** One integration connected through its host. */
export interface IntegrationConnection {
  /** Calls one of the integration's tools and returns its text result. */
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
  /**
   * The tools offered now, when they can change while connected (an MCP
   * server). Halonic treats a tool it finds here but not in the
   * declaration as `risk: "write"` unless the workspace sets a lower one.
   */
  listTools?(): Promise<IntegrationTool[]>;
  /** Releases what the connection holds. Safe to call twice. */
  close(): Promise<void>;
}

/** An integration as its package exports it. */
export interface Integration {
  /** The sheet's `id`. */
  readonly name: string;
  /** The sheet's `version`. */
  readonly version: string;
  /** The same tools, in the same order, as the sheet. */
  readonly tools: readonly IntegrationTool[];
  /** Connects through the host. Must not send a request before the first call. */
  connect(host: IntegrationHost): IntegrationConnection;
}

/** The Web `AbortSignal`, as far as this integration uses it: it only passes it on. */
export interface AbortSignal {
  readonly aborted: boolean;
}
