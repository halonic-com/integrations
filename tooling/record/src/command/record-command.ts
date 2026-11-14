import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { HttpTransport } from "../recording/recording-transport.ts";
import { summarizeReport } from "../scrub/report.ts";
import { findIntegration } from "./find-integration.ts";
import { errorText, hideValues } from "./hide-values.ts";
import { recordScenarios, type ScenarioModule } from "./record-scenarios.ts";
import { readRecordValues } from "./record-values.ts";
import { readRecordingSheet, SheetError } from "./sheet.ts";

/** Everything the command touches outside itself, so a test can give fakes. */
export interface RecordCommandIo {
  /** The repo root. */
  readonly root: string;
  /** The arguments after `pnpm record`. */
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly network: HttpTransport;
  readonly print: (line: string) => void;
}

const usage = "Usage: pnpm record <sheet id or path> [scenario...]";
/** Scenario names become file names, kebab-case like the recordings already there. */
const kebabCase = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** A mistake in what the user set up. Shown as its message alone, without a stack trace. */
class SetupError extends Error {
  override readonly name = "SetupError";
}

/**
 * `pnpm record`: runs an integration's scenarios against the real service
 * and saves each as `recordings/<scenario>.json`, scrubbed. If any scenario
 * fails, nothing is saved.
 *
 * Every line it prints first has every `HALONIC_RECORD_*` value removed, so
 * no message or stack trace can show a key or a server address.
 *
 * @returns the exit code
 */
export async function runRecordCommand(io: RecordCommandIo): Promise<number> {
  const recordValues = Object.entries(io.environment).flatMap(([name, value]) =>
    name.startsWith("HALONIC_RECORD_") && value !== undefined ? [value] : [],
  );
  const print = (line: string) => io.print(hideValues(line, recordValues));
  try {
    return await record(io, print);
  } catch (error) {
    const setup = error instanceof SetupError || error instanceof SheetError;
    print(setup ? error.message : errorText(error));
    return 1;
  }
}

async function record(io: RecordCommandIo, print: (line: string) => void): Promise<number> {
  const [given, ...only] = io.args;
  if (given === undefined || given.startsWith("-")) {
    print(usage);
    return 2;
  }
  const folder = findIntegration(io.root, given);
  if (folder === undefined) {
    print(
      `No integration has the sheet id or path "${given}". ` +
        "Use the id from its integration.yaml (such as model-anthropic) or its folder path.",
    );
    return 1;
  }
  const sheet = readRecordingSheet(readFileSync(join(folder, "integration.yaml"), "utf8"));

  const read = readRecordValues(sheet, io.environment);
  if (!read.ok) {
    print(`Set these environment variables first: ${read.missing.join(", ")}`);
    return 1;
  }

  const module = await loadScenarios(io.root, folder);
  const unknown = only.filter((name) => !module.scenarios.some((s) => s.name === name));
  if (unknown.length > 0) {
    const known = module.scenarios.map((s) => s.name).join(", ");
    print(`No scenario named ${unknown.join(", ")}. ${sheet.id} has: ${known}`);
    return 1;
  }
  const chosen =
    only.length === 0 ? module.scenarios : module.scenarios.filter((s) => only.includes(s.name));

  const outcomes = await recordScenarios({
    sheet,
    values: read.values,
    scenarios: chosen,
    integration: module.integration,
    network: io.network,
  });
  const failures = outcomes.filter((outcome) => !outcome.ok);
  if (failures.length > 0) {
    for (const failure of failures) {
      if (!failure.ok) print(`✗ ${failure.name}: ${failure.problem}`);
    }
    print("Nothing was saved.");
    return 1;
  }
  for (const outcome of outcomes) {
    if (!outcome.ok) continue;
    const file = join(folder, "recordings", `${outcome.name}.json`);
    writeFileSync(file, outcome.text);
    const removed = summarizeReport(outcome.report);
    print(`✓ ${relative(io.root, file)}${removed.length > 0 ? `: ${removed.join(", ")}` : ""}`);
  }
  print("Read each file before you commit it.");
  return 0;
}

/** Imports `recordings/scenarios.ts` and checks it exports what the command runs. */
async function loadScenarios(root: string, folder: string): Promise<ScenarioModule> {
  const file = join(folder, "recordings", "scenarios.ts");
  if (!existsSync(file)) {
    throw new SetupError(`${relative(root, file)} doesn't exist; write the scenarios there`);
  }
  const module: Partial<ScenarioModule> = await import(pathToFileURL(file).href);
  if (typeof module.integration?.connect !== "function" || !Array.isArray(module.scenarios)) {
    throw new SetupError(
      "recordings/scenarios.ts must export `integration` and a list `scenarios`",
    );
  }
  const names = new Set<string>();
  for (const scenario of module.scenarios) {
    if (typeof scenario?.run !== "function" || !kebabCase.test(String(scenario?.name))) {
      throw new SetupError("every scenario needs a kebab-case `name` and a `run` function");
    }
    if (names.has(scenario.name)) {
      throw new SetupError(`two scenarios are named "${scenario.name}"`);
    }
    names.add(scenario.name);
  }
  return module as ScenarioModule;
}
