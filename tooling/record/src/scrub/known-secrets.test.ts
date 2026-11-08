import { describe, expect, it } from "vitest";
import { FAKE } from "../test/fakes.ts";
import { encodeBase64 } from "./base64.ts";
import { KnownSecrets } from "./known-secrets.ts";

function found(secrets: KnownSecrets, text: string): string[] {
  return secrets.find(text).map((range) => text.slice(range.start, range.end));
}

describe("KnownSecrets", () => {
  const secrets = new KnownSecrets([FAKE.plainKey]);

  it("finds the value itself", () => {
    expect(found(secrets, `x ${FAKE.plainKey} y`)).toEqual([FAKE.plainKey]);
  });

  it("finds it base64-encoded, in both alphabets, with and without padding", () => {
    const standard = encodeBase64(FAKE.plainKey, { urlSafe: false, padded: true });
    const urlSafe = encodeBase64(FAKE.plainKey, { urlSafe: true, padded: false });
    expect(found(secrets, standard)).toEqual([standard]);
    expect(found(secrets, urlSafe)).toEqual([urlSafe]);
  });

  it("finds it URL-encoded", () => {
    const keyWithSymbols = "fake/key+with=symbols&more";
    const encoded = encodeURIComponent(keyWithSymbols);
    expect(found(new KnownSecrets([keyWithSymbols]), `?q=${encoded}`)).toEqual([encoded]);
  });

  it("finds it encoded as form data, which differs from encodeURIComponent", () => {
    const keyWithSymbols = "fake~key(with)symbols! and*space";
    const encoded = new URLSearchParams([["key", keyWithSymbols]]).toString().slice(4);
    expect(encoded).not.toBe(encodeURIComponent(keyWithSymbols));
    expect(found(new KnownSecrets([keyWithSymbols]), `key=${encoded}`)).toEqual([encoded]);
  });

  it("finds a long piece of it", () => {
    const firstHalf = FAKE.plainKey.slice(0, 15);
    expect(found(secrets, `part=${firstHalf}&x=1`)).toEqual([firstHalf]);
  });

  it("ignores short pieces, which would match ordinary text", () => {
    expect(found(secrets, "plainval")).toEqual([]);
  });

  it("finds nothing when there are no secrets", () => {
    expect(found(new KnownSecrets([]), FAKE.plainKey)).toEqual([]);
  });
});
