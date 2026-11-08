/**
 * INPUT:  an owned healthy fixture or physically reopened copy and the same cumulative transport counters
 * OUTPUT: production offline service, operation owner, request builder and missing/rebinding paired-replica events
 * POS:    core/testing — no native process, credential, corpus access or emergency publication shortcut
 */
import { randomUUID } from "node:crypto";
import type { Database } from "../db/sqlite.ts";
import type { composeMemoryRuntime } from "../memory/runtime-composition.ts";
import { createConfigSource } from "../config/config-source.ts";
import { createConfigRepo } from "../db/config-repo.ts";
import { createCaptureLogger } from "./capture-logger.ts";
import { hindsightFixtureSecrets } from "./hindsight-runtime-composition-fixtures.ts";
import { composeMemoryTransitions } from "../boot/memory-transition-boot.ts";
import { createMemoryOperationService } from "../memory/operations/memory-operation-service.ts";
import { fakeSetup } from "../memory/operations/memory-operation-fixtures.ts";
import { createHindsightBackupService } from "../memory/hindsight-backup/hindsight-backup-service.ts";
import { createHindsightBackupStore } from "../memory/hindsight-backup/hindsight-backup-store.ts";
import { readHindsightBackupCustody } from "../memory/hindsight-backup/hindsight-backup-custody.ts";
import type { createHealthyTransitionTransport } from "./memory-transition-healthy-transport.ts";
import { createHindsightApplicationReplicaRepo } from "../db/hindsight-application-replica-repo.ts";
import { readApplicationCheckpoint } from "../db/hindsight-application-replica-checkpoint.ts";
import { listApplicationHeads } from "../db/hindsight-application-replica-heads.ts";
import { createApplicationEvidenceAccess } from "../db/hindsight-application-replica-evidence.ts";
import { createIntlSegmenterTokenizer } from "../memory/search-tokenizer.ts";
import { applicationTestEvent, applicationTestMemoryPayload, applicationTestNative, type ApplicationNativeFixture } from "./hindsight-application-fixtures.ts";

/** A completed Native write can reach the paired replica before its Taki policy is confirmed. */
export function appendUnboundEmergencyMemory(db: Database, bankId: string) {
  const checkpoint = readApplicationCheckpoint(db, bankId);
  if (!checkpoint) throw new Error("owned fixture checkpoint missing");
  const scope = { bankId, namespace: checkpoint.namespace };
  const native = applicationTestNative({ scope, kind: "memory_unit", cursor: checkpoint.checkpoint.native_cursor + 1,
    payload: applicationTestMemoryPayload({ bank_id: bankId, memory_id: "owned-post-turn-memory", document_id: null }) });
  return applyEmergencyMemory(db, checkpoint, native);
}

/** Native retains the previous artifact when publishing a changed version before Core can rebind it. */
export function appendRebindingEmergencyMemory(db: Database, bankId: string) {
  const checkpoint = readApplicationCheckpoint(db, bankId);
  if (!checkpoint) throw new Error("owned fixture checkpoint missing");
  const scope = { bankId, namespace: checkpoint.namespace };
  const previous = listApplicationHeads(db, scope).find(({ head }) => head.object_kind === "memory_unit" && head.binding_state === "bound")?.head;
  if (!previous?.version || !previous.body_ref || !previous.bound_artifact) throw new Error("owned fixture bound Memory missing");
  const access = createApplicationEvidenceAccess(db, scope);
  const body = access.body(previous.body_ref).content;
  if (body.body_schema !== "application-native-record.v1" || !("memory_id" in body.value.payload)) throw new Error("owned fixture Memory body missing");
  const revision = previous.version.object_revision + 1;
  const native = applicationTestNative({ scope, kind: "memory_unit", revision, cursor: checkpoint.checkpoint.native_cursor + 1,
    payload: { ...body.value.payload, text: "Owned changed Memory awaiting rebinding", revision },
    bindingState: "rebind_required", boundArtifact: access.artifact(previous.bound_artifact) });
  native.head.previous_version = previous.version;
  native.head.cause = "native_change";
  return applyEmergencyMemory(db, checkpoint, native);
}

function applyEmergencyMemory(db: Database, checkpoint: NonNullable<ReturnType<typeof readApplicationCheckpoint>>, native: ApplicationNativeFixture) {
  const bankId = checkpoint.bankId;
  const scope = { bankId, namespace: checkpoint.namespace };
  const application = createHindsightApplicationReplicaRepo({ db, tokenizer: createIntlSegmenterTokenizer({ stoplist: true }),
    now: () => checkpoint.verifiedAt, bankScope: () => checkpoint.bankScope });
  const lease = application.leases.acquire({ bankId, ownerId: "emergency-policy-fixture", durationMs: 60_000 });
  try {
    application.applyEvent({ ...scope, authorityEpochId: checkpoint.authorityEpochId,
      expectedBank: { bankId, scope: checkpoint.bankScope.kind, characterId: checkpoint.bankScope.characterId },
      expectedCheckpoint: checkpoint, expectedNativeCheckpoint: checkpoint.native, lease, deadlineAt: lease.expiresAt,
      event: applicationTestEvent({ scope, native: [native], from: checkpoint.checkpoint }) });
  } finally { application.leases.release(lease); }
  return native.head;
}

export function composeEmergencyFixture(h: { db: Database; dataDir: string; runtime: ReturnType<typeof composeMemoryRuntime>;
  clock: { value: string }; remote: ReturnType<typeof createHealthyTransitionTransport> }) {
  const { logger } = createCaptureLogger();
  const config = createConfigSource({ repo: createConfigRepo(h.db), env: { TAKI_HINDSIGHT_ENABLED: "false" } });
  const secrets = hindsightFixtureSecrets(); secrets.state.value = null;
  const backup = createHindsightBackupService({ db: h.db, store: createHindsightBackupStore(h.dataDir), logger,
    route: { available: () => true, snapshot: async () => { throw new Error("unexpected backup Native call"); }, readBack: async () => null },
    custody: () => readHindsightBackupCustody({ catalog: secrets.catalog, storeId: "owned" }), missingCredentials: () => [], now: () => h.clock.value });
  const service = composeMemoryTransitions({ db: h.db, config, secrets: secrets.catalog,
    runtime: h.runtime, ownerId: "emergency-owner", actorId: "operator", logger, client: h.remote.client, now: () => h.clock.value, backup });
  const owner = createMemoryOperationService({ db: h.db, live: h.runtime.operations, setup: fakeSetup(), transition: service,
    bootId: "healthy-fixture", logger, now: () => h.clock.value, onChanged: () => undefined, backup });
  const request = async (recoveryTransitionId?: string) => {
    const preview = await service.preview({ kind: "transition.emergency-local", recoveryTransitionId });
    if (!preview.expected) throw new Error(`owned fixture refused: ${preview.blocking.join(",")}`);
    return { kind: preview.kind, previewId: preview.previewId, previewHash: preview.previewHash, expected: preview.expected,
      requestId: randomUUID(), confirmation: "emergency-takeover" as const, ...(preview.recovery ? { recovery: preview.recovery } : {}) };
  };
  return { backup, emergency: service, emergencyOwner: owner, emergencyRequest: request,
    stopEmergency: async () => { await service.stop(); await backup.stop(); await owner.stop(); } };
}
