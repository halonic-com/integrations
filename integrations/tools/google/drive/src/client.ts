import {
  type GoogleApi,
  googleApi,
  googleBaseUrls,
  googleUrl,
} from "@halonicjs/integration-tool-google-shared";
import { type DriveFile, driveFileSchema, fileFields } from "./file.ts";
import type { IntegrationHost } from "./kit.ts";

/**
 * Every Drive request goes through this class. The Google library adds the
 * account's access token, maps Google's errors to `GoogleError` and never
 * retries a request that changes something. Tools call these methods and
 * never build requests themselves.
 */

export class DriveClient {
  readonly #google: GoogleApi;

  constructor(host: IntegrationHost) {
    this.#google = googleApi(host, { secret: "google-account", service: "Google Drive" });
  }

  /**
   * One request: a file's details. `supportsAllDrives` lets Drive find a
   * file in a shared drive; without it, Drive answers 404.
   */
  async getFile(fileId: string, signal?: AbortSignal): Promise<DriveFile> {
    const url = googleUrl(googleBaseUrls.drive, ["files", fileId], {
      fields: fileFields,
      supportsAllDrives: true,
    });
    return await this.#google.getJson(url, driveFileSchema, signal);
  }
}
