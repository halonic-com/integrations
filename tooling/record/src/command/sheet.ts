import {
  readSheetFields,
  SheetSyntaxError,
  type SheetValue,
} from "@halonicjs/tooling-check/sheet-yaml";
import { z } from "zod";
import { definePolicy, type ScrubPolicy } from "../scrub/policy.ts";

/**
 * What `pnpm record` needs from a permission sheet (`integration.yaml`):
 * where the integration may go, which keys it uses and where they go, and
 * what the scrubber must remove.
 *
 * Read with `tooling/check`'s sheet reader until `@halonicjs/format` is
 * published; then parse the sheet with that and delete the schemas here.
 */
export interface RecordingSheet {
  readonly id: string;
  readonly hosts: readonly SheetHost[];
  readonly secrets: Readonly<Record<string, SheetSecret>>;
  /** The `recording:` section, with the secret headers from `secrets` added. */
  readonly policy: ScrubPolicy;
}

/** A host name, or the host of the URL a setting holds (`{ fromSetting: url }`). */
export type SheetHost = string | { readonly fromSetting: string };

/** One secret in the sheet. */
export interface SheetSecret {
  readonly hosts: readonly SheetHost[];
  /** Sent only when it is set; otherwise the request goes without it. */
  readonly optional: boolean;
  readonly placement: DeclaredPlacement;
}

/**
 * Where the sheet puts a secret: the kit's `DeclaredPlacement`. `form` is
 * left out until a sheet uses it.
 */
export type DeclaredPlacement =
  | { readonly as: "bearer" }
  | { readonly as: "header"; readonly header: string; readonly prefix?: string };

/** The sheet can't be recorded with. The message names the place, never a key. */
export class SheetError extends Error {
  override readonly name = "SheetError";
}

const hostSchema = z.union([z.string(), z.strictObject({ fromSetting: z.string() })]);

/** Scalars are text: the reader doesn't turn `true` into a boolean. */
const secretSchema = z.object({
  hosts: z.array(hostSchema).min(1),
  as: z.string(),
  header: z.string().optional(),
  prefix: z.string().optional(),
  optional: z.enum(["true", "false"]).optional(),
});

const pathsSchema = z.array(z.string()).optional();

/** Strict, so a misspelt key stops the recording instead of removing nothing. */
const recordingSchema = z.strictObject({
  userContent: pathsSchema,
  secretFields: pathsSchema,
  streamedJson: pathsSchema,
  allowContentTypes: pathsSchema,
});

/**
 * Reads the sheet's `id`, `hosts`, `secrets` and `recording`. Other fields
 * aren't read, so a sheet may use more YAML in them than the reader covers.
 *
 * @throws SheetError when a field is missing, malformed or uses a placement this recorder doesn't know
 */
export function readRecordingSheet(text: string): RecordingSheet {
  const fields = readFields(text);
  const id = parse(z.string(), fields.get("id"), "id");
  const hosts = parse(z.array(hostSchema).min(1), fields.get("hosts"), "hosts");
  const secrets: Record<string, SheetSecret> = {};
  const rawSecrets = parse(
    z.record(z.string(), secretSchema).optional(),
    // `secrets:` with nothing under it reads as null.
    fields.get("secrets") ?? undefined,
    "secrets",
  );
  for (const [name, secret] of Object.entries(rawSecrets ?? {})) {
    secrets[name] = {
      hosts: secret.hosts,
      optional: secret.optional === "true",
      placement: placementOf(name, secret),
    };
  }
  const recording = parse(recordingSchema.optional(), fields.get("recording"), "recording") ?? {};
  const secretHeaders = Object.values(secrets).flatMap(({ placement }) =>
    placement.as === "header" ? [placement.header] : [],
  );
  const policy = definePolicy({
    secretHeaders,
    secretFields: recording.secretFields ?? [],
    userContent: recording.userContent ?? [],
    streamedJson: recording.streamedJson ?? [],
    allowContentTypes: recording.allowContentTypes ?? [],
  });
  return { id, hosts, secrets, policy };
}

function readFields(text: string): ReadonlyMap<string, SheetValue> {
  try {
    const fields = readSheetFields(text, ["id", "hosts", "secrets", "recording"]);
    return new Map([...fields].map(([name, field]) => [name, field.value]));
  } catch (error) {
    if (error instanceof SheetSyntaxError) {
      throw new SheetError(`integration.yaml, line ${error.line}: ${error.message}`);
    }
    throw error;
  }
}

/** Only the place is named: the sheet holds no keys, but a Zod message would quote the value. */
function parse<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const path = [field, ...(parsed.error.issues[0]?.path ?? [])].join(".");
    throw new SheetError(`integration.yaml: "${path}" is missing or not what pnpm record reads`);
  }
  return parsed.data;
}

/** Only the placements the kit knows and the sheets use. Anything else stops, never a guess. */
function placementOf(name: string, secret: z.infer<typeof secretSchema>): DeclaredPlacement {
  switch (secret.as) {
    case "bearer":
      return { as: "bearer" };
    case "header":
      if (secret.header === undefined) {
        throw new SheetError(
          `integration.yaml: the secret "${name}" goes in a header, but names none`,
        );
      }
      return secret.prefix === undefined
        ? { as: "header", header: secret.header }
        : { as: "header", header: secret.header, prefix: secret.prefix };
    default:
      throw new SheetError(
        `integration.yaml: the secret "${name}" goes "as: ${secret.as}", which pnpm record doesn't place yet`,
      );
  }
}
