/**
 * INPUT:  owned B2/B4 activation and deterministic native evidence
 * OUTPUT: actual operation owner, healthy driver and composed provider runtime over the same SQLite database
 * POS:    core/testing — no test-only transition driver or publication shortcut
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createHindsightActivationHarness, ACTIVATION_CONFIG } from "../memory/hindsight-activation/hindsight-activation-fixture.ts";
import { publicationNativeEvidence } from "./memory-transition-publication-fixtures.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createHindsightApplicationReplicaRepo } from "../db/hindsight-application-replica-repo.ts";
import { createIntlSegmenterTokenizer } from "../memory/search-tokenizer.ts";
import { verifyTransitionNativeEvidence } from "../memory/transitions/transition-native-evidence.ts";
import { normalizeSnapshotMetadata } from "../memory/hindsight/hindsight-snapshot-contracts.ts";
import { createHealthyTransitionTransport } from "./memory-transition-healthy-transport.ts";
import { createConfigSource } from "../config/config-source.ts";
import { createConfigRepo } from "../db/config-repo.ts";
import { createCaptureLogger } from "./capture-logger.ts";
import { failingGenerateModel } from "./mock-language-model.ts";
import { hindsightFixtureSecrets } from "./hindsight-runtime-composition-fixtures.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { composeMemoryRuntime } from "../memory/runtime-composition.ts";
import { createHealthyTransitionService } from "../memory/transitions/transition-healthy-service.ts";
import { createMemoryOperationService } from "../memory/operations/memory-operation-service.ts";
import { fakeSetup } from "../memory/operations/memory-operation-fixtures.ts";
import { W3_AT } from "./memory-transition-candidate-fixtures.ts";
import { healthySourceEvidence } from "./memory-transition-healthy-journey-fixtures.ts";
import type { Database } from "../db/sqlite.ts";
import type { createTimelineRepo } from "../db/timeline-repo.ts";

export async function createHealthyTransitionHarness(options: { migrationVersion?: number; aliases?: boolean } = {}) {
  const clock = { value: W3_AT }; const now = () => clock.value;
  const h = createHindsightActivationHarness(options); await h.service.start(h.identity(), h.control());
  const { db } = h; const authority = createCanonicalMemoryAuthorityRepo(db);
  const localLineage = String(db.prepare("SELECT provider_lineage_id FROM canonical_memory_authority_epochs WHERE epoch_id=:id").get({ id: h.local.epochId })!.provider_lineage_id);
  const localBanks = authority.listBanks(h.local.epochId);
  const initial = publicationNativeEvidence(h, { transitionId: randomUUID(), localLineage, localBanks });
  if (options.aliases) {
    const index = initial.findIndex((value) => value.status.bank_id === h.banks.find((bank) => bank.scope === "global")!.nativeBankId);
    initial[index] = healthySourceEvidence(initial[index]!, h.local);
  }
  const application = createHindsightApplicationReplicaRepo({ db, tokenizer: createIntlSegmenterTokenizer({ stoplist: true }), now,
    bankScope: (bankId) => localBanks.find((bank) => bank.scope.kind === h.banks.find((row) => row.nativeBankId === bankId)!.scope)!.scope });
  for (const value of initial) {
    const proof = value.status.proof!; const bankId = value.status.bank_id;
    const scope = localBanks.find((bank) => bank.scope.kind === h.banks.find((row) => row.nativeBankId === bankId)!.scope)!.scope;
    const lease = application.leases.acquire({ bankId, ownerId: "healthy-fixture", durationMs: 60_000 });
    try { application.seedVerifiedSnapshot({ bankId, namespace: proof.application_snapshot.namespace, bundle: verifyTransitionNativeEvidence(value),
      nativeBaseline: normalizeSnapshotMetadata(proof.native_snapshot), authorityEpochId: "hindsight-epoch",
      expectedBank: { bankId, scope: scope.kind, characterId: scope.characterId }, expectedCheckpoint: null,
      expectedNativeCheckpoint: application.nativeCheckpoint(bankId) ?? null, lease, deadlineAt: lease.expiresAt }); }
    finally { application.leases.release(lease); }
  }
  const remote = createHealthyTransitionTransport(initial, db);
  const composed = composeHealthyTransitionHarness({ db, dataDir: h.dataDir, timeline: h.timeline, remote, clock });
  return { ...h, initial, remote, clock, ...composed,
    close: async () => { await composed.stop(); await h.close(); } };
}

export function composeHealthyTransitionHarness(input: { db: Database; dataDir: string;
  timeline: ReturnType<typeof createTimelineRepo>; remote: ReturnType<typeof createHealthyTransitionTransport>;
  clock: { value: string } }) {
  const { db, dataDir, timeline, remote, clock } = input; const now = () => clock.value;
  const { logger, records } = createCaptureLogger();
  const source = createConfigSource({ repo: createConfigRepo(db), env: { TAKI_HINDSIGHT_ENABLED: "true", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:18481" } });
  const runtime = composeMemoryRuntime({ db, dataDir, promptDir: join(dataDir, "prompt"), bootId: "healthy-fixture",
    model: failingGenerateModel(new Error("unexpected model request")), timeline, summaries: createSummaryRepo(db),
    windowStart: () => 1, estimatedTokens: () => 0, budget: () => 100_000, compact: { triggerRatio: 0.8, keepMessages: 3 }, env: {}, logger,
    hindsight: { source, secrets: hindsightFixtureSecrets().catalog, client: remote.client } });
  runtime.start(); const fault = { constructor: false };
  const ready = (epochId: string, provider: "local" | "hindsight") => {
    const value = provider === "local" ? runtime.bindingSnapshot() : runtime.hindsightBindingSnapshot();
    return value.lifetime === "running" && value.binding.kind === "published" && value.binding.epochId === epochId;
  };
  const service = createHealthyTransitionService({ db, ownerId: "healthy-owner", actorId: "operator", now, logger,
    fingerprint: () => ACTIVATION_CONFIG, client: () => { if (fault.constructor) throw new Error("owned constructor failure"); return remote.client; },
    runtime: runtime.transitions, ready, requestTimeoutMs: 1000, maintenanceTimeoutMs: 2000 });
  const owner = createMemoryOperationService({ db, live: () => null, setup: fakeSetup(), transition: service,
    bootId: "healthy-fixture", now, logger, onChanged: () => undefined });
  const request = async (recoveryTransitionId?: string, kind: "transition.return-local" | "transition.reenter-hindsight" = "transition.return-local") => {
    const value = await service.preview({ kind, recoveryTransitionId });
    return { kind: value.kind, requestId: randomUUID(), previewId: value.previewId, previewHash: value.previewHash,
      expected: value.expected, confirmation: "healthy-switch" as const, ...(value.recovery ? { recovery: value.recovery } : {}) };
  };
  return { fault, runtime, service, owner, request, records,
    stop: async () => { await service.stop(); await owner.stop(); await runtime.stop(); } };
}
