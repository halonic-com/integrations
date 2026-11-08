/**
 * Decodes UTF-8 bytes to a string.
 *
 * Why our own: the integration TypeScript preset has no `TextDecoder`, so
 * that code also runs in the cloud runtime without a Web or Node type
 * library. When the kit offers a decoder, use it instead.
 *
 * It is strict: an invalid sequence (a stray continuation byte, an overlong
 * form, a surrogate or a value above U+10FFFF) gives `undefined` instead of
 * the replacement character. A service that sends broken text is answering
 * in an unexpected way, and the caller says so.
 */

/** How many code points are turned into text at once, well below engine argument limits. */
const codePointsPerPiece = 4096;

/** What the first byte of a sequence says about the whole sequence. */
interface SequenceStart {
  /** How many bytes the sequence has, from 1 to 4. */
  readonly length: number;
  /** The value bits the first byte carries. */
  readonly bits: number;
  /** The smallest code point this length may encode; anything smaller is overlong. */
  readonly minimum: number;
}

/**
 * @returns the text, or `undefined` when the bytes are not valid UTF-8
 *
 * @example
 * decodeUtf8(new Uint8Array([0x68, 0xc3, 0xa9])); // "hé"
 */
export function decodeUtf8(bytes: Uint8Array): string | undefined {
  const pieces: string[] = [];
  let codePoints: number[] = [];
  let index = 0;
  while (index < bytes.length) {
    const start = sequenceStart(bytes[index] ?? 0);
    if (start === undefined || index + start.length > bytes.length) {
      return undefined;
    }
    const codePoint = readCodePoint(bytes, index, start);
    if (codePoint === undefined) {
      return undefined;
    }
    codePoints.push(codePoint);
    index += start.length;
    if (codePoints.length === codePointsPerPiece) {
      pieces.push(String.fromCodePoint(...codePoints));
      codePoints = [];
    }
  }
  pieces.push(String.fromCodePoint(...codePoints));
  return pieces.join("");
}

function sequenceStart(byte: number): SequenceStart | undefined {
  if (byte < 0x80) return { length: 1, bits: byte, minimum: 0 };
  if (byte >= 0xc0 && byte < 0xe0) return { length: 2, bits: byte & 0x1f, minimum: 0x80 };
  if (byte >= 0xe0 && byte < 0xf0) return { length: 3, bits: byte & 0x0f, minimum: 0x800 };
  if (byte >= 0xf0 && byte < 0xf8) return { length: 4, bits: byte & 0x07, minimum: 0x10000 };
  // 0x80 to 0xbf continue a sequence and can't start one; 0xf8 and up are never valid.
  return undefined;
}

function readCodePoint(bytes: Uint8Array, index: number, start: SequenceStart): number | undefined {
  let codePoint = start.bits;
  for (let offset = 1; offset < start.length; offset += 1) {
    const byte = bytes[index + offset] ?? 0;
    if ((byte & 0xc0) !== 0x80) {
      return undefined;
    }
    codePoint = (codePoint << 6) | (byte & 0x3f);
  }
  const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
  if (codePoint < start.minimum || isSurrogate || codePoint > 0x10ffff) {
    return undefined;
  }
  return codePoint;
}
