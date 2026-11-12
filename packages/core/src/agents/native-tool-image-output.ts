/**
 * INPUT: retained SDK ToolResultOutput content with explicitly declared image/file union members
 * OUTPUT: byte-free tool feedback and equivalent native FileParts; non-image parts stay unchanged
 * POS: core/agents — read-only legacy media projection; never guesses images from arbitrary JSON or rewrites rows
 */
import type { FilePart, ToolResultPart } from "ai";

type ToolOutput = ToolResultPart["output"];
type ContentPart = Extract<ToolOutput, { type: "content" }>["value"][number];

export function projectNativeToolImageOutput(output: ToolOutput): { output: ToolOutput; files: FilePart[] } {
  if (output.type !== "content" || !Array.isArray(output.value)) return { output, files: [] };
  const files: FilePart[] = [];
  let changed = false;
  const value = output.value.map((part) => {
    if (!declaresImage(part)) return part;
    changed = true;
    try {
      const file = nativeFile(part);
      if (file) files.push(file);
      return { type: "text" as const, text: file ? "Original SDK image block is supplied as native evidence beside this completed tool result."
        : "Original SDK image is unavailable (UNBOUND_PROVIDER_REFERENCE); do not infer its contents or recapture automatically." };
    } catch {
      return { type: "text" as const, text: "Original SDK image is unavailable (INVALID_IMAGE_REFERENCE); do not infer its contents or recapture automatically." };
    }
  });
  return { output: changed ? { ...output, value } : output, files };
}

function declaresImage(part: ContentPart): boolean {
  switch (part.type) {
    case "file": case "file-data": case "file-url":
      return typeof part.mediaType === "string" && (part.mediaType === "image" || part.mediaType.startsWith("image/"));
    case "image-data": case "image-url": case "image-file-id": case "image-file-reference": return true;
    default: return false;
  }
}

function nativeFile(part: ContentPart): FilePart | undefined {
  switch (part.type) {
    case "file": return { ...part, data: hydrateFileData(part.data) };
    case "file-data": case "image-data":
      return { type: "file", mediaType: part.mediaType, data: { type: "data", data: part.data }, providerOptions: part.providerOptions };
    case "file-url": case "image-url":
      return { type: "file", mediaType: part.type === "image-url" ? "image" : part.mediaType ?? "image",
        data: { type: "url", url: new URL(part.url) }, providerOptions: part.providerOptions };
    case "image-file-reference":
      return { type: "file", mediaType: "image", data: { type: "reference", reference: part.providerReference }, providerOptions: part.providerOptions };
    case "image-file-id":
      // A bare historical id has no retained provider binding. Never invent the current route as its owner.
      return typeof part.fileId === "string" ? undefined : { type: "file", mediaType: "image",
        data: { type: "reference", reference: part.fileId }, providerOptions: part.providerOptions };
    default: return undefined;
  }
}

function hydrateFileData(data: FilePart["data"]): FilePart["data"] {
  if (typeof data === "object" && data !== null && "type" in data && data.type === "url") {
    return { ...data, url: typeof data.url === "string" ? new URL(data.url) : data.url };
  }
  return data;
}
