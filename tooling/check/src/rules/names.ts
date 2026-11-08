import type { CheckContext } from "../lib/context.ts";
import { Report } from "../lib/problems.ts";

/**
 * The scopes that belong to someone else (plan 3.2). Built from parts so
 * this file doesn't trip its own check.
 */
const forbiddenScopes = ["halonic", "studio"].map((name) => `@${name}/`);

const binaryExtensions =
  /\.(?:png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|zip|gz|tgz|pdf|wasm|jar|keystore)$/i;

/**
 * Fails on any name in a forbidden scope anywhere in the repo, in
 * file contents and in file paths. Both scopes belong to someone else,
 * so using one would open a dependency-confusion hole (plan 3.2).
 */
export function checkNames(context: CheckContext): Report {
  const report = new Report("names");
  for (const file of context.files) {
    for (const forbidden of forbiddenScopes) {
      if (file.includes(forbidden)) {
        report.error(
          file,
          `The path contains "${forbidden}". That scope belongs to someone else; use @halonicjs/ (plan 3.2).`,
        );
      }
    }
    if (binaryExtensions.test(file)) {
      continue;
    }
    const lines = context.read(file).split("\n");
    lines.forEach((text, index) => {
      for (const forbidden of forbiddenScopes) {
        if (text.includes(forbidden)) {
          report.error(
            file,
            `"${forbidden}" belongs to someone else. Use the @halonicjs/ scope (plan 3.2).`,
            index + 1,
          );
        }
      }
    });
  }
  return report;
}
