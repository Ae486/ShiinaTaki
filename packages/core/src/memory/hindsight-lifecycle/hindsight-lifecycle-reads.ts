/**
 * INPUT:  the B3 Bank setup rows, the reviewed fingerprint + deployment mode, replica checkpoints, the live connection config
 *         (Secret Catalog marker included) and the published runtime's construction identity
 * OUTPUT: readHindsightBankFacts() (one Character's provisioning facts), hindsightReplicaBound(), readHindsightLifecycleLive()
 *         (a live read that never throws), readHindsightReviewedFingerprint() (the B3 snapshot's reviewed fingerprint) and
 *         hindsightRevalidateBlocker() (the Stage 5 changes a revalidation refuses, judged against the reviewed deployment mode;
 *         shared by the producer, the automatic trigger and the status action)
 * POS:    core/memory/hindsight-lifecycle — synchronous local reads shared by admission, execution, status and the automatic
 *         trigger; never probes the network, never writes
 */
import type { HindsightBankSetupProjection } from "@taki/shared";
import type { ConfigSource } from "../../config/config-source.ts";
import { readApplicationCheckpoint } from "../../db/hindsight-application-replica-checkpoint.ts";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../../db/hindsight-connection-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import type { SecretCatalogService } from "../../secrets/secret-catalog-service.ts";
import { hindsightBankBindings } from "../hindsight/hindsight-bank-identity.ts";
import { readHindsightLiveProjection, type HindsightLiveProjection } from "../hindsight/hindsight-runtime-connection.ts";
import type { MemoryOperationsRuntime } from "../operations/memory-operation-contract.ts";
import { readTemplateDefaults } from "../hindsight/template-lifecycle/template-default-store.ts";
import { hasTemplateExecutionStorage } from "../hindsight/template-lifecycle/template-execution-reads.ts";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { readRuntimeTemplateSelection } from "../hindsight/template-lifecycle/template-runtime-selection.ts";

export interface HindsightBankFacts {
  nativeBankId: string;
  /** The admitted Character scope default, with the legacy verified Global revision as the pre-managed fallback. */
  globalRevision: string | null;
  templateDefaultsRevision?: number;
  row: HindsightBankSetupProjection | null;
  bound: boolean;
}
export type HindsightLifecycleLive = HindsightLiveProjection | { state: "unreadable"; fingerprint: null; projection: null };
export type HindsightReadyLive = Extract<HindsightLiveProjection, { state: "ready" }>;
export type HindsightRevalidateBlocker = "HINDSIGHT_TEMPLATE_CONFLICT" | "HINDSIGHT_STATE_CONFLICT";

/** Throws for a Character id outside the Bank identity bounds; admission turns that into a refusal. */
export function readHindsightBankFacts(db: Database, input: { epochId: string; characterId: string }): HindsightBankFacts {
  const [global, character] = hindsightBankBindings(input.characterId);
  const repo = createHindsightBankSetupRepo(db);
  const globalRow = repo.get(global.canonicalIdentity);
  const epoch = createCanonicalMemoryAuthorityRepo(db).authorityEpoch(input.epochId);
  const defaults = epoch.providerId === "hindsight" && hasTemplateExecutionStorage(db) ? readTemplateDefaults(db, epoch.providerLineageId) : null;
  return { nativeBankId: character.externalBankId,
    globalRevision: defaults?.characterTemplateRevision ?? (globalRow?.status === "verified" ? globalRow.templateRevision : null),
    ...(defaults ? { templateDefaultsRevision: defaults.revision } : {}),
    row: repo.get(character.canonicalIdentity), bound: hindsightReplicaBound(db, { epochId: input.epochId, bankId: character.externalBankId }) };
}

export function hindsightReplicaBound(db: Database, input: { epochId: string; bankId: string }): boolean {
  // An unreadable checkpoint is not a bound replica; the replica section and the scheduler own its error code.
  try {
    const checkpoint = readApplicationCheckpoint(db, input.bankId);
    return checkpoint !== undefined && checkpoint.authorityEpochId === input.epochId && !checkpoint.bankDeleted;
  } catch { return false; }
}

export function readHindsightLifecycleLive(input: { config: ConfigSource; secrets: SecretCatalogService }): HindsightLifecycleLive {
  try { return readHindsightLiveProjection(input); }
  catch { return { state: "unreadable", fingerprint: null, projection: null }; }
}

/** The snapshot only parses with its Bank rows (a configured phase requires verified ones). */
export function readHindsightReviewedFingerprint(db: Database): string | null {
  return createHindsightConnectionRepo(db).read(createHindsightBankSetupRepo(db).list()).configFingerprint;
}

/**
 * Template revision and deployment-mode changes are Stage 5 and never repaired by a revalidation. The mode stored with the
 * reviewed fingerprint is the reference, so a benign change a restart already bound still revalidates. A pre-050 row has
 * none: then only a runtime built on the reviewed fingerprint carries the reviewed mode, else only an unchanged reviewed
 * fingerprint proves it (fail closed otherwise).
 */
export function hindsightRevalidateBlocker(db: Database, input: {
  live: HindsightReadyLive; runtime: Pick<MemoryOperationsRuntime, "deploymentMode" | "configFingerprint"> | null;
}): HindsightRevalidateBlocker | null {
  const global = createHindsightBankSetupRepo(db).get("global");
  if (global?.status !== "verified") return "HINDSIGHT_STATE_CONFLICT";
  const checkpoint = readApplicationCheckpoint(db, global.externalBankId);
  const managed = checkpoint ? readRuntimeTemplateSelection(db, { bankId: global.externalBankId, namespace: checkpoint.namespace }) : null;
  if (!managed && global.templateRevision !== input.live.projection.desiredTemplateRevision) return "HINDSIGHT_TEMPLATE_CONFLICT";
  const reviewed = createHindsightConnectionRepo(db).reviewed();
  const mode = reviewed.deploymentMode
    ?? (input.runtime !== null && input.runtime.configFingerprint === reviewed.configFingerprint ? input.runtime.deploymentMode : null);
  if (mode !== null) return mode === input.live.projection.deploymentMode ? null : "HINDSIGHT_STATE_CONFLICT";
  return reviewed.configFingerprint === input.live.fingerprint ? null : "HINDSIGHT_STATE_CONFLICT";
}
