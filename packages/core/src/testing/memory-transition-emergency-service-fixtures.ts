/**
 * INPUT:  an owned healthy fixture or physically reopened copy and the same cumulative transport counters
 * OUTPUT: production offline service, operation owner and explicit operator request builder
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
