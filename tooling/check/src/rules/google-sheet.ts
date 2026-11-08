import type { CheckContext } from "../lib/context.ts";
import { Report } from "../lib/problems.ts";
import {
  readSheetFields,
  type SheetField,
  type SheetMapping,
  SheetSyntaxError,
  type SheetValue,
} from "../lib/sheet-yaml.ts";

/** The secret of Halonic's own Google sign-in. */
const googleSecret = "google-account";

/** The sheet fields that only an integration using the Google sign-in may have. */
const googleFields = ["googleScopes", "googleApis", "googleCheck"] as const;

const sheetFile = /^integrations\/(?:.+\/)?integration\.yaml$/;

/**
 * Checks the Google fields of every permission sheet (guide section 3).
 * Studio builds the Google setup steps from them, so the host never keeps
 * its own list of Google APIs:
 *
 * - `googleScopes`: `{ scope, reason }` per scope; the reason is shown to the user.
 * - `googleApis`: `{ api, name }` per API the user switches on in the
 *   Google Cloud Console; required with `googleScopes`.
 * - `googleCheck`: one `GET` without a body to a host of the sheet, which
 *   the host sends after sign-in to see that the API is on.
 */
export function checkGoogleSheet(context: CheckContext): Report {
  const report = new Report("google-sheet");
  for (const file of context.files.filter((name) => sheetFile.test(name))) {
    try {
      const fields = readSheetFields(context.read(file), ["hosts", "secrets", ...googleFields]);
      new SheetChecker(file, fields, report).check();
    } catch (error) {
      if (!(error instanceof SheetSyntaxError)) {
        throw error;
      }
      report.error(file, `${error.message} This check reads a small part of YAML.`, error.line);
    }
  }
  return report;
}

/** Checks the Google fields of one sheet. */
class SheetChecker {
  private readonly file: string;
  private readonly fields: ReadonlyMap<string, SheetField>;
  private readonly report: Report;

  constructor(file: string, fields: ReadonlyMap<string, SheetField>, report: Report) {
    this.file = file;
    this.fields = fields;
    this.report = report;
  }

  check(): void {
    if (!this.usesGoogleSignIn()) {
      for (const name of googleFields) {
        this.whenPresent(name, (field) =>
          this.error(
            field,
            `${name} is only for an integration that uses the ${googleSecret} secret. Remove it, or add the secret.`,
          ),
        );
      }
      return;
    }
    this.whenPresent("googleScopes", (field) =>
      this.checkEntries(field, "googleScopes", ["scope", "reason"]),
    );
    this.whenPresent("googleApis", (field) =>
      this.checkEntries(field, "googleApis", ["api", "name"]),
    );
    this.whenPresent("googleCheck", (field) => this.checkRequest(field));
    const scopes = this.fields.get("googleScopes");
    if (scopes !== undefined && !this.fields.has("googleApis")) {
      this.error(
        scopes,
        "A sheet with googleScopes also lists googleApis: { api, name } for each API the user switches on, such as { api: gmail.googleapis.com, name: Gmail API }.",
      );
    }
  }

  private usesGoogleSignIn(): boolean {
    const secrets = this.fields.get("secrets")?.value;
    return isMapping(secrets) && googleSecret in secrets;
  }

  /** Each entry is a mapping with exactly these keys, each holding non-empty text. */
  private checkEntries(field: SheetField, name: string, keys: readonly [string, string]): void {
    const shape = `{ ${keys.join(", ")} }`;
    if (!Array.isArray(field.value)) {
      this.error(field, `${name} is a list of ${shape} entries.`);
      return;
    }
    for (const [index, entry] of (field.value as readonly SheetValue[]).entries()) {
      const where = `${name} entry ${index + 1}`;
      if (!isMapping(entry)) {
        this.error(field, `${where} is ${shape}, not plain text.`);
        continue;
      }
      for (const extra of Object.keys(entry).filter((key) => !keys.includes(key))) {
        this.error(field, `${where} has ${extra}; an entry holds only ${shape}.`);
      }
      for (const key of keys) {
        if (!isText(entry[key])) {
          this.error(field, `${where} needs a non-empty ${key}.`);
        }
      }
      if (name === "googleApis" && isText(entry["api"]) && !isGoogleApi(entry["api"])) {
        this.error(
          field,
          `${where}: api is the service name the Console uses, such as drive.googleapis.com.`,
        );
      }
    }
  }

  /** googleCheck: `GET` to a host of the sheet, with no body. */
  private checkRequest(field: SheetField): void {
    const request = field.value;
    if (!isMapping(request)) {
      this.error(field, "googleCheck is { method: GET, url }.");
      return;
    }
    if ("body" in request) {
      this.error(field, "googleCheck sends no body.");
    }
    for (const extra of Object.keys(request).filter(
      (key) => !["method", "url", "body"].includes(key),
    )) {
      this.error(field, `googleCheck has ${extra}; it holds only method and url.`);
    }
    if (request["method"] !== "GET") {
      this.error(field, "googleCheck uses method GET: it only looks, it changes nothing.");
    }
    const url = request["url"];
    if (!isText(url) || !URL.canParse(url)) {
      this.error(field, "googleCheck needs a full https url.");
      return;
    }
    const target = new URL(url);
    if (target.protocol !== "https:") {
      this.error(field, "googleCheck url uses https.");
    }
    if (!this.literalHosts().includes(target.hostname)) {
      this.error(
        field,
        `googleCheck goes to ${target.hostname}, which isn't in the sheet's hosts.`,
      );
    }
  }

  /** The sheet's fixed hosts; a host from a setting can't be checked here. */
  private literalHosts(): string[] {
    const hosts = this.fields.get("hosts")?.value;
    return Array.isArray(hosts) ? (hosts as readonly SheetValue[]).filter(isText) : [];
  }

  private whenPresent(name: string, check: (field: SheetField) => void): void {
    const field = this.fields.get(name);
    if (field !== undefined) {
      check(field);
    }
  }

  private error(field: SheetField, message: string): void {
    this.report.error(this.file, message, field.line);
  }
}

function isMapping(value: SheetValue | undefined): value is SheetMapping {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: SheetValue | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** A Google API's service name, such as `gmail.googleapis.com`. */
function isGoogleApi(api: string): boolean {
  return /^[a-z][a-z0-9-]*\.googleapis\.com$/.test(api);
}
