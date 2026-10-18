/**
 * INPUT:  current settings/secret marker, setup revision, authority selection and existing Bank checkpoints
 * OUTPUT: one immutable observation target and a private identity for before/after comparisons
 * POS:    core/memory/hindsight — local read adapter; never adopts a lineage, initializes a Bank or changes readiness
 */
import { createHash } from "node:crypto";
import type { HindsightConfigurationScope, HindsightConnectionProjection } from "@taki/shared";
import type { ConfigSource } from "../../config/config-source.ts";
import { resolveHindsightConfig } from "../../config/hindsight-config.ts";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../../db/hindsight-connection-repo.ts";
import { readApplicationCheckpoint } from "../../db/hindsight-application-replica-checkpoint.ts";
import { readReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import type { Database } from "../../db/sqlite.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { hindsightBankBindings } from "./hindsight-bank-identity.ts";
import { hindsightConnectionFingerprint } from "./hindsight-compatibility-service.ts";
import type { HindsightConnectionSecret } from "./hindsight-setup-service.ts";

export interface HindsightConfigurationCapture {
  connection: HindsightConnectionProjection;
  connectionFingerprint: string;
  contextIdentity: string;
  bankId: string;
  providerLineage: string | null;
  bankGeneration: string | null;
}
export interface HindsightConfigurationContextDeps {
  db: Database;
  config: ConfigSource;
  secret: HindsightConnectionSecret;
  configurationRevision(): number;
  secretRevision(): number;
}

export function readHindsightConfigurationContext(deps: HindsightConfigurationContextDeps,
  scope: HindsightConfigurationScope): HindsightConfigurationCapture | null {
  const config = resolveHindsightConfig(deps.config);
  if (config.state !== "ready") return null;
  const connectionFingerprint = hindsightConnectionFingerprint(config.projection, deps.secret.marker());
  const bindings = hindsightBankBindings(scope.kind === "character" ? scope.characterId : "global");
  const binding = scope.kind === "global" ? bindings[0] : bindings[1];
  const banks = createHindsightBankSetupRepo(deps.db);
  const setup = createHindsightConnectionRepo(deps.db).read(banks.list());
  const bank = banks.get(binding.canonicalIdentity);
  const bankId = bank?.externalBankId ?? binding.externalBankId;
  const selected = readMemoryAuthoritySelection(deps.db);
  const native = readReplicaCheckpoint(deps.db, bankId);
  const application = readApplicationCheckpoint(deps.db, bankId);
  const active = selected.mode === "hindsight";
  const pinnedNative = native?.authorityEpochId === selected.epochId ? native : undefined;
  const pinnedApplication = application?.authorityEpochId === selected.epochId ? application : undefined;
  // A stale setup or retired replica is not an identity pin for a different endpoint.
  const providerLineage = active ? selected.providerLineageId
    : setup.configFingerprint === connectionFingerprint ? setup.compatibility?.providerLineage ?? null : null;
  const bankGeneration = active ? pinnedApplication?.namespace.bank_generation ?? pinnedNative?.bankGeneration ?? null : null;
  if (active && (pinnedApplication?.bankDeleted || (pinnedNative && pinnedNative.providerLineageId !== providerLineage)
    || (pinnedApplication && pinnedApplication.namespace.provider_lineage !== providerLineage))) throw new Error("identity_mismatch");
  const contextIdentity = createHash("sha256").update(JSON.stringify({ connectionFingerprint, scope, bank,
    setupRevision: setup.revision, configurationRevision: deps.configurationRevision(), secretRevision: deps.secretRevision(), selected,
    providerLineage, bankGeneration })).digest("hex");
  return { connection: config.projection, connectionFingerprint, contextIdentity, bankId, providerLineage, bankGeneration };
}
