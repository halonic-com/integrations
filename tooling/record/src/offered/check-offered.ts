import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findLeaks } from "../safety-net/find-leaks.ts";

/**
 * Integrations offered from Halonic Studio ("Offer to Halonic") land in
 * `integrations/offered/<id>/`, mostly from forks. CI then reads code that
 * nobody here wrote, so this folder is only ever parsed and scanned: nothing
 * imports, builds or runs it. The scan reads every file as text, and an
 * offer may not hold a `package.json`, so pnpm and Turbo never see a package
 * there.
 *
 * An offer is never merged as it is. The team adopts one by moving it into
 * its group and rewriting it to the guide (CONTRIBUTING.md, "Offered from
 * Halonic Studio").
 *
 * This module imports nothing outside `tooling/record/src`, so CI can run
 * the base commit's copy on a pull request without installing anything.
 */

/** The folder offers land in, from the repo root. */
export const offeredFolder = "integrations/offered/";

/** An offer's folder name: lowercase letters, digits and dashes. */
const offerIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * The files an offer holds: the permission sheet, the connector file, the
 * backend as plain JavaScript, a short `OFFER.md`, and recordings when
 * there are any.
 */
const allowedFilePattern =
  /^(?:integration\.yaml|connector\.yaml|OFFER\.md|backend\/index\.js|recordings\/[a-z0-9][a-z0-9-]*\.json)$/;

/** The files every offer has. */
const requiredFiles = ["integration.yaml", "connector.yaml", "OFFER.md", "backend/index.js"];

/** Something wrong with an offer. It names the file and the kind, never a value. */
export interface OfferProblem {
  readonly file: string;
  readonly message: string;
}

/**
 * Checks every offer among the repo files (paths from the root with `/`):
 * its folder name, which files it holds, and that no file holds a key,
 * token, e-mail address or phone number. Files are read as text only.
 */
export function checkOffers(root: string, repoFiles: readonly string[]): OfferProblem[] {
  const problems: OfferProblem[] = [];
  const offers = new Map<string, string[]>();
  for (const file of repoFiles.filter((path) => path.startsWith(offeredFolder))) {
    const [id, ...rest] = file.slice(offeredFolder.length).split("/");
    if (id === undefined || rest.length === 0) {
      problems.push({ file, message: `Only offer folders go in ${offeredFolder}.` });
      continue;
    }
    offers.set(id, [...(offers.get(id) ?? []), rest.join("/")]);
  }
  for (const [id, files] of offers) {
    problems.push(...checkOffer(root, id, files));
  }
  return problems;
}

function checkOffer(root: string, id: string, files: readonly string[]): OfferProblem[] {
  const folder = `${offeredFolder}${id}/`;
  const problems: OfferProblem[] = [];
  if (!offerIdPattern.test(id)) {
    problems.push({
      file: folder,
      message: "An offer's folder name is lowercase letters, digits and dashes.",
    });
  }
  for (const missing of requiredFiles.filter((required) => !files.includes(required))) {
    problems.push({ file: `${folder}${missing}`, message: "Every offer has this file." });
  }
  for (const file of files) {
    const path = `${folder}${file}`;
    if (!allowedFilePattern.test(file)) {
      problems.push({
        file: path,
        message: `An offer holds only ${requiredFiles.join(", ")} and recordings/*.json.`,
      });
    } else if (!lstatSync(join(root, path)).isFile()) {
      problems.push({ file: path, message: "Not a plain file, such as a link." });
    } else {
      problems.push(...leaksIn(path, readFileSync(join(root, path), "utf8")));
    }
  }
  return problems;
}

/** The recorder's final scan, with no known key values: an offer brings none. */
function leaksIn(file: string, text: string): OfferProblem[] {
  return findLeaks(text, []).map((leak) => ({
    file,
    message:
      leak.kind === "secret-field"
        ? `A value under a secret name at ${leak.path}. Remove it.`
        : `Looks like a ${leak.kind} at character ${leak.offset}. Remove it.`,
  }));
}
