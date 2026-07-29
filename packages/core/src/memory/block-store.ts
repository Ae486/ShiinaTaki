/**
 * INPUT:  a blocks root dir under the Workspace + block refs (registry id + the current characterId)
 * OUTPUT: createBlockStore({root}) -> { readBlock, writeBlock, root }; BlockWriteResult
 * POS:    core/memory — Memory Block IO: pure-markdown files outside the entry tree (never FTS-indexed), read fresh
 *         per turn, written only by the registry's declared writer (invariant 1, Workspace-scoped)
 */
import { readFileSync } from "node:fs";
import { getBlock, type BlockDefinition } from "./block-registry.ts";
import { assertSafeSegment, isSafeSegment, resolveWithin } from "./naming.ts";
import { stripNoteBlock } from "./strip-note.ts";
import { writeAtomic } from "./write-atomic.ts";

export interface BlockRef {
  id: string;
  /** The current character; required by per-character blocks, refused by global ones (placement is registry data). */
  characterId?: string;
}

export type BlockWriter = BlockDefinition["writer"];

export type BlockWriteResult = { ok: true; path: string } | { ok: false; reason: string };

export interface BlockStore {
  /** The block's text, note-stripped; `undefined` when it is absent or empty — an absent block renders nothing (D28). */
  readBlock(ref: BlockRef): string | undefined;
  /** Write the whole block. REFUSES (never throws) when the caller is not the registry's declared writer. */
  writeBlock(input: BlockRef & { content: string; caller: BlockWriter }): BlockWriteResult;
  readonly root: string;
}

export function createBlockStore(deps: { root: string }): BlockStore {
  const { root } = deps;

  return {
    root,

    // Read fresh on every call, deliberately WITHOUT the persona-provider's boot cache: the user hand-edits
    // `user-card.md` in a text editor and must not have to restart for the next turn to see it, and the tidy pass
    // rewrites the background blocks mid-session. Three small sync reads per turn is noise next to a model call.
    readBlock({ id, characterId }) {
      const block = requireBlock(id);
      // A characterId is runtime protocol data (`chat.send` only constrains it to a non-empty string), so an
      // unsafe one means "no block for this character" — the assemble hot path must never die on it. The placement
      // checks inside resolveBlockPath stay throws: those can only be a wiring bug.
      if (block.ownership === "per-character" && characterId !== undefined && !isSafeSegment(characterId)) {
        return undefined;
      }
      const path = resolveBlockPath(root, block, characterId);
      let text: string;
      try {
        text = stripNoteBlock(readFileSync(path, "utf8"));
      } catch {
        return undefined; // absent or unreadable: the block is simply off; the assemble hot path must never throw
      }
      return text.length > 0 ? text : undefined;
    },

    // Policy refusals are RESULTS, not exceptions: this seam is what the tidy pass's block tool rides, and a tool
    // needs a reason it can report. Genuine I/O failures still throw — they are not "you may not", they are broken.
    writeBlock({ id, characterId, content, caller }) {
      const block = getBlock(id);
      if (!block) return { ok: false, reason: `unknown memory block: ${id}` };
      if (block.writer !== caller) {
        return { ok: false, reason: `block ${id} is written by ${block.writer}, not by ${caller}` };
      }
      let path: string;
      try {
        path = resolveBlockPath(root, block, characterId);
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
      writeAtomic(path, content);
      return { ok: true, path };
    },
  };
}

function requireBlock(id: string): BlockDefinition {
  const block = getBlock(id);
  if (!block) throw new Error(`unknown memory block: ${id}`);
  return block;
}

// Ownership decides the file: global lives at blocks/global/<id>.md, per-character at blocks/characters/<cid>/<id>.md.
// A mis-scoped ref is refused rather than silently placed — a global block written per-character would fork the one
// copy the whole point of the block is to keep.
function resolveBlockPath(root: string, block: BlockDefinition, characterId: string | undefined): string {
  if (block.ownership === "global") {
    if (characterId) throw new Error(`block ${block.id} is global; a characterId does not apply`);
    return resolveWithin(root, "global", `${block.id}.md`);
  }
  if (!characterId) throw new Error(`block ${block.id} is per-character but no characterId was given`);
  assertSafeSegment(characterId, "characterId");
  return resolveWithin(root, "characters", characterId, `${block.id}.md`);
}
