/**
 * INPUT:  an owned SQLite database seeded with a real B2-activated Local epoch, verified B3 rows and a scripted Utility model
 * OUTPUT: createHindsightActivationHarness() -> the real Local subsystem (fence/ingestion), the activation transport double, the
 *         activation service over a programmable fake binding seam, Core-minted identities and captured checkpoints, and
 *         recordedVerifications() (every native verification Core recorded); never imported by production code
 * POS:    core/memory/hindsight-activation — test-only harness shared by the service, kind, custody-carry and custody-routing tests
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { HindsightSetupSnapshotSchema, HindsightSnapshotRecordWireSchema, type HindsightCompatibilityProjection, type HindsightCurrentVerificationCandidate,
  type HindsightSetupSnapshot, type MemoryHindsightProducerRef,
  type HindsightSnapshotRecordWire, type MemoryOperation, type MemoryOperationRequest, type TimelineEntry } from "@taki/shared";
import { loadMemoryConfig } from "../../config/memory-config.ts";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { LOCAL_COVERAGE_NOW, seedLocalB2CoverageFixture } from "../../db/hindsight-local-coverage-fixtures.ts";
import { createPrimaryMemoryCustody } from "../../db/primary-memory-custody-repo.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createTimelineRepo } from "../../db/timeline-repo.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { createHindsightActivationTransport } from "../../testing/hindsight-activation-transport.ts";
import { failingGenerateModel } from "../../testing/mock-language-model.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { createCanonicalLocalSubsystem } from "../canonical-local-subsystem.ts";
import { hindsightBankBindings } from "../hindsight/hindsight-bank-identity.ts";
import { loadTakiBankTemplate, takiBankTemplateDigest } from "../hindsight/taki-bank-template-v1.ts";
import type { HindsightBindingState } from "../hindsight-runtime-binding.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { fakeSetup } from "../operations/memory-operation-fixtures.ts";
import { createMemoryOperationService } from "../operations/memory-operation-service.ts";
import { createUtilitySlot } from "../utility-slot.ts";
import type { HindsightActivationIdentity } from "./hindsight-activation-chain.ts";
import { createHindsightActivationService, type HindsightActivationControl, type HindsightActivationRuntime } from "./hindsight-activation-service.ts";
import { readHindsightActivationStatus } from "./hindsight-activation-status.ts";

export const ACTIVATION_LINEAGE = "11111111-1111-4111-8111-111111111111";
export const ACTIVATION_CONFIG = "a".repeat(64);
export const ACTIVATION_NOW = "2026-09-23T00:00:00.000Z";
const CHARACTER = "taki";

export function createHindsightActivationHarness(options: { model?: LanguageModel; now?: () => string; path?: string } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-hindsight-activation-"));
  const db = openDatabase({ path: options.path ?? join(dataDir, "memory.sqlite"), migrations: MIGRATIONS });
  const local = seedLocalB2CoverageFixture(db);
  const authority = createCanonicalMemoryAuthorityRepo(db);
  authority.createBank({ authorityEpochId: local.epochId, bankId: "bank-taki", scope: { kind: "character", characterId: CHARACTER }, name: CHARACTER,
    disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {}, createdAt: LOCAL_COVERAGE_NOW, updatedAt: LOCAL_COVERAGE_NOW });
  const banks = seedBankSetup(db);
  db.prepare("UPDATE hindsight_connection_state SET phase='configured',revision=2,config_fingerprint=:config,compatibility_json=:json WHERE singleton=1")
    .run({ config: ACTIVATION_CONFIG, json: JSON.stringify({ providerLineage: ACTIVATION_LINEAGE }) });
  const transport = createHindsightActivationTransport({ banks: Object.fromEntries(banks.map((bank) => [bank.nativeBankId, bank.baseline])) });
  const { logger, records: logs } = createCaptureLogger();
  const model = options.model ?? failingGenerateModel(new Error("harness forbids unexpected Utility model calls"));
  const utility = createUtilitySlot({ mainModel: model, logger });
  const timeline = createTimelineRepo(db);
  const subsystem = createCanonicalLocalSubsystem({ db, epochId: local.epochId, promptDir: join(dataDir, "prompt"), timeline, utility,
    config: loadMemoryConfig({}), logger });
  const now = options.now ?? (() => ACTIVATION_NOW);
  const custody = createPrimaryMemoryCustody({ db, bootId: "activation-boot", now });
  const checkpoints: MemoryHindsightProducerRef[] = [];
  const settle = { calls: 0 };
  const binding = fakeBinding(db, subsystem);
  const service = createHindsightActivationService({ db, client: () => transport.client, fingerprint: () => binding.fingerprint,
    setup: { status: () => setupSnapshot(db) }, runtime: binding.runtime,
    localRuntime: () => ({ fence: subsystem.fence, settle: async () => { settle.calls += 1; }, ingestion: subsystem.ingestion }),
    custody, now, logger, quiesceTimeoutMs: 1_000 });
  const identity = (operationId = "op-1"): HindsightActivationIdentity => ({ operationId, runId: local.runId, predecessorEpochId: local.epochId,
    hindsightEpochId: "hindsight-epoch", transactionId: "hindsight-tx",
    banks: banks.map((bank, index) => ({ nativeBankId: bank.nativeBankId, scope: bank.scope,
      replicaEpochId: `4444444${index}-4444-4444-8444-444444444444`, verificationId: `3333333${index}-3333-4333-8333-333333333333` })) });
  const control = (overrides: Partial<HindsightActivationControl> = {}): HindsightActivationControl => ({
    checkpoint: (producer) => { checkpoints.push(producer); }, stopRequested: () => false, ...overrides });
  const primary = (user = "我最近工作卡住了，真的很烦", assistant = "我会记得你说的「很烦」"): TimelineEntry[] => {
    const entries = [timeline.append({ characterId: CHARACTER, role: "user", content: user }),
      timeline.append({ characterId: CHARACTER, role: "assistant", content: assistant })];
    subsystem.recordPrimaryCommitted({ characterId: CHARACTER, entries });
    return entries;
  };
  return { db, dataDir, local, banks, transport, subsystem, custody, service, identity, control, checkpoints, primary, timeline, logs, settle, utility, binding,
    /** A fresh operation owner over the same database; a different bootId simulates a Core restart of the owner. */
    owner: (bootId = "boot-a") => {
      const changes: MemoryOperation[] = [];
      const operations = createMemoryOperationService({ db, live: () => null, setup: { ...fakeSetup(), status: () => setupSnapshot(db) }, hindsight: service,
        bootId, now, onChanged: (operation) => changes.push(operation), logger });
      return { service: operations, changes, status: () => readHindsightActivationStatus({ service, operations, now }),
        settled: async (request: MemoryOperationRequest) => { const admitted = operations.submit(request); await operations.stop(); return operations.status(admitted.operationId); } };
    },
    close: async () => { await utility.stop(); db.close(); rmTempDir(dataDir); } };
}
export type HindsightActivationHarness = ReturnType<typeof createHindsightActivationHarness>;
export type HindsightActivationOwner = ReturnType<HindsightActivationHarness["owner"]>;

