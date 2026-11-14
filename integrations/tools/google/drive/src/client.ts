import {
  type GoogleApi,
  googleApi,
  googleBaseUrls,
  googleUrl,
  withNextPageToken,
} from "@halonicjs/integration-tool-google-shared";
import { z } from "zod";
import {
  type DriveFile,
  driveFileSchema,
  fileFields,
  folderType,
  listedFileFields,
} from "./file.ts";
import type { IntegrationHost } from "./kit.ts";
import type { NewFileMetadata } from "./new-file-metadata.ts";
import { multipartUploadBody, type UploadContent, type UploadMetadata } from "./upload-body.ts";
import { writtenFileFields } from "./written-file.ts";

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
  /** The file fields to ask for; `listedFileFields` when left out. */
  fields?: string | undefined;
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
      fields: `nextPageToken,files(${request.fields ?? listedFileFields})`,
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

  /**
   * One request: uploads a new file, its metadata and content together.
   * Never retried: a timeout doesn't prove the file wasn't created, and a
   * second try could create it twice.
   */
  async createFile(
    metadata: NewFileMetadata,
    content: UploadContent,
    signal?: AbortSignal,
  ): Promise<DriveFile> {
    const url = googleUrl(googleBaseUrls.driveUpload, ["files"], uploadQuery);
    return await this.#upload("POST", url, metadata, content, signal);
  }

  /**
   * One request: replaces a file's content and keeps its name and folder.
   * Not retried either: the Google library only repeats reads.
   */
  async replaceFileContent(
    fileId: string,
    content: UploadContent,
    signal?: AbortSignal,
  ): Promise<DriveFile> {
    const url = googleUrl(googleBaseUrls.driveUpload, ["files", fileId], uploadQuery);
    return await this.#upload("PATCH", url, {}, content, signal);
  }

  /**
   * One request: creates a folder at the top of My Drive or inside
   * `parentId`. Never retried, so a timeout can't leave two folders.
   */
  async createFolder(
    name: string,
    parentId: string | undefined,
    signal?: AbortSignal,
  ): Promise<DriveFile> {
    const url = googleUrl(googleBaseUrls.drive, ["files"], {
      fields: writtenFileFields,
      supportsAllDrives: true,
    });
    const metadata =
      parentId === undefined
        ? { name, mimeType: folderType }
        : { name, mimeType: folderType, parents: [parentId] };
    return await this.#google.postJson(url, metadata, driveFileSchema, signal);
  }

  /**
   * One read, retried where the Google library allows: the folders a file
   * is in now, which a move has to name to take it out of them.
   */
  async getParents(fileId: string, signal?: AbortSignal): Promise<readonly string[]> {
    const url = googleUrl(googleBaseUrls.drive, ["files", fileId], {
      fields: "id,parents",
      supportsAllDrives: true,
    });
    const file = await this.#google.getJson(url, driveFileSchema, signal);
    return file.parents ?? [];
  }

  /**
   * One request, never retried: moves a file out of `fromParents` into
   * `toFolderId`, and renames it when `newName` is given. Drive's
   * `addParents` and `removeParents` do the move in one `PATCH`.
   * https://developers.google.com/workspace/drive/api/guides/folder#move-files
   */
  async moveFile(move: FileMove, signal?: AbortSignal): Promise<DriveFile> {
    const url = googleUrl(googleBaseUrls.drive, ["files", move.fileId], {
      addParents: move.toFolderId,
      // A file shared with the account may be in none of its folders.
      removeParents: move.fromParents.length > 0 ? move.fromParents.join(",") : undefined,
      fields: writtenFileFields,
      supportsAllDrives: true,
    });
    const request = {
      method: "PATCH",
      url,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(move.newName === undefined ? {} : { name: move.newName }),
      signal,
    } as const;
    return await this.#google.sendJson(request, driveFileSchema);
  }

  async #upload(
    method: "POST" | "PATCH",
    url: string,
    metadata: UploadMetadata,
    content: UploadContent,
    signal: AbortSignal | undefined,
  ): Promise<DriveFile> {
    const upload = multipartUploadBody(metadata, content);
    const request = {
      method,
      url,
      headers: { "content-type": upload.contentType },
      body: upload.body,
      signal,
    };
    return await this.#google.sendJson(request, driveFileSchema);
  }
}

/**
 * The query of every upload: metadata and content in one request, the
 * fields the tools return, and files in shared drives too.
 * https://developers.google.com/workspace/drive/api/guides/manage-uploads#multipart
 */
const uploadQuery = {
  uploadType: "multipart",
  fields: writtenFileFields,
  supportsAllDrives: true,
} as const;

/** One move, as `drive_move_file` asks for it. */
export interface FileMove {
  readonly fileId: string;
  /** The folders the file is in now, from {@link DriveClient.getParents}. */
  readonly fromParents: readonly string[];
  readonly toFolderId: string;
  readonly newName?: string | undefined;
}
