/**
 * INPUT:  synthetic B3 setup/secret projections, exact native/application bundles and an owned temporary directory
 * OUTPUT: real SQLite and runtime/subsystem constructors with deterministic transport and optional review hint capture
 * POS:    core/testing — synthetic setup only; native extraction/PG and real credentials are outside this fixture
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import type { TakiApplicationStateChangePage, TakiApplicationHydrateRequest, TakiApplicationSnapshotRequest } from "@taki/shared";
import { createConfigSource } from "../config/config-source.ts";
import { loadMemoryConfig } from "../config/memory-config.ts";
import { createConfigRepo } from "../db/config-repo.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createHindsightBankSetupRepo } from "../db/hindsight-bank-setup-repo.ts";
import { createHindsightApplicationReplicaRepo } from "../db/hindsight-application-replica-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createHistoricalMainTimelineRepo } from "./memory-historical-timeline-fixture.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import { createCaptureLogger } from "./capture-logger.ts";
import { failingGenerateModel } from "./mock-language-model.ts";
import { rmTempDir } from "./rm-temp.ts";
import { APPLICATION_TEST_AT, APPLICATION_TEST_SCOPE, applicationTestSnapshot, applicationTestNativeBaseline,
  type ApplicationArtifactFixture } from "./hindsight-application-fixtures.ts";
import { hindsightFixtureCommonRoute } from "./hindsight-fixture-routes.ts";
import { createIntlSegmenterTokenizer } from "../memory/search-tokenizer.ts";
import { createUtilitySlot } from "../memory/utility-slot.ts";
import { composeMemoryRuntime } from "../memory/runtime-composition.ts";
import { createHindsightMemorySubsystem } from "../memory/hindsight/hindsight-memory-subsystem.ts";
import { createHindsightClient, type HindsightClient } from "../memory/hindsight/hindsight-client.ts";
import type { HindsightApplicationClient } from "../memory/hindsight/hindsight-application-client.ts";
import type { HindsightApplicationBundle } from "../memory/hindsight/hindsight-application-bundle.ts";
import { hindsightApplicationHash, sameApplicationValue, withoutApplicationHash } from "../memory/hindsight/hindsight-application-integrity.ts";
import { hindsightError } from "../memory/hindsight/hindsight-errors.ts";
import { curatorTestBank, type CuratorTestBank } from "../memory/hindsight/hindsight-policy-curator-fixtures.ts";

export interface TransportControl { offline: boolean; beforeChanges?: (bankId: string) => Promise<void>; beforeRecall?: (bankId: string) => Promise<void> }
export interface RuntimeCall { operation: string; bankId?: string }
export function hindsightRuntimeFixture(input: { mode?: "hindsight" | "local" | "legacy"; seed?: boolean;
  banks?: CuratorTestBank[]; model?: LanguageModel; coreMigrationHead?: number;
  onPolicyReviewChanged?: (bankId: string) => void } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-hindsight-runtime-"));
  const migrations = MIGRATIONS.filter((migration) => migration.version <= (input.coreMigrationHead ?? Infinity));
  const db = openDatabase({ path: join(dataDir, "memory.sqlite"), migrations });
  const banks = input.banks ?? [curatorTestBank(), curatorTestBank({ bankId: "bank-taki", characterId: "taki" })];
  const mode = input.mode ?? "hindsight"; const { logger, records: logs } = createCaptureLogger();
  const model = input.model ?? failingGenerateModel(new Error("fixture forbids unexpected Utility model calls"));
  const config = createConfigRepo(db); const source = createConfigSource({ env: {}, repo: config });
  config.upsert("TAKI_HINDSIGHT_ENABLED", true); config.upsert("TAKI_HINDSIGHT_ENDPOINT", "http://127.0.0.1:18481");
  const secrets = hindsightFixtureSecrets(); const remote = runtimeClient(banks, secrets.catalog);
  const authority = createCanonicalMemoryAuthorityRepo(db);
  if (mode === "hindsight") seedHindsightAuthority(db, banks);
  else {
    const epoch = authority.initializeLocalAuthority(APPLICATION_TEST_AT);
    if (mode === "local") seedLocalAuthority(db, epoch.epochId);
  }
  const setup = createHindsightBankSetupRepo(db);
  for (const bank of banks) setup.upsert({ scope: bank.bankScope.kind,
    canonicalIdentity: bank.bankScope.kind === "global" ? "global" : `character:${bank.bankScope.characterId}`,
    externalBankId: bank.scope.bankId, templateRevision: "taki-bank-v1", templateDigest: "b".repeat(64), status: "verified",
    operationIds: [], lastVerifiedAt: APPLICATION_TEST_AT, lastError: null });
  const replica = createHindsightApplicationReplicaRepo({ db, tokenizer: createIntlSegmenterTokenizer({ stoplist: true }),
    bankScope: (bankId) => banks.find((bank) => bank.scope.bankId === bankId)!.bankScope });
  if (mode === "hindsight" && input.seed !== false) for (const bank of banks) seedReplica(replica, bank);
  const timeline = input.coreMigrationHead === undefined ? createTimelineRepo(db) : createHistoricalMainTimelineRepo(db);
  const summaries = createSummaryRepo(db); const owners: Array<() => Promise<void>> = [];
  const boot = { db, dataDir, promptDir: join(dataDir, "prompt"), model, timeline, summaries, env: {}, logger, bootId: "fixture-boot",
    windowStart: () => 1, estimatedTokens: () => 0, budget: () => 100_000, compact: { triggerRatio: 0.8, keepMessages: 3 },
    onPolicyReviewChanged: input.onPolicyReviewChanged };
  let closed = false;
  return { ...boot, config, source, secrets, banks, replica, authority, setup, remote, logs, migrations,
    compose: (hindsight = true) => {
      const value = composeMemoryRuntime({ ...boot, ...(hindsight ? { hindsight: { source, secrets: secrets.catalog, client: remote.client } } : {}) });
      owners.push(value.stop); return value;
    },
    subsystem: () => {
      const utility = createUtilitySlot({ mainModel: model, logger });
      const value = createHindsightMemorySubsystem({ ...boot, epochId: "epoch", config: loadMemoryConfig({}), source,
        secrets: secrets.catalog, client: remote.client, utility });
      owners.push(async () => { await Promise.all([value.stop(), utility.stop()]); }); return { ...value, utility };
    },
    close: async () => { if (closed) return; for (const stop of owners.reverse()) await stop(); db.close(); rmTempDir(dataDir); closed = true; } };
}

function seedReplica(repo: ReturnType<typeof createHindsightApplicationReplicaRepo>, bank: CuratorTestBank): void {
  const bundle = bankBundle(bank); const lease = repo.leases.acquire({ bankId: bank.scope.bankId, ownerId: "runtime-fixture", durationMs: 60_000 });
  try { repo.seedVerifiedSnapshot({ ...bank.scope, authorityEpochId: "epoch", bundle, nativeBaseline: applicationTestNativeBaseline(bundle),
    expectedBank: { bankId: bank.scope.bankId, scope: bank.bankScope.kind, characterId: bank.bankScope.characterId },
    expectedCheckpoint: null, expectedNativeCheckpoint: null, lease, deadlineAt: new Date(Date.now() + 60_000).toISOString() }); }
  finally { repo.leases.release(lease); }
}
function seedLocalAuthority(db: Database, epochId: string): void {
  const at = APPLICATION_TEST_AT;
  db.prepare(`INSERT INTO memory_migration_runs(run_id,snapshot_id,epoch_id,phase,status,requested_at,updated_at,lease_fence,activation_transaction_id)
    VALUES ('fixture-local-run','fixture-snapshot',:epoch,'activated','completed',:at,:at,1,'fixture-local')`).run({ epoch: epochId, at });
  db.prepare(`INSERT INTO memory_migration_activation_receipts(run_id,transaction_id,snapshot_id,manifest_digest,readiness_digest,epoch_id,lease_fence,committed_at,marker_mode)
    VALUES ('fixture-local-run','fixture-local','fixture-snapshot',:digest,:digest,:epoch,1,:at,'canonical-local')`)
    .run({ digest: "a".repeat(64), epoch: epochId, at });
  db.prepare(`UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,
    verified_snapshot_id='fixture-snapshot',activation_transaction_id='fixture-local' WHERE singleton=1`).run({ epoch: epochId });
}
function seedHindsightAuthority(db: Database, banks: CuratorTestBank[]) {
  const at = APPLICATION_TEST_AT; const lineage = banks[0]?.scope.namespace.provider_lineage ?? APPLICATION_TEST_SCOPE.namespace.provider_lineage;
  if (banks.some((bank) => bank.scope.namespace.provider_lineage !== lineage)) throw new Error("fixture requires one actual Native lineage");
  const digest = "a".repeat(64); const config = "b".repeat(64);
  db.prepare(`INSERT INTO canonical_memory_authority_epochs(epoch_id,provider_id,provider_lineage_id,status,started_at,ended_at,reason)
    VALUES ('fixture-local','local','fixture-local-lineage','closed',:at,:at,'initial-local'),('epoch','hindsight',:lineage,'active',:at,NULL,'planned-switch')`).run({ at, lineage });
  db.prepare("INSERT INTO canonical_memory_authority_state(singleton,active_epoch_id,updated_at) VALUES (1,'epoch',:at)").run({ at });
  db.prepare(`INSERT INTO memory_migration_runs(run_id,snapshot_id,epoch_id,phase,status,requested_at,updated_at,lease_fence,activation_transaction_id)
    VALUES ('fixture-run','fixture-snapshot','fixture-local','activated','completed',:at,:at,1,'fixture-local-tx')`).run({ at });
  db.prepare(`INSERT INTO hindsight_cutover_runs(run_id,expected_predecessor_epoch_id,phase,status,config_fingerprint,checkpoint_set_digest,lease_fence,created_at,updated_at)
    VALUES ('fixture-run','fixture-local','activated','completed',:config,:digest,1,:at,:at)`).run({ config, digest, at });
  db.prepare(`INSERT INTO hindsight_authority_activation_receipts(transaction_id,run_id,predecessor_epoch_id,hindsight_epoch_id,provider_lineage,
    config_fingerprint,checkpoint_set_digest,bank_count,lease_fence,committed_at)
    VALUES ('fixture-hindsight','fixture-run','fixture-local','epoch',:lineage,:config,:digest,:count,1,:at)`).run({ lineage, config, digest, count: banks.length, at });
  for (const bank of banks) db.prepare(`INSERT INTO hindsight_authority_bank_receipts(transaction_id,bank_id,snapshot_id,bank_generation,replica_epoch_id,
    end_cursor,manifest_digest,template_digest) VALUES ('fixture-hindsight',:bank,'fixture-snapshot',:generation,:generation,2,:digest,:digest)`)
    .run({ bank: bank.scope.bankId, generation: bank.scope.namespace.bank_generation, digest });
  db.prepare(`UPDATE memory_authority_selection SET mode='hindsight',active_epoch_id='epoch',verified_snapshot_id=NULL,
    activation_transaction_id='fixture-hindsight',provider_lineage_id=:lineage,replica_checkpoint_digest=:digest WHERE singleton=1`).run({ lineage, digest });
}
export function hindsightFixtureSecrets() {
  const state = { value: "fixture-connection-key" as string | null, version: 1 };
  const provenance = () => ({ source: "catalog" as const, keyVersion: state.version, updatedAt: APPLICATION_TEST_AT });
  const unsupported = (): never => { throw new Error("unused fixture secret method"); };
  const catalog: SecretCatalogService = { health: () => "ok", resolve: () => state.value, revision: () => state.version,
    presence: (secretRef) => ({ secretRef, present: state.value !== null, provenance: state.value ? provenance() : null, health: "ok" }),
    set: (_secretRef, value) => { state.value = value; state.version++; return { present: true, provenance: provenance() }; },
    clear: () => { state.value = null; state.version++; return { present: false }; },
    list: () => ({ health: "ok", entries: [] }), verifyEntries: unsupported, rotateToKey: unsupported, backup: unsupported, restore: unsupported,
    captureCustodySnapshot: unsupported, validateCustodySnapshot: unsupported };
  return { catalog, state };
}

function runtimeClient(banks: CuratorTestBank[], secrets: SecretCatalogService) {
  const { overlay, control, calls, requireBank } = hindsightApplicationClientOverlay(banks);
  const base = createNativeFixtureClient({ control, calls, secrets, requireBank });
  const client: HindsightClient & HindsightApplicationClient = { ...base, ...overlay };
  return { client, control, calls };
}
/**
 * The in-memory D77 application methods (plus the native baseline) for a set of curator Banks, layered over any native
 * transport client; the activation journey overlays them on the activation transport double for the post-COMMIT runtime.
 */
