/**
 * INPUT:  a verified transition candidate and the target epoch inside the outer publication transaction
 * OUTPUT: complete Local rows/Blocks or paired native/application replica checkpoints using the existing publishers
 * POS:    core/db — representation publication; never commits or selects authority independently
 */
import type { MemoryTransitionCandidate, MemoryTransitionPublication } from "@taki/shared";
import { createIntlSegmenterTokenizer } from "../memory/search-tokenizer.ts";
import { verifyTransitionNativeEvidence } from "../memory/transitions/transition-native-evidence.ts";
import { normalizeSnapshotMetadata } from "../memory/hindsight/hindsight-snapshot-contracts.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { readTransitionNativeEvidence } from "./memory-transition-candidate-repo.ts";
import { createHindsightReplicaLeaseRepo } from "./hindsight-replica-lease-repo.ts";
import { createReplicaRecordStore } from "./hindsight-replica-record-store.ts";
import { readApplicationCheckpoint, applicationCheckpointHash } from "./hindsight-application-replica-checkpoint.ts";
import { readReplicaCheckpoint } from "./hindsight-replica-checkpoint-store.ts";
import { publishTransitionApplicationSnapshot } from "./hindsight-application-replica-publication.ts";
import { createStructuredMemoryBlockRepo } from "./structured-memory-block-repo.ts";
import { getBlock } from "../memory/block-registry.ts";
import type { Database } from "./sqlite.ts";
import type { TransitionEvidenceContext } from "../memory/transitions/transition-evidence-context.ts";

export function publishTransitionRepresentations(db: Database, input: { candidate: MemoryTransitionCandidate; provider: "local" | "hindsight"; now: string; verification?: TransitionEvidenceContext }): MemoryTransitionPublication["checkpoints"] {
  const { candidate } = input;
  publishTransitionBlocks(db, candidate);
  const tokenizer = createIntlSegmenterTokenizer({ stoplist: true });
  const leases = createHindsightReplicaLeaseRepo(db, () => input.now);
  const state = { db, now: () => input.now, tokenizer, leases, records: createReplicaRecordStore(db, tokenizer),
    bankScope: (bankId: string) => {
      const scope = candidate.scopes.find((row) => row.nativeBankId === bankId)?.scope;
      if (!scope) throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); return scope;
    } };
  return candidate.scopes.map((scope) => {
    const evidence = readTransitionNativeEvidence(db, scope.evidenceId, input.verification); const proof = evidence.status.proof!;
    let checkpointHash: string | null = null;
    if (input.provider === "hindsight") {
      const lease = leases.acquire({ bankId: scope.nativeBankId, ownerId: `transition:${candidate.transitionId}`, durationMs: 60_000 });
      const checkpoint = publishTransitionApplicationSnapshot(state, { bankId: scope.nativeBankId,
        namespace: proof.application_snapshot.namespace, authorityEpochId: candidate.targetEpochId,
        expectedBank: { bankId: scope.nativeBankId, scope: scope.scope.kind, characterId: scope.scope.characterId },
        expectedCheckpoint: readApplicationCheckpoint(db, scope.nativeBankId) ?? null,
        expectedNativeCheckpoint: readReplicaCheckpoint(db, scope.nativeBankId) ?? null, lease, reset: true,
        deadlineAt: lease.expiresAt, bundle: input.verification ? input.verification.bundle(evidence) : verifyTransitionNativeEvidence(evidence),
        nativeBaseline: normalizeSnapshotMetadata(proof.native_snapshot), transitionEvidence: evidence, verification: input.verification });
      checkpointHash = applicationCheckpointHash(checkpoint); leases.release(lease);
    }
    return { bankId: scope.nativeBankId, evidenceId: scope.evidenceId, nativeSnapshotId: proof.native_snapshot.snapshot_id,
      applicationSnapshotId: proof.application_snapshot.snapshot_id, nativeCursor: proof.native_snapshot.manifest.end_cursor,
      applicationCursor: proof.application_snapshot.checkpoint.state_cursor, checkpointHash };
  });
}

export function publishTransitionBlocks(db: Database, candidate: Pick<MemoryTransitionCandidate, "state">): void {
  const repo = createStructuredMemoryBlockRepo(db);
  const keys = new Set(candidate.state.blocks.map((block) => JSON.stringify([block.block_id, block.scope.kind, block.scope.characterId])));
  const rows = db.prepare("SELECT block_id,scope_kind,character_id FROM taki_memory_blocks").all();
  if (rows.some((row) => !keys.has(JSON.stringify([row.block_id, row.scope_kind, row.character_id])))) {
    throw new Error("MEMORY_TRANSITION_STALE");
  }
  for (const block of candidate.state.blocks) {
    const definition = getBlock(block.block_id);
    if (!definition || definition.writer !== block.writer) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    const params = { id: block.block_id, kind: block.scope.kind, character: block.scope.characterId,
      content: block.content, revision: block.block_revision, updated: block.updated_at };
    const changed = db.prepare(`UPDATE taki_memory_blocks SET content=:content,revision=:revision,updated_at=:updated
      WHERE block_id=:id AND scope_kind=:kind AND ifnull(character_id,'')=ifnull(:character,'')`).run(params);
    if (!changed.changes) db.prepare("INSERT INTO taki_memory_blocks VALUES(:id,:kind,:character,:content,:revision,:updated)").run(params);
    const actual = repo.read(block.block_id, block.scope);
    if (transitionLocalHash(actual) !== transitionLocalHash({ blockId: block.block_id, scope: block.scope,
      content: block.content, revision: block.block_revision, updatedAt: block.updated_at })) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  }
}
