/**
 * INPUT:  files chosen from a hidden <input type="file"> (the composer's attach button).
 * OUTPUT: useImageAttach() -> { attachments, pick, remove, clear, notice, dismissNotice }; each attachment is
 *         { id, mediaType, dataBase64 (raw), previewUrl } — capped at MAX_ATTACHMENTS_PER_MESSAGE.
 * POS:    ui/windows/chat — the file-pick → base64 path (web-platform APIs; no Tauri plugin, research r3). Pure size
 *         gates + data-URL split live in image-attach-decode (tested); the canvas/FileReader path stays here.
 */

import { useCallback, useState } from "react";
import { IMAGE_MEDIA_TYPES, MAX_ATTACHMENTS_PER_MESSAGE, type ImageAttachment } from "@taki/shared";
import { classifyImage, parseDataUrl } from "./image-attach-decode.ts";

export interface PickedAttachment {
  id: string;
  mediaType: ImageAttachment["mediaType"];
  dataBase64: string;
  previewUrl: string;
}

const MAX_EDGE = 2048; // longest-edge cap for the downscale path (research r3)

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsDataURL(blob);
  });
}

// Downscale to MAX_EDGE and re-encode JPEG q0.85, flattening alpha onto white (JPEG has none). Degrades to the
// original blob if a 2D context is unavailable rather than failing the attach.
async function normalizeImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  return blob ?? file;
}

function toMediaType(value: string): ImageAttachment["mediaType"] | null {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(value) ? (value as ImageAttachment["mediaType"]) : null;
}

// One picked file → an attachment, or a user-facing reason it was skipped (oversize / unsupported after normalize).
async function toAttachment(file: File): Promise<PickedAttachment | { error: string }> {
  const verdict = classifyImage({ size: file.size, type: file.type });
  if (verdict === "reject") return { error: `「${file.name}」超过 20MB，未添加` };
  const dataUrl = await readAsDataUrl(verdict === "normalize" ? await normalizeImage(file) : file);
  const { mediaType, base64 } = parseDataUrl(dataUrl);
  const supported = toMediaType(mediaType);
  if (!supported) return { error: `「${file.name}」格式不支持` };
  return { id: crypto.randomUUID(), mediaType: supported, dataBase64: base64, previewUrl: dataUrl };
}

export interface ImageAttach {
  attachments: PickedAttachment[];
  pick: (files: FileList | null) => Promise<void>;
  remove: (id: string) => void;
  clear: () => void;
  notice: string | null;
  dismissNotice: () => void;
}

export function useImageAttach(): ImageAttach {
  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const pick = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const accepted: PickedAttachment[] = [];
    let reason: string | null = null;
    for (const file of Array.from(files)) {
      if (attachments.length + accepted.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        reason = `最多 ${MAX_ATTACHMENTS_PER_MESSAGE} 张图片`;
        break;
      }
      const result = await toAttachment(file);
      if ("error" in result) reason = result.error;
      else accepted.push(result);
    }
    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted].slice(0, MAX_ATTACHMENTS_PER_MESSAGE));
    }
    if (reason) setNotice(reason);
  }, [attachments.length]);

  const remove = useCallback((id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id)), []);
  const clear = useCallback(() => setAttachments([]), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  return { attachments, pick, remove, clear, notice, dismissNotice };
}
