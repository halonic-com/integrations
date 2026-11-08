import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { z } from "zod";

/**
 * The body of a Drive upload with `uploadType=multipart`: the file's
 * metadata as JSON, then its content, in one `multipart/related` request.
 * `drive_create_file` and `drive_update_file` both send it.
 *
 * https://developers.google.com/workspace/drive/api/guides/manage-uploads#multipart
 */
export interface UploadBody {
  /** The request's `content-type` header, with the boundary. */
  readonly contentType: string;
  readonly body: string;
}

/**
 * The file's metadata, sent as JSON: an object such as `NewFileMetadata`,
 * or `{}` for an update that keeps the name and folder.
 */
export type UploadMetadata = object;

/** The content of the upload: text, and the type the caller says it is. */
export interface UploadContent {
  /** A media type without parameters, such as `text/csv`. Checked with {@link contentTypeSchema}. */
  readonly type: string;
  readonly text: string;
}

/**
 * A media type such as `text/markdown`, without parameters: two
 * restricted names from RFC 6838, section 4.2. Checking it keeps a line
 * break, and with it a header of the model's choice, out of the body.
 */
const mediaTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

/** The `mimeType` argument of the two upload tools. */
export const contentTypeSchema = z
  .string()
  .max(255)
  .regex(mediaTypePattern)
  .default("text/plain")
  .describe("Type of the content you pass (default text/plain).");

/**
 * The boundary is fixed, so the same call always sends the same request
 * and a recording replays (guide, section 9). The old connector picked a
 * random one. When the text holds the boundary, the next numbered one is
 * tried; real files hardly ever hold even the first.
 */
const boundaryBase = "halonic-upload-boundary";
const boundaryCandidates = 10;

/**
 * Builds the body of a multipart upload. For an update without new
 * metadata, pass `{}`.
 *
 * @throws {@link GoogleError} `bad-arguments` when the content type isn't a
 * plain media type, or when the text holds every boundary this tries.
 *
 * @example
 * multipartUploadBody({ name: "notes.md", mimeType: "text/markdown" }, { type: "text/markdown", text: "# Notes" });
 */
export function multipartUploadBody(metadata: UploadMetadata, content: UploadContent): UploadBody {
  if (!mediaTypePattern.test(content.type)) {
    throw new GoogleError("bad-arguments", "mimeType must be a media type such as text/plain.");
  }
  const metadataJson = JSON.stringify(metadata);
  const boundary = boundaryNotIn([metadataJson, content.text]);
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metadataJson,
    `--${boundary}`,
    `Content-Type: ${content.type}`,
    "",
    content.text,
    `--${boundary}--`,
  ].join("\r\n");
  return { contentType: `multipart/related; boundary=${boundary}`, body };
}

/** The first boundary that none of the texts holds (RFC 2046, section 5.1.1). */
function boundaryNotIn(texts: readonly string[]): string {
  for (let number = 0; number < boundaryCandidates; number++) {
    const boundary = number === 0 ? boundaryBase : `${boundaryBase}-${number}`;
    if (!texts.some((text) => text.includes(boundary))) {
      return boundary;
    }
  }
  // Only text written to hit every boundary gets here. The limit keeps the
  // search short; the message says what to change without quoting the text.
  throw new GoogleError(
    "bad-arguments",
    `The content or the name holds "${boundaryBase}", which Drive uploads use. Remove it and try again.`,
  );
}
