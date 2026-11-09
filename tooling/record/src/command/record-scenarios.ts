import { createRecordingHost, type IntegrationHost } from "../host/recording-host.ts";
import { prepareRecording } from "../recording/prepare-recording.ts";
import { createRecordingTransport, type HttpTransport } from "../recording/recording-transport.ts";
import type { Leak } from "../safety-net/find-leaks.ts";
import type { Scenario } from "../scenario.ts";
import type { ScrubReport } from "../scrub/report.ts";
import { errorText, hideValues } from "./hide-values.ts";
import { knownValues, type RecordValues } from "./record-values.ts";
import type { RecordingSheet } from "./sheet.ts";

/** The connection the scenarios get. Only `close` is called here. */
export interface Connection {
  close?(): Promise<void>;
}

/** The integration and its scenarios, from `recordings/scenarios.ts`. */
export interface ScenarioModule {
  readonly integration: { connect(host: IntegrationHost): Connection };
  readonly scenarios: readonly Scenario<Connection>[];
}

/** One scenario's result. A problem is text a person can read, with every value hidden. */
export type ScenarioOutcome =
  | {
      readonly name: string;
      readonly ok: true;
      readonly text: string;
      readonly report: ScrubReport;
    }
  | { readonly name: string; readonly ok: false; readonly problem: string };

export interface RecordScenariosInput {
  readonly sheet: RecordingSheet;
  readonly values: RecordValues;
  readonly scenarios: readonly Scenario<Connection>[];
  readonly integration: ScenarioModule["integration"];
  /** The real network, under the recording transport. */
  readonly network: HttpTransport;
}

/**
 * Runs each scenario against the real service through the stand-in host,
 * and turns its traffic into the text of a recording file. Nothing is
 * written here: the caller saves the files only when every outcome is ok.
 *
 * A scenario fails when it throws, when the host refused any request (even
 * one the integration caught), or when `prepareRecording` refuses it.
 */
export async function recordScenarios(input: RecordScenariosInput): Promise<ScenarioOutcome[]> {
  const outcomes: ScenarioOutcome[] = [];
  for (const scenario of input.scenarios) {
    outcomes.push(await recordScenario(input, scenario));
  }
  return outcomes;
}

async function recordScenario(
  input: RecordScenariosInput,
  scenario: Scenario<Connection>,
): Promise<ScenarioOutcome> {
  const known = knownValues(input.values);
  const failed = (problem: string): ScenarioOutcome => ({
    name: scenario.name,
    ok: false,
    problem: hideValues(problem, known),
  });

  const recording = createRecordingTransport(input.network);
  const { host, refusals } = createRecordingHost(input.sheet, input.values, recording.transport);
  let thrown: unknown;
  let threw = false;
  try {
    const connection = input.integration.connect(host);
    try {
      await scenario.run(connection);
    } finally {
      await connection.close?.();
    }
  } catch (error) {
    thrown = error;
    threw = true;
  }

  const [refusal] = refusals();
  if (refusal !== undefined) {
    return failed(`the host refused a request the sheet doesn't allow: ${refusal.message}`);
  }
  if (threw) {
    return failed(`the scenario failed:\n${errorText(thrown)}`);
  }

  const prepared = prepareRecording({
    integration: input.sheet.id,
    scenario: scenario.name,
    exchanges: recording.exchanges(),
    policy: input.sheet.policy,
    knownSecrets: known,
    ...(scenario.unusedUserContent ? { unusedUserContent: scenario.unusedUserContent } : {}),
  });
  if (prepared.ok) {
    return { name: scenario.name, ok: true, text: prepared.text, report: prepared.report };
  }
  if (prepared.reason === "refused") {
    return failed(`the recording was refused at ${prepared.where}: ${prepared.message}`);
  }
  return failed(
    `the safety net found what the scrubber missed: ${prepared.leaks.map(describeLeak).join(", ")}`,
  );
}

/** A leak's kind and place. It never holds the value. */
function describeLeak(leak: Leak): string {
  return "path" in leak
    ? `${leak.kind} at ${leak.path}`
    : `${leak.kind} at character ${leak.offset}`;
}
