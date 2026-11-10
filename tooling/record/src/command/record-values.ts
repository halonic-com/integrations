import type { RecordingSheet } from "./sheet.ts";

/**
 * The key and setting values for one recording, read from environment
 * variables named after the sheet: never from the command line, where they
 * would end up in the shell history, and never printed.
 *
 * A setting such as an MCP server's `url` is read the same way as a key,
 * because the address of a self-hosted server can be personal.
 */
export interface RecordValues {
  /** By the sheet's secret name. An optional secret that isn't set has no entry. */
  readonly secrets: ReadonlyMap<string, string>;
  /** By setting name, for the sheet's `{ fromSetting }` hosts. */
  readonly settings: Readonly<Record<string, string>>;
}

export type ReadRecordValues =
  | { readonly ok: true; readonly values: RecordValues }
  /** The names of the variables to set. Never their values. */
  | { readonly ok: false; readonly missing: readonly string[] };

/** `anthropic-key` → `HALONIC_RECORD_SECRET_ANTHROPIC_KEY`. */
export function secretVariable(secret: string): string {
  return `HALONIC_RECORD_SECRET_${variablePart(secret)}`;
}

/** `url` → `HALONIC_RECORD_SETTING_URL`. */
export function settingVariable(setting: string): string {
  return `HALONIC_RECORD_SETTING_${variablePart(setting)}`;
}

/** Sheet names are kebab-case: upper case, with `-` turned into `_`. */
function variablePart(name: string): string {
  return name.toUpperCase().replaceAll("-", "_");
}

/**
 * Reads every secret and setting the sheet needs. A required secret or a
 * setting that isn't set, or is empty, is reported by its variable name, so
 * the recorder can stop before it sends anything.
 *
 * @example
 * const read = readRecordValues(sheet, process.env);
 * if (!read.ok) console.error(`Set ${read.missing.join(", ")}`);
 */
export function readRecordValues(
  sheet: RecordingSheet,
  environment: Readonly<Record<string, string | undefined>>,
): ReadRecordValues {
  const missing: string[] = [];
  const read = (variable: string) => {
    const value = environment[variable];
    return value === undefined || value === "" ? undefined : value;
  };

  const secrets = new Map<string, string>();
  for (const [name, secret] of Object.entries(sheet.secrets)) {
    const value = read(secretVariable(name));
    if (value !== undefined) {
      secrets.set(name, value);
    } else if (!secret.optional) {
      missing.push(secretVariable(name));
    }
  }

  const settings: Record<string, string> = {};
  for (const name of settingNames(sheet)) {
    const value = read(settingVariable(name));
    if (value === undefined) {
      missing.push(settingVariable(name));
    } else {
      settings[name] = value;
    }
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true, values: { secrets, settings } };
}

/**
 * Every value read, for `prepareRecording`'s `knownSecrets`: the keys, and
 * the settings too, so a server address never reaches a recording.
 */
export function knownValues(values: RecordValues): string[] {
  return [...values.secrets.values(), ...Object.values(values.settings)];
}

/**
 * The settings the sheet's hosts read, each once, in the order the sheet
 * names them. A secret's `{ fromSetting }` host is always in `hosts` too:
 * the sheet reader refuses one that isn't.
 */
function settingNames(sheet: RecordingSheet): string[] {
  const names = sheet.hosts.flatMap((host) => (typeof host === "string" ? [] : [host.fromSetting]));
  return [...new Set(names)];
}
