import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readSheetFields } from "@halonicjs/tooling-check/sheet-yaml";
import { findIntegration } from "@halonicjs/tooling-record/find-integration";
import { buildIntegrationFolder, FolderError } from "./integration-folder.ts";

/** Everything the command touches outside itself, so a test can choose it. */
export interface CopyCommandIo {
  /** The repo root. */
  readonly root: string;
  /** The arguments after `pnpm copy-to-workspace`. */
  readonly args: readonly string[];
  readonly print: (line: string) => void;
}

const usage = "Usage: pnpm copy-to-workspace <sheet id or path> <workspace folder>";

/**
 * `pnpm copy-to-workspace`: builds an integration of this repo and puts it in
 * a Halonic workspace's `integrations/<id>/`, where a connector file can name
 * it with `transport: { integration: { folder: <id> } }`. A folder that is
 * already there is replaced only when it holds the same integration, so the
 * command never removes something else.
 *
 * @returns the exit code
 */
export async function runCopyCommand(io: CopyCommandIo): Promise<number> {
  const [given, workspaceArg, ...extra] = io.args;
  if (given === undefined || workspaceArg === undefined || extra.length > 0) {
    io.print(usage);
    return 2;
  }
  try {
    const integration = findIntegration(io.root, given);
    if (integration === undefined) {
      throw new FolderError(`No integration has the id or path "${given}".`);
    }
    const id = sheetId(join(integration, "integration.yaml"));
    const workspace = resolve(workspaceArg);
    if (!existsSync(join(workspace, "workspace.yaml"))) {
      throw new FolderError(`${workspace} isn't a Halonic workspace: it has no workspace.yaml.`);
    }
    const target = join(workspace, "integrations", id);
    refuseOtherFolder(target, id);
    const staging = mkdtempSync(join(tmpdir(), "copy-to-workspace-"));
    try {
      await buildIntegrationFolder(integration, id, staging);
      rmSync(target, { recursive: true, force: true });
      cpSync(staging, target, { recursive: true });
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    io.print(`Copied ${id} to ${target}.`);
    io.print(
      `A connector file names it with transport: { integration: { folder: ${id} } }; then run halonic trust.`,
    );
    return 0;
  } catch (error) {
    if (!(error instanceof FolderError)) throw error;
    io.print(error.message);
    return 1;
  }
}

/** Only a folder that holds the same integration may be replaced. */
function refuseOtherFolder(target: string, id: string): void {
  if (!existsSync(target)) return;
  const sheet = join(target, "integration.yaml");
  if (existsSync(sheet) && sheetId(sheet) === id) return;
  throw new FolderError(
    `${target} is already there and doesn't hold ${id}. Move it away first; nothing was changed.`,
  );
}

function sheetId(file: string): string {
  const id = readSheetFields(readFileSync(file, "utf8"), ["id"]).get("id")?.value;
  if (typeof id !== "string") throw new FolderError(`${file} has no id.`);
  return id;
}
