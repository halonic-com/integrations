// pnpm record <sheet id or path> [scenario...]
// Keys and settings come from HALONIC_RECORD_SECRET_* and HALONIC_RECORD_SETTING_*.
// See tooling/record/README.md, "Recording a scenario".

import { fileURLToPath } from "node:url";
import { runRecordCommand } from "../command/record-command.ts";

process.exitCode = await runRecordCommand({
  root: fileURLToPath(new URL("../../../../", import.meta.url)),
  args: process.argv.slice(2),
  environment: process.env,
  network: { fetch: (url, init) => fetch(url, init) },
  print: (line) => console.log(line),
});
