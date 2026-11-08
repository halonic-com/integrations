import { describe, expect, it } from "vitest";
import { contentTypeSchema, multipartUploadBody } from "./upload-body.ts";

describe("multipartUploadBody", () => {
  it("puts the metadata as JSON first and the content second, with CRLF line ends", () => {
    const upload = multipartUploadBody(
      { name: "notes.md", mimeType: "text/markdown" },
      { type: "text/markdown", text: "# Notes\n\nFirst line" },
    );

    expect(upload.contentType).toBe("multipart/related; boundary=halonic-upload-boundary");
    expect(upload.body).toBe(
      [
        "--halonic-upload-boundary",
        "Content-Type: application/json; charset=UTF-8",
        "",
        '{"name":"notes.md","mimeType":"text/markdown"}',
        "--halonic-upload-boundary",
        "Content-Type: text/markdown; charset=UTF-8",
        "",
        "# Notes\n\nFirst line",
        "--halonic-upload-boundary--",
      ].join("\r\n"),
    );
  });

  it("sends empty metadata for an update that only replaces the content", () => {
    const upload = multipartUploadBody({}, { type: "text/plain", text: "new text" });

    expect(upload.body).toContain("\r\n\r\n{}\r\n--halonic-upload-boundary\r\n");
  });

  it("sends the same body for the same call, so a recording replays", () => {
    const call = () => multipartUploadBody({ name: "a.txt" }, { type: "text/plain", text: "a" });

    expect(call()).toEqual(call());
  });

  it("keeps text outside the ASCII range as it is", () => {
    const upload = multipartUploadBody(
      { name: "Café.txt" },
      { type: "text/plain", text: "naïve 🙂" },
    );

    expect(upload.body).toContain('{"name":"Café.txt"}');
    expect(upload.body).toContain("\r\n\r\nnaïve 🙂\r\n");
  });

  it.each(["text/plain", "text/csv", "Text/HTML"])("says the %s content is UTF-8", (type) => {
    const upload = multipartUploadBody({}, { type, text: "a" });

    expect(upload.body).toContain(`\r\nContent-Type: ${type}; charset=UTF-8\r\n\r\na\r\n`);
  });

  it("adds no charset to a type that isn't text", () => {
    const upload = multipartUploadBody({}, { type: "application/vnd.ms-excel", text: "a" });

    expect(upload.body).toContain("\r\nContent-Type: application/vnd.ms-excel\r\n\r\na\r\n");
  });

  it("picks the next boundary when the content holds the first", () => {
    const upload = multipartUploadBody(
      {},
      { type: "text/plain", text: "--halonic-upload-boundary\r\nContent-Type: text/html" },
    );

    expect(upload.contentType).toBe("multipart/related; boundary=halonic-upload-boundary-1");
    expect(upload.body.startsWith("--halonic-upload-boundary-1\r\n")).toBe(true);
  });

  it("picks the next boundary when the name holds the first", () => {
    const upload = multipartUploadBody(
      { name: "halonic-upload-boundary.txt" },
      { type: "text/plain", text: "" },
    );

    expect(upload.contentType).toBe("multipart/related; boundary=halonic-upload-boundary-1");
  });

  it("refuses text that holds every boundary it tries, without quoting the text", () => {
    const boundaries = Array.from({ length: 10 }, (_, number) =>
      number === 0 ? "halonic-upload-boundary" : `halonic-upload-boundary-${number}`,
    );
    const text = `private sentence ${boundaries.join(" ")}`;

    const upload = () => multipartUploadBody({}, { type: "text/plain", text });

    expect(upload).toThrow(expect.objectContaining({ code: "bad-arguments" }));
    expect(upload).not.toThrow(/private sentence/);
  });

  it.each([
    ["a line break", "text/plain\r\nX-Injected: yes"],
    ["parameters", "text/plain; charset=utf-8"],
    ["no subtype", "text"],
    ["an empty type", ""],
  ])("refuses a content type with %s, so it can't add a header", (_, type) => {
    const upload = () => multipartUploadBody({}, { type, text: "a" });

    expect(upload).toThrow(expect.objectContaining({ code: "bad-arguments" }));
    expect(upload).not.toThrow(/X-Injected/);
  });
});

describe("contentTypeSchema", () => {
  it("defaults to text/plain", () => {
    expect(contentTypeSchema.parse(undefined)).toBe("text/plain");
  });

  it.each(["text/plain", "text/markdown", "text/csv", "text/html", "application/vnd.ms-excel"])(
    "accepts %s",
    (type) => {
      expect(contentTypeSchema.parse(type)).toBe(type);
    },
  );

  it.each(["text/plain\nX: y", "text/plain; charset=utf-8", "text", `text/${"x".repeat(250)}`])(
    "refuses %j",
    (type) => {
      expect(contentTypeSchema.safeParse(type).success).toBe(false);
    },
  );
});
