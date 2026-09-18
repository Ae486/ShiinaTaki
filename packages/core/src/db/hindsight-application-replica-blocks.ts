/**
 * INPUT:  verified application Block artifacts and their exact original writer/revision bodies
 * OUTPUT: internal exact-revision Core Block restoration with local-edit conflict detection
 * POS:    core/db — recovery never impersonates a background edit or increments the restored Block revision
 */
import { TakiApplicationBlockBodySchema, type MemoryBankScope, type TakiApplicationArtifact, type TakiApplicationBlockBody } from "@taki/shared";
import { getBlock } from "../memory/block-registry.ts";
import { hindsightApplicationBytesHash, sameApplicationValue, type HindsightApplicationScope } from "../memory/hindsight/hindsight-application-integrity.ts";
import type { HindsightApplicationEvidenceAccess } from "./hindsight-application-replica-contract.ts";
import { APPLICATION_SCOPE_WHERE, applicationScopeParams, applicationStoredBytes, parseApplicationStoredBytes } from "./hindsight-application-replica-codec.ts";
import { createStructuredMemoryBlockRepo } from "./structured-memory-block-repo.ts";
import type { Database } from "./sqlite.ts";

export function restoreApplicationBlock(input: {
  db: Database; scope: HindsightApplicationScope; access: HindsightApplicationEvidenceAccess; artifact: TakiApplicationArtifact;
  bankScope: MemoryBankScope;
}): void {
  const { artifact } = input;
  if (artifact.tombstoned) return; // Artifact retirement never grants authority to delete a Core-owned user document.
  if (artifact.key.artifact_kind !== "block" || artifact.binding.kind !== "core_block") invalid();
  const content = input.access.body(artifact.body_ref).content;
  if (content.body_schema !== "application-block.v1") invalid();
  const body = TakiApplicationBlockBodySchema.parse(content.value); const definition = getBlock(body.block_id);
  if (!definition || definition.writer !== body.writer || !sameApplicationValue(body.scope, input.bankScope)
    || (definition.ownership === "global" ? "global" : "character") !== body.scope.kind) invalid();
  const blockKey = JSON.stringify([body.block_id, body.scope.kind, body.scope.characterId]);
  const params = { ...applicationScopeParams(input.scope), key: blockKey };
  const old = createStructuredMemoryBlockRepo(input.db).read(body.block_id, body.scope);
  const restored = input.db.prepare(`SELECT * FROM hindsight_application_replica_block_restores
    WHERE ${APPLICATION_SCOPE_WHERE} AND block_key=:key`).get(params);
  const previous = restored ? TakiApplicationBlockBodySchema.parse(parseApplicationStoredBytes(restored.restored_bytes, restored.bytes_sha256)) : null;
  if (previous && body.block_revision < previous.block_revision) conflict();
  if (previous && body.block_revision === previous.block_revision && !sameApplicationValue(previous, body)) conflict();
  if (old && !sameApplicationValue(old, blockValue(body)) && (!previous || !sameApplicationValue(old, blockValue(previous)))) conflict();
  if (!old || !sameApplicationValue(old, blockValue(body))) writeBlock(input.db, body);
  if (!sameApplicationValue(createStructuredMemoryBlockRepo(input.db).read(body.block_id, body.scope), blockValue(body))) invalid();
  const bytes = applicationStoredBytes(body);
  input.db.prepare(`INSERT INTO hindsight_application_replica_block_restores
    (provider_lineage,bank_generation,application_id,bank_id,block_key,body_id,block_revision,restored_bytes,bytes_sha256)
    VALUES (:lineage,:generation,:application,:bank,:key,:body,:revision,:bytes,:hash)
    ON CONFLICT(provider_lineage,bank_generation,application_id,bank_id,block_key) DO UPDATE SET
    body_id=excluded.body_id,block_revision=excluded.block_revision,restored_bytes=excluded.restored_bytes,bytes_sha256=excluded.bytes_sha256`)
    .run({ ...params, body: artifact.body_ref.body_id, revision: body.block_revision, bytes, hash: hindsightApplicationBytesHash(bytes) });
}

function writeBlock(db: Database, body: TakiApplicationBlockBody): void {
  const params = { id: body.block_id, kind: body.scope.kind, character: body.scope.characterId,
    content: body.content, revision: body.block_revision, updated: body.updated_at };
  const changed = db.prepare(`UPDATE taki_memory_blocks SET content=:content,revision=:revision,updated_at=:updated
    WHERE block_id=:id AND scope_kind=:kind AND ifnull(character_id,'')=ifnull(:character,'')`).run(params);
  if (changed.changes === 0) db.prepare(`INSERT INTO taki_memory_blocks
    (block_id,scope_kind,character_id,content,revision,updated_at) VALUES (:id,:kind,:character,:content,:revision,:updated)`).run(params);
}

function blockValue(body: TakiApplicationBlockBody) {
  return { blockId: body.block_id, scope: body.scope, content: body.content, revision: body.block_revision, updatedAt: body.updated_at };
}
function invalid(): never { throw new Error("HINDSIGHT_APPLICATION_BLOCK_RESTORE_INVALID"); }
function conflict(): never { throw new Error("HINDSIGHT_APPLICATION_BLOCK_RESTORE_CONFLICT"); }
