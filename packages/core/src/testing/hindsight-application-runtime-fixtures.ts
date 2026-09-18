/**
 * INPUT:  synthetic Bank/memory policy overrides for D77 runtime integration tests
 * OUTPUT: bound native/artifact fixtures, an admitted capability manifest and an isolated SQLite authority
 * POS:    core/testing — test evidence only; no original data, model or production activation path
 */
import {
  HINDSIGHT_APPLICATION_STATE_BUILD, HINDSIGHT_APPLICATION_PART_BYTES, HINDSIGHT_APPLICATION_RESPONSE_BYTES,
  HINDSIGHT_APPLICATION_UPLOAD_BYTES, type MemoryBankScope, type TakiApplicationArtifact,
  type TakiMemoryPolicyProjection, type TakiApplicationNativePayload,
} from "@taki/shared";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase } from "../db/sqlite.ts";
import { createHindsightApplicationReplicaRepo } from "../db/hindsight-application-replica-repo.ts";
import { createIntlSegmenterTokenizer } from "../memory/search-tokenizer.ts";
import { HindsightCompatibilityWireSchema } from "../memory/hindsight/hindsight-contracts.ts";
import type { HindsightApplicationBundle } from "../memory/hindsight/hindsight-application-bundle.ts";
import type { HindsightApplicationScope } from "../memory/hindsight/hindsight-application-integrity.ts";
import { APPLICATION_TEST_AT, APPLICATION_TEST_SCOPE, applicationTestArtifact, applicationTestBankPayload,
  applicationTestBody, applicationTestMemoryBody, applicationTestMemoryPayload, applicationTestNative,
  applicationTestNativeBaseline, type ApplicationNativeFixture } from "./hindsight-application-fixtures.ts";

export function applicationTestBind(native: ApplicationNativeFixture, artifact: TakiApplicationArtifact): void {
  native.head = { ...native.head, binding_state: "bound", bound_artifact: {
    key: artifact.key, revision: artifact.revision, record_hash: artifact.record_hash }, cause: "application_commit" };
}
export function applicationTestBoundBank(scope = APPLICATION_TEST_SCOPE, bankScope: MemoryBankScope = { kind: "global", characterId: null }) {
  const native = applicationTestNative({ kind: "bank", payload: applicationTestBankPayload(scope), scope, cursor: 1 });
  if (!native.head.version) throw new Error("fixture version missing");
  const application = applicationTestArtifact({ scope, key: { artifact_kind: "bank", artifact_id: scope.bankId },
    binding: { kind: "exact_native", native: native.head.version }, body: applicationTestBody("application-bank.v1", {
      scope: bankScope, original_bank: null, original_provider_lineage: null, original_authority_epoch_id: null,
    }, scope) });
  applicationTestBind(native, application.artifact);
  return { native, application };
}
export function applicationTestBoundMemory(input: {
  payload?: Partial<Extract<TakiApplicationNativePayload, { memory_id: string }>>;
  policy?: Partial<TakiMemoryPolicyProjection>; scope?: HindsightApplicationScope; bankScope?: MemoryBankScope;
} = {}) {
  const scope = input.scope ?? APPLICATION_TEST_SCOPE;
  const native = applicationTestNative({ kind: "memory_unit", scope, cursor: 2,
    payload: applicationTestMemoryPayload({ bank_id: scope.bankId, document_id: null, ...input.payload }) });
  if (!native.head.version) throw new Error("fixture version missing");
  const value = applicationTestMemoryBody(native.head.version);
  value.policy = { ...value.policy, bankId: scope.bankId, ...input.policy };
  value.provenance = { ...value.provenance, characterId: input.bankScope?.characterId ?? null };
  const application = applicationTestArtifact({ scope, key: { artifact_kind: "memory", artifact_id: native.head.object_id },
    binding: { kind: "exact_native", native: native.head.version }, body: applicationTestBody("application-memory.v1", value, scope) });
  applicationTestBind(native, application.artifact);
  return { native, application, value };
}

