// pnpm copy-to-workspace <sheet id or path> <workspace folder>
// See tooling/copy-to-workspace/README.md.

import { fileURLToPath } from "node:url";
import { runCopyCommand } from "../copy-to-workspace.ts";

process.exitCode = await runCopyCommand({
  root: fileURLToPath(new URL("../../../../", import.meta.url)),
  args: process.argv.slice(2),
  print: (line) => console.log(line),
});