export function hindsightApplicationClientOverlay(banks: CuratorTestBank[]) {
  const control: TransportControl = { offline: false }; const calls: RuntimeCall[] = [];
  const bundles = new Map<string, HindsightApplicationBundle>();
  const histories = new Map(banks.map((bank) => [bank.scope.bankId, new Map(bank.artifacts.map((entry) => [historyKey(entry), entry]))]));
  const requireBank = (bankId: string, operation: string) => {
    calls.push({ operation, bankId }); if (control.offline) throw hindsightError("HINDSIGHT_UNREACHABLE");
    const bank = banks.find((value) => value.scope.bankId === bankId); if (!bank) throw new Error("fixture Bank missing"); return bank;
  };
  const snapshot = (bank: CuratorTestBank, request: TakiApplicationSnapshotRequest | TakiApplicationHydrateRequest, kind: "snapshot" | "hydrate") => {
    const native = "selectors" in request ? bank.native.filter((entry) => request.selectors.some((selector) =>
      selector.object_kind === entry.head.object_kind && selector.object_id === entry.head.object_id)) : bank.native;
    const history = artifactHistory(bank, histories.get(bank.scope.bankId)!);
    const artifacts = "selectors" in request ? history.filter((entry) => native.some((head) =>
      sameApplicationValue(head.head.bound_artifact?.key, entry.artifact.key))
      || request.artifact_keys.some((key) => sameApplicationValue(key, entry.artifact.key))) : history;
    const bundle = applicationTestSnapshot({ scope: bank.scope, native, artifacts, kind, checkpoint: checkpoint(bank) });
    bundle.manifest.request_id = request.request_id;
    bundle.manifest.manifest_hash = hindsightApplicationHash({ ...bank.scope, domain: "snapshot", value: withoutApplicationHash(bundle.manifest, "manifest_hash") });
    bundles.set(bundle.manifest.snapshot_id, bundle); storeBodies(bank, bundle); return bundle.manifest;
  };
  const app: HindsightApplicationClient = { ...bodyClient(requireBank),
    initializeApplication: async ({ bankId }) => { const bank = requireBank(bankId, "initialize"); return {
      namespace: bank.scope.namespace, bank_id: bankId, checkpoint: checkpoint(bank), minimum_state_cursor: 0, initialized_at: APPLICATION_TEST_AT }; },
    hydrateApplication: async ({ bankId, request }) => snapshot(requireBank(bankId, "hydrate"), request, "hydrate"),
    createApplicationSnapshot: async ({ bankId, request }) => snapshot(requireBank(bankId, "snapshot"), request, "snapshot"),
    applicationSnapshot: async ({ bankId, snapshotId }) => { requireBank(bankId, "snapshot-read"); return bundles.get(snapshotId)!.manifest; },
    applicationSnapshotPage: async ({ bankId, snapshotId, pageNumber }) => { requireBank(bankId, "snapshot-page"); return bundles.get(snapshotId)!.pages[pageNumber]!; },
    applicationChanges: async ({ bankId, namespace, afterStateCursor }) => {
      const bank = requireBank(bankId, "changes"); await control.beforeChanges?.(bankId);
      if (!sameApplicationValue(namespace, bank.scope.namespace)) throw new Error("fixture namespace mismatch");
      for (const event of bank.events) for (const body of event.bodies.values()) bank.server.storeBody(body);
      return changes(bank, afterStateCursor);
    },
    applicationChangePage: async ({ bankId, stateCursor, pageNumber }) => requireBank(bankId, "change-page").events
      .find((event) => event.manifest.state_cursor === stateCursor)!.pages[pageNumber]!,
    pruneApplicationChanges: async () => { throw new Error("unused fixture prune"); },
    reflectApplication: async () => { throw new Error("unused fixture reflection"); } };
  const overlay: HindsightApplicationClient & Pick<HindsightClient, "createLogicalSnapshot"> = { ...app, createLogicalSnapshot: async ({ bankId }) => {
    const bank = requireBank(bankId, "native-baseline"); return applicationTestNativeBaseline(bankBundle(bank)); } };
  return { overlay, control, calls, requireBank };
}
export function createNativeFixtureClient(input: { control: TransportControl; calls: RuntimeCall[]; secrets: SecretCatalogService;
  requireBank(bankId: string, operation: string): CuratorTestBank }): HindsightClient {
  const { control, calls, secrets, requireBank } = input;
  return createHindsightClient({ endpoint: "http://127.0.0.1:18481", resolveApiKey: () => secrets.resolve("memory.hindsight.connection.api-key"),
    transport: async (url, init) => {
      const path = new URL(String(url)).pathname; calls.push({ operation: path });
      if (control.offline) throw new Error("fixture is offline");
      if (new Headers(init?.headers).get("authorization") !== `Bearer ${secrets.resolve("memory.hindsight.connection.api-key")}`) throw new Error("fixture expected authentication");
      const common = hindsightFixtureCommonRoute(path); if (common) return common;
      const match = /^\/v1\/default\/banks\/([^/]+)\/memories\/recall$/.exec(path);
      if (match) {
        const bank = requireBank(decodeURIComponent(match[1]!), "recall-native"); await control.beforeRecall?.(bank.scope.bankId);
        return { status: 200, body: JSON.stringify({ results: bank.native.flatMap((entry) => {
          const body = entry.body.content;
          if (body.body_schema !== "application-native-record.v1" || !("memory_id" in body.value.payload)) return [];
          const value = body.value.payload; return [{ id: value.memory_id, text: value.text, type: value.fact_type, scores: { final: 0.9 } }];
        }) }) };
      }
      throw new Error(`unsupported isolated fixture route: ${path}`);
    } });
}
function bodyClient(bank: (id: string, operation: string) => CuratorTestBank): Pick<HindsightApplicationClient,
  "uploadApplicationBody" | "putApplicationBodyPart" | "sealApplicationBody" | "applicationBody" | "applicationBodyPart" | "commitApplication" | "applicationCommit"> {
  return {
    uploadApplicationBody: (input) => bank(input.bankId, "upload").server.client.uploadApplicationBody(input),
    putApplicationBodyPart: (input) => bank(input.bankId, "put-part").server.client.putApplicationBodyPart(input),
    sealApplicationBody: (input) => bank(input.bankId, "seal").server.client.sealApplicationBody(input),
    applicationBody: (input) => bank(input.bankId, "body").server.client.applicationBody(input),
    applicationBodyPart: (input) => bank(input.bankId, "part").server.client.applicationBodyPart(input),
    commitApplication: (input) => bank(input.bankId, "commit").server.client.commitApplication(input),
    applicationCommit: (input) => bank(input.bankId, "status").server.client.applicationCommit(input),
  };
}
function bankBundle(bank: CuratorTestBank, kind: "snapshot" | "hydrate" = "snapshot") {
  return applicationTestSnapshot({ scope: bank.scope, native: bank.native, artifacts: bank.artifacts, checkpoint: checkpoint(bank), kind });
}
function storeBodies(bank: CuratorTestBank, bundle: HindsightApplicationBundle) { for (const body of bundle.bodies.values()) bank.server.storeBody(body); }
function checkpoint(bank: CuratorTestBank) { return { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state }; }
function changes(bank: CuratorTestBank, afterStateCursor: number): TakiApplicationStateChangePage {
  const events = bank.events.filter((event) => event.manifest.state_cursor > afterStateCursor).map((event) => event.manifest);
  return { namespace: bank.scope.namespace, bank_id: bank.scope.bankId, from_checkpoint: events[0]?.from_checkpoint ?? checkpoint(bank),
    to_checkpoint: events.at(-1)?.to_checkpoint ?? checkpoint(bank), minimum_state_cursor: 0, has_more: false, changes: events };
}
export type HindsightRuntimeFixture = ReturnType<typeof hindsightRuntimeFixture>;

function historyKey(entry: ApplicationArtifactFixture): string { return JSON.stringify([entry.artifact.key, entry.artifact.revision]); }
function artifactHistory(bank: CuratorTestBank, history: Map<string, ApplicationArtifactFixture>): ApplicationArtifactFixture[] {
  const entries = [...bank.artifacts];
  for (const event of bank.events) for (const page of event.pages) for (const descriptor of page.records) {
    if (descriptor.kind === "artifact") entries.push({ artifact: descriptor.artifact, body: event.bodies.get(descriptor.artifact.body_ref.body_id)! });
  }
  for (const entry of entries) {
    const key = historyKey(entry); const old = history.get(key);
    if (old && !sameApplicationValue(old.artifact, entry.artifact)) throw new Error("fixture immutable artifact conflict");
    history.set(key, entry);
  }
  return [...history.values()];
}
