import {
  type GoogleApi,
  googleApi,
  googleBaseUrls,
  googleUrl,
  withNextPageToken,
} from "@halonicjs/integration-tool-google-shared";
import { z } from "zod";
import { type DriveFile, driveFileSchema, fileFields, listedFileFields } from "./file.ts";
import type { IntegrationHost } from "./kit.ts";

const fileListSchema = withNextPageToken(z.object({ files: z.array(driveFileSchema).default([]) }));
export type FileList = z.infer<typeof fileListSchema>;

/** One page of a listing. */
export interface ListFilesRequest {
  /** Drive query syntax, built with `query.ts`. */
  query: string;
  pageSize: number;
  /** Drive refuses an order together with a full-text search, so it is optional. */
  orderBy?: string | undefined;
  pageToken?: string | undefined;
}

/**
 * A listing includes shared drives. Without these two, Drive leaves out the
 * files in shared drives.
 */
const allDrives = { supportsAllDrives: true, includeItemsFromAllDrives: true } as const;

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

  /** One request: a page of the files that match the query. */
  async listFiles(request: ListFilesRequest, signal?: AbortSignal): Promise<FileList> {
    const url = googleUrl(googleBaseUrls.drive, ["files"], {
      q: request.query,
      pageSize: request.pageSize,
      orderBy: request.orderBy,
      pageToken: request.pageToken,
      fields: `nextPageToken,files(${listedFileFields})`,
      ...allDrives,
    });
    return await this.#google.getJson(url, fileListSchema, signal);
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

  /** One request: a Google Doc, Sheet, Slides or Drawing exported as `format`. */
  async exportFile(fileId: string, format: string, signal?: AbortSignal): Promise<string> {
    const url = googleUrl(googleBaseUrls.drive, ["files", fileId, "export"], {
      mimeType: format,
    });
    return await this.#google.getText(url, signal);
  }

  /** One request: a stored file's contents, read as text. */
  async downloadFile(fileId: string, signal?: AbortSignal): Promise<string> {
    const url = googleUrl(googleBaseUrls.drive, ["files", fileId], {
      alt: "media",
      supportsAllDrives: true,
    });
    return await this.#google.getText(url, signal);
  }
}
