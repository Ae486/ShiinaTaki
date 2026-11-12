/**
 * INPUT:  a picked File's size + MIME type; a FileReader data-URL string.
 * OUTPUT: classifyImage(...) -> reject | asis | normalize; parseDataUrl(...) -> { mediaType, base64 } (raw base64).
 * POS:    ui/windows/home/pages/chat — the pure, node-testable core of use-image-attach (the canvas/FileReader path stays in the
 *         hook). Size gates + data-URL split per research r3; every accepted attachment ends up an IMAGE_MEDIA_TYPES type.
 */

import { IMAGE_MEDIA_TYPES } from "@taki/shared";

// R3 gates: reject sources over 20 MB (never sent); pass <= 1 MB untouched (exact pixels/transparency); normalize the rest.
export const MAX_SOURCE_BYTES = 20_000_000;
export const ASIS_MAX_BYTES = 1_000_000;

export type ImageVerdict = "reject" | "asis" | "normalize";

// A picked file's fate from size + type. An unsupported small type still normalizes — the canvas re-encodes to JPEG —
// so anything that reaches chat.send carries a mediaType the ImageAttachment schema accepts.
export function classifyImage(source: { size: number; type: string }): ImageVerdict {
  if (source.size > MAX_SOURCE_BYTES) return "reject";
  const supported = (IMAGE_MEDIA_TYPES as readonly string[]).includes(source.type);
  return source.size <= ASIS_MAX_BYTES && supported ? "asis" : "normalize";
}

// Splits a FileReader data URL ("data:image/png;base64,iVBOR...") into its mediaType + raw base64 (NO data: prefix —
// a tagged data-URL throws in ai@7, so chat.send carries raw base64).
export function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } {
  return {
    mediaType: dataUrl.slice("data:".length, dataUrl.indexOf(";")),
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
  };
}