/** Every native verification Core recorded, oldest first, with the Bank and preparation it verifies. */
export function recordedVerifications(db: Database) {
  return db.prepare(`SELECT c.verification_id,c.preparation_id,p.bank_id,c.candidate_json FROM hindsight_current_verification_candidates c
    JOIN hindsight_current_preparations p ON p.preparation_id=c.preparation_id ORDER BY c.rowid`).all().map((row) => ({
    verificationId: String(row.verification_id), preparationId: String(row.preparation_id), bankId: String(row.bank_id),
    request: (JSON.parse(String(row.candidate_json)) as HindsightCurrentVerificationCandidate).request }));
}

export interface FakeHindsightBinding {
  state: HindsightBindingState; stopped: boolean; publishFails: boolean; recoverable: number; binds: string[]; recovers: string[];
  fingerprint: string | null; runtime: HindsightActivationRuntime;
}

/** A programmable stand-in for the composition's binding seam; the real rebind is covered by the composition tests. */
function fakeBinding(db: Database, subsystem: ReturnType<typeof createCanonicalLocalSubsystem>): FakeHindsightBinding {
  const publish = (epochId: string): void => {
    if (binding.publishFails) {
      binding.state = { kind: "unavailable", epochId, code: "MEMORY_HINDSIGHT_BINDING_FAILED" };
      throw new Error("MEMORY_INTEGRITY_ERROR: fixture Hindsight binding failed");
    }
    binding.state = { kind: "published", epochId };
  };
  const binding: FakeHindsightBinding = {
    state: { kind: "none" }, stopped: false, publishFails: false, recoverable: 0, binds: [], recovers: [], fingerprint: ACTIVATION_CONFIG,
    runtime: {
      bindingSnapshot: () => {
        const selection = readMemoryAuthoritySelection(db);
        const published = selection.mode === "canonical-local" && subsystem.fence.writable();
        return { selection: selection.mode, selectedEpochId: selection.epochId, binding: published ? { kind: "published", epochId: selection.epochId ?? "" } : { kind: "none" },
          lifetime: "running", flush: published ? "available" : "failing" };
      },
      hindsightBindingSnapshot: () => {
        const selection = readMemoryAuthoritySelection(db);
        return { selection: selection.mode, selectedEpochId: selection.epochId, binding: binding.state,
          lifetime: binding.stopped ? "stopped" : "running", flush: binding.state.kind === "published" && !binding.stopped ? "available" : "failing" };
      },
      bindHindsight: (epochId) => {
        const selection = readMemoryAuthoritySelection(db);
        if (selection.mode !== "hindsight" || selection.epochId !== epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
        binding.binds.push(epochId); publish(epochId);
      },
      recoverHindsightBinding: (epochId) => {
        const selection = readMemoryAuthoritySelection(db);
        if (selection.mode !== "hindsight" || selection.epochId !== epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
        binding.recovers.push(epochId);
        const reconciledGroups = binding.recoverable; binding.recoverable = 0;
        if (binding.state.kind === "published") return { binding: "healthy", reconciledGroups };
        publish(epochId);
        return { binding: "published", reconciledGroups };
      },
    },
  };
  return binding;
}

function seedBankSetup(db: Database) {
  const setup = createHindsightBankSetupRepo(db);
  return hindsightBankBindings(CHARACTER).map((binding) => {
    const template = loadTakiBankTemplate("taki-bank-v1", binding.scope);
    setup.upsert({ scope: binding.scope, canonicalIdentity: binding.canonicalIdentity, externalBankId: binding.externalBankId,
      templateRevision: "taki-bank-v1", templateDigest: takiBankTemplateDigest(template), status: "verified", operationIds: [],
      lastVerifiedAt: LOCAL_COVERAGE_NOW, lastError: null });
    return { scope: binding.scope, nativeBankId: binding.externalBankId, baseline: baselineRecords(binding.externalBankId, template) };
  });
}

/** The native Bank as B3 left it: the Bank row plus every template-owned mental model and directive. */
export function baselineRecords(bankId: string, template: ReturnType<typeof loadTakiBankTemplate>): HindsightSnapshotRecordWire[] {
  const at = LOCAL_COVERAGE_NOW;
  const bank = HindsightSnapshotRecordWireSchema.parse({ object_kind: "bank", object_id: bankId, object_revision: 1,
    payload: { bank_id: bankId, name: bankId, disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "", config: template.manifest.bank, created_at: at, updated_at: at } });
  const models = (template.manifest.mental_models ?? []).map((model) => HindsightSnapshotRecordWireSchema.parse({
    object_kind: "mental_model", object_id: model.id, object_revision: 2,
    payload: { mental_model_id: model.id, bank_id: bankId, subtype: "pinned", name: model.name, source_query: model.source_query,
      content: "Authored continuity.", tags: model.tags, max_tokens: model.max_tokens, trigger: {}, last_refreshed_at: null,
      created_at: at, reflect_response: null, structured_content: null } }));
  const directives = (template.manifest.directives ?? []).map((directive, index) => HindsightSnapshotRecordWireSchema.parse({
    object_kind: "directive", object_id: `directive-${index}`, object_revision: 3,
    payload: { ...directive, directive_id: `directive-${index}`, bank_id: bankId, created_at: at, updated_at: at } }));
  return [bank, ...models, ...directives];
}

/** The persisted B3 phase/revision/fingerprint with a synthetic full compatibility projection (the seeded JSON only carries the lineage). */
function setupSnapshot(db: Database): HindsightSetupSnapshot {
  const row = db.prepare("SELECT phase,revision,config_fingerprint FROM hindsight_connection_state WHERE singleton=1").get();
  const phase = HindsightSetupSnapshotSchema.shape.phase.parse(row?.phase ?? "configured");
  const support = { state: "supported" as const, reason: "all_contracts_available" as const };
  const versioned = { version: "1.0.0", support };
  const compatibility: HindsightCompatibilityProjection = {
    baseApiVersion: "0.9.0", compatibilityVersion: "1.0.0", compatibilityBuild: "taki-memory-hindsight-0.9.0-d78-v1",
    providerLineage: ACTIVATION_LINEAGE, databaseDialect: "postgresql", storageMode: "sql_rows", support, journalVersion: 1, snapshotVersion: 1,
    contracts: { changeJournal: versioned, conditionalMutation: versioned, logicalSnapshot: versioned, additiveObservationInstructions: versioned, controlledLayerProjection: versioned },
  };
  return { revision: Number(row?.revision ?? 2), phase, lastSuccessfulPhase: "configured", configFingerprint: row?.config_fingerprint === null ? null : String(row?.config_fingerprint ?? ACTIVATION_CONFIG),
    attemptId: null, compatibility: phase === "configured" ? compatibility : null,
    banks: createHindsightBankSetupRepo(db).list(), modelHealth: "not-run", latestError: null, lastAttemptAt: null, lastSuccessAt: ACTIVATION_NOW, updatedAt: ACTIVATION_NOW };
}
