/**
 * INPUT:  structured Memory Block content, scope, and trusted writer actor
 * OUTPUT: revisioned whole-document read/replace with registry order rendering
 * POS:    core/db — Taki policy documents, independent of provider epochs and canonical FTS
 */
import { V1_BLOCKS, getBlock } from "../memory/block-registry.ts";
import { estimateTokens } from "../memory/token-estimator.ts";
import type { Database, SqlRow } from "./sqlite.ts";

export type BlockScope = { kind: "global"; characterId: null } | { kind: "character"; characterId: string };
export type BlockActor = "user" | "background";
export interface StructuredMemoryBlock { blockId: string; scope: BlockScope; content: string; revision: number; updatedAt: string; }
export interface StructuredMemoryBlockRepo { read(blockId: string, scope: BlockScope): StructuredMemoryBlock | undefined; replace(input: { blockId: string; scope: BlockScope; content: string; expectedRevision?: number; actor: BlockActor; now?: string }): StructuredMemoryBlock; render(scopes: BlockScope[]): string; }
export function createStructuredMemoryBlockRepo(db: Database): StructuredMemoryBlockRepo { return { read: (id, scope) => read(db, id, scope), replace: (input) => replace(db, input), render: (scopes) => render(db, scopes) }; }
function read(db: Database, blockId: string, scope: BlockScope): StructuredMemoryBlock | undefined { const row = db.prepare("SELECT * FROM taki_memory_blocks WHERE block_id=:id AND scope_kind=:kind AND ifnull(character_id,'')=ifnull(:character,'')").get({ id: blockId, kind: scope.kind, character: scope.characterId }); return row ? parse(row) : undefined; }
function replace(db: Database, input: { blockId: string; scope: BlockScope; content: string; expectedRevision?: number; actor: BlockActor; now?: string }): StructuredMemoryBlock {
  const def = getBlock(input.blockId); if (!def) throw new Error("MEMORY_INVALID_REQUEST: unknown block");
  if ((def.ownership === "global" ? "global" : "character") !== input.scope.kind) throw new Error("MEMORY_INVALID_REQUEST: block scope mismatch");
  if (def.writer !== input.actor) throw new Error("MEMORY_CAPABILITY_UNSUPPORTED: block writer");
  if (input.expectedRevision !== undefined && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)) {
    throw new Error("MEMORY_INVALID_REQUEST: invalid block revision");
  }
  const now = input.now ?? new Date().toISOString();
  let result: StructuredMemoryBlock | undefined;
  db.transaction(() => {
    const old = read(db, input.blockId, input.scope);
    // Zero means the reviewer saw an absent block. A concurrent creation must not be overwritten.
    if (input.expectedRevision !== undefined && (old?.revision ?? 0) !== input.expectedRevision) throw new Error("MEMORY_REVISION_MISMATCH");
    const revision = (old?.revision ?? 0) + 1;
    if (old) {
      db.prepare("UPDATE taki_memory_blocks SET content=:content,revision=:revision,updated_at=:updated_at WHERE block_id=:id AND scope_kind=:kind AND ifnull(character_id,'')=ifnull(:character,'')")
        .run({ content: input.content, revision, updated_at: now, id: input.blockId, kind: input.scope.kind, character: input.scope.characterId });
    } else {
      db.prepare("INSERT INTO taki_memory_blocks (block_id,scope_kind,character_id,content,revision,updated_at) VALUES (:id,:kind,:character,:content,:revision,:updated_at)")
        .run({ id: input.blockId, kind: input.scope.kind, character: input.scope.characterId, content: input.content, revision, updated_at: now });
    }
    result = { blockId: input.blockId, scope: input.scope, content: input.content, revision, updatedAt: now };
  });
  if (!result) throw new Error("MEMORY_INTERNAL_ERROR: block replacement did not settle");
  return result;
}
function parse(row: SqlRow): StructuredMemoryBlock { return { blockId: String(row.block_id), scope: row.scope_kind === "global" ? { kind: "global", characterId: null } : { kind: "character", characterId: String(row.character_id) }, content: String(row.content), revision: Number(row.revision), updatedAt: String(row.updated_at) }; }
function render(db: Database, scopes: BlockScope[]): string {
  const sections: string[] = [];
  for (const definition of V1_BLOCKS) {
    const kind = definition.ownership === "global" ? "global" : "character";
    const scope = scopes.find((candidate) => candidate.kind === kind);
    if (!scope) continue;
    const block = read(db, definition.id, scope); if (!block) continue;
    const content = fitContent(block.content, definition.budgetTokens);
    sections.push(`${definition.header} [budget: ${estimateTokens(content)}/${definition.budgetTokens} tokens]\n${content}`);
  }
  return sections.join("\n\n");
}
function fitContent(content: string, budget: number): string {
  if (estimateTokens(content) <= budget) return content;
  const points = Array.from(content); const marker = "\n[truncated to block budget]"; let low = 0; let high = points.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2); const candidate = `${points.slice(0, middle).join("").trimEnd()}${marker}`;
    if (estimateTokens(candidate) <= budget) low = middle; else high = middle - 1;
  }
  return `${points.slice(0, low).join("").trimEnd()}${marker}`;
}
