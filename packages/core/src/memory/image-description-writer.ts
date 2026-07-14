/**
 * INPUT:  onImageTurn({characterId, refs, caption}) after an image chat turn; an injected vision LanguageModel, a narrow
 *         attachment reader, a bound episodic write op, and a logger
 * OUTPUT: createImageDescriptionWriter(deps) -> { onImageTurn } — reads the retained bytes, asks the VLM for a faithful
 *         description, writes ONE episodic memory via the EXISTING store path; never throws (warn + drop)
 * POS:    core/memory — the thin, DELETABLE image→text bridge (#17 decision 6, D28); adds no memory machinery, rides the
 *         existing write path; fired detached from chat-agent (mirrors autoMemory) so it costs the turn nothing
 */
import { ToolLoopAgent, type LanguageModel, type ModelMessage } from "ai";
import type { EpisodicWriteOp } from "./episodic-writer.ts";

// The description is the authoritative, PERMANENT record that replaces the image after its bytes expire (decision 6);
// keep it faithful, concise, and in the conversation's language so later text-model recall reads naturally.
const DESCRIBE_PROMPT =
  "You describe images for long-term memory. Describe the attached image(s) faithfully, concisely and objectively — " +
  "content, notable details, any visible text. The authoritative record replaces the image. Reply with ONLY the " +
  "description, at most 150 words, in the conversation's language.";

// Mid-range episodic importance for an auto-written image description (the store's own range is 3-7).
const IMAGE_IMPORTANCE = 4;

// The narrow reader (zero coupling to the media module): the store's AttachmentRead is assignable to this.
export interface ImageDescriptionAttachments {
  read(ref: string): { ok: true; mediaType: string; dataBase64: string } | { ok: false };
}

export interface ImageDescriptionLogger {
  warn(obj: object, msg: string): void;
}

export interface ImageDescriptionWriter {
  /** Detached, never rejects: read the retained images, describe them via the VLM, write one episodic memory. */
  onImageTurn(input: { characterId: string; refs: string[]; caption: string }): Promise<void>;
}

export interface ImageDescriptionWriterDeps {
  model: LanguageModel;
  attachments: ImageDescriptionAttachments;
  writeEpisode: EpisodicWriteOp;
  logger: ImageDescriptionLogger;
}

export function createImageDescriptionWriter(deps: ImageDescriptionWriterDeps): ImageDescriptionWriter {
  return {
    async onImageTurn({ characterId, refs, caption }) {
      try {
        const fileParts = readFileParts(deps.attachments, refs);
        if (fileParts.length === 0) return; // every retained image was GC'd / unreadable — nothing to describe
        const agent = new ToolLoopAgent({ model: deps.model, instructions: DESCRIBE_PROMPT });
        const result = await agent.generate({ messages: [describeMessage(caption, fileParts)] });
        const description = result.text.trim();
        if (description.length === 0) return;
        // ONE entry via the EXISTING episodic write path (no new memory machinery — D28); the prefix keeps recall readable.
        deps.writeEpisode({ characterId, content: `[image] ${description}`, importance: IMAGE_IMPORTANCE });
      } catch (error) {
        // Auto-memory's policy: a failed description is dropped (warn), never surfaced — the caller fired us detached.
        deps.logger.warn({ characterId, err: readable(error) }, "image description write failed; dropped");
      }
    },
  };
}

interface DescribeFilePart {
  type: "file";
  mediaType: string;
  data: string;
}

// A failed read (expired/missing) is skipped, not fatal; the retained image is best-effort input to the description.
function readFileParts(attachments: ImageDescriptionAttachments, refs: string[]): DescribeFilePart[] {
  const parts: DescribeFilePart[] = [];
  for (const ref of refs) {
    const read = attachments.read(ref);
    if (read.ok) parts.push({ type: "file", mediaType: read.mediaType, data: read.dataBase64 });
  }
  return parts;
}

// FilePart with RAW base64 (ImagePart is @deprecated in v7; a tagged data-URL throws — research r1); caption gives context.
function describeMessage(caption: string, fileParts: DescribeFilePart[]): ModelMessage {
  const context = caption.length > 0 ? `The user's caption: ${caption}` : "Describe the image(s).";
  return { role: "user", content: [{ type: "text", text: context }, ...fileParts] };
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
