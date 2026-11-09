/**
 * The interface types and the tool helper this integration is built
 * against, kept here until `@halonicjs/integration-kit` publishes them.
 *
 * The types are copied from `packages/core/ports/src` in halonic-com/halonic
 * (`integration.ts` and `connector-client.ts` on `liam/HAL-135-01-port`).
 * `ToolImplementation` and `runTool` are the kit code shown in
 * `docs/guides/integration-examples.md`. Only the parts this integration
 * uses are here. Gmail and Drive keep the same stand-in; all three go
 * when the kit publishes these names.
 *
 * To swap: delete this file and import the same names from
 * `@halonicjs/integration-kit`. The host's `http` and `wait` are the
 * Google library's `GoogleHost`, the part of the kit's host that library
 * uses, so `googleApi` accepts this host as it is.
 */
import type { GoogleHost } from "@halonicjs/integration-tool-google-shared";
import type { z } from "zod";

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
  /** Whether its result carries outside content (invitations, shared calendars), which Halonic fences off. */
  untrusted: boolean;
}

/**
 * What an integration is given: `http` for requests and `wait` for the
 * pause before a retry. Calendar keeps no tokens and reads no settings,
 * so it needs nothing else.
 */
export type IntegrationHost = GoogleHost;

/** One integration connected through its host. */
export interface IntegrationConnection {
  /** Calls one of the integration's tools and returns its text result. */
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
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

/**
 * One scenario in `recordings/scenarios.ts`, which `pnpm record` runs
 * against the real service. Not from the kit: it is copied from
 * `tooling/record/src/scenario.ts`, so the scenario file imports nothing
 * from tooling. It stays when the kit is swapped in.
 */
export interface Scenario {
  /** Kebab-case. The recording is saved as `recordings/<name>.json`. */
  readonly name: string;
  /** Declared user-content paths this scenario doesn't touch. */
  readonly unusedUserContent?: readonly string[];
  run(connection: IntegrationConnection): Promise<void>;
}

/** One tool: what the model sees, how its arguments are checked, and what runs. */
export interface ToolImplementation<Client, Arguments extends z.ZodType = z.ZodType> {
  readonly declaration: IntegrationTool;
  readonly arguments: Arguments;
  // Method syntax on purpose: it lets a list hold tools with different arguments.
  run(client: Client, args: z.infer<Arguments>, signal?: AbortSignal): Promise<unknown>;
}

/** Builds the integration's error for a refused call (guide, section 7). */
export type MakeError = (code: "bad-arguments" | "not-found", message: string) => Error;

/** A tool name the model made up is repeated only this far. */
const maxEchoedNameLength = 64;

/**
 * Finds the tool, checks its arguments and runs it. The result is the
 * tool's own small object as JSON, never the service's raw response.
 */
export async function runTool<Client>(
  tools: readonly ToolImplementation<Client>[],
  client: Client,
  call: { name: string; args: Record<string, unknown>; signal?: AbortSignal | undefined },
  makeError: MakeError,
): Promise<string> {
  const tool = tools.find((candidate) => candidate.declaration.name === call.name);
  if (tool === undefined) {
    const name = call.name.slice(0, maxEchoedNameLength);
    throw makeError("not-found", `There is no tool named ${name}.`);
  }
  const parsed = tool.arguments.safeParse(call.args);
  if (!parsed.success) {
    // Name the bad fields, never their values: they may hold the user's content.
    const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "(arguments)");
    throw makeError("bad-arguments", `Check these arguments: ${[...new Set(fields)].join(", ")}.`);
  }
  return JSON.stringify(await tool.run(client, parsed.data, call.signal));
}