export function applicationTestCompatibility(scope = APPLICATION_TEST_SCOPE) {
  const support = { state: "supported", reason: "all_contracts_available" }; const versioned = { version: "1.0.0", support };
  return HindsightCompatibilityWireSchema.parse({ base_api_version: "0.9.0", compatibility_version: "1.0.0",
    source_identity: { upstream_commit: "synthetic-fixture", compatibility_build: HINDSIGHT_APPLICATION_STATE_BUILD },
    provider: { lineage: scope.namespace.provider_lineage, database_dialect: "postgresql", storage_mode: "sql_rows" }, support,
    journal: { schema_version: 1, retention_mode: "operator_managed_cursor_floor", cursor_reset_supported: true },
    snapshot: { schema_version: 1, default_page_size: 500, max_page_size: 1000, default_ttl_seconds: 3600, max_ttl_seconds: 86400 },
    contracts: { change_journal: versioned, conditional_mutation: versioned, logical_snapshot: versioned,
      additive_observation_instructions: versioned, controlled_layer_projection: versioned, native_results: versioned,
      application_state: { ...versioned, body_part_bytes: HINDSIGHT_APPLICATION_PART_BYTES, max_response_bytes: HINDSIGHT_APPLICATION_RESPONSE_BYTES,
        max_preparation_bytes: HINDSIGHT_APPLICATION_UPLOAD_BYTES, state_cursor_reset_supported: true, capture_mode: "explicit_generation_initialization" },
      application_reflect: { ...versioned, policy_context_schema: "application-read-context.v1", linearization: "before_each_model_submission",
        withheld_inputs: ["bank_profile", "directives", "mental_models", "whole_sources", "entities"] } } });
}

export function applicationTestReplica(input: { path?: string; scope?: HindsightApplicationScope; bankScope?: MemoryBankScope } = {}) {
  const scope = input.scope ?? APPLICATION_TEST_SCOPE; const bankScope = input.bankScope ?? { kind: "global", characterId: null };
  const db = openDatabase({ path: input.path ?? ":memory:", migrations: MIGRATIONS });
  if (!db.prepare("SELECT epoch_id FROM canonical_memory_authority_epochs WHERE epoch_id='epoch'").get()) {
    db.prepare(`INSERT INTO canonical_memory_authority_epochs
      (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
      VALUES ('epoch','hindsight',:lineage,'active',NULL,:at,NULL,'planned-switch')`).run({ lineage: scope.namespace.provider_lineage, at: APPLICATION_TEST_AT });
    db.prepare("INSERT INTO canonical_memory_authority_state(singleton,active_epoch_id,updated_at) VALUES(1,'epoch',:at)").run({ at: APPLICATION_TEST_AT });
  }
  const repo = createHindsightApplicationReplicaRepo({ db, tokenizer: createIntlSegmenterTokenizer({ stoplist: true }), bankScope: () => bankScope,
    now: () => APPLICATION_TEST_AT });
  const publish = (bundle: HindsightApplicationBundle) => {
    const lease = repo.leases.acquire({ bankId: scope.bankId, ownerId: "application-runtime-test", durationMs: 60_000 });
    try {
      const value = { ...scope, bundle, nativeBaseline: applicationTestNativeBaseline(bundle), authorityEpochId: "epoch",
        expectedBank: { bankId: scope.bankId, scope: bankScope.kind, characterId: bankScope.characterId },
        expectedCheckpoint: repo.checkpoint(scope.bankId) ?? null, expectedNativeCheckpoint: repo.nativeCheckpoint(scope.bankId) ?? null,
        lease, deadlineAt: "2026-09-11T08:01:00.000Z" };
      return value.expectedCheckpoint ? repo.reconcileVerifiedSnapshot(value) : repo.seedVerifiedSnapshot(value);
    } finally { repo.leases.release(lease); }
  };
  return { db, repo, publish, scope, bankScope };
}
