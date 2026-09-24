/**
 * INPUT:  active Hindsight epoch, effective B3 configuration, verified Bank setup and the Secret Catalog
 * OUTPUT: one captured authenticated client, guards for connection, epoch and Bank route changes, driftReason() separating a
 *         changed/disabled connection from an Authority integrity failure, routedBanks()/characterRouted() for a Character without a ready Bank,
 *         readHindsightLiveConnection() (the live config state + fingerprint, no network) and readHindsightLiveProjection()
 *         (the same read plus the ready projection the lifecycle producers act on)
 * POS:    core/memory/hindsight — runtime consumes existing operator setup; construction performs no network or Authority write
 *         and refuses HINDSIGHT_TEMPLATE_CONFLICT when the desired template revision differs from the verified Banks'
 */
import { HindsightConnectionProjectionSchema, MemoryReplicaBankSchema, type HindsightConnectionProjection, type MemoryReplicaBank } from "@taki/shared";
import type { ConfigSource } from "../../config/config-source.ts";
import { resolveHindsightConfig, type HindsightResolvedConfig } from "../../config/hindsight-config.ts";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import type { SecretCatalogService } from "../../secrets/secret-catalog-service.ts";
import { createHindsightClient, type HindsightClient } from "./hindsight-client.ts";
import { hindsightConnectionFingerprint } from "./hindsight-compatibility-service.ts";
import { createHindsightConnectionSecret } from "./hindsight-secret-refs.ts";

export interface HindsightRuntimeConnectionInput {
  db: Database; epochId: string; config: ConfigSource; secrets: SecretCatalogService;
  /** Injected transport client for isolated composition tests; production always uses the common authenticated factory. */
  client?: HindsightClient;
}

/** A changed or disabled connection under the same Authority; an epoch/lineage change is an integrity failure and throws instead. */
export type HindsightConnectionDrift = "none" | "config_changed" | "connection_disabled";
export type HindsightLiveConnection =
  | { state: "ready"; fingerprint: string }
  | { state: Exclude<HindsightResolvedConfig["state"], "ready">; fingerprint: null };

export type HindsightLiveProjection =
  | { state: "ready"; fingerprint: string; projection: HindsightConnectionProjection }
  | { state: Exclude<HindsightResolvedConfig["state"], "ready">; fingerprint: null; projection: null };

export function readHindsightLiveProjection(input: { config: ConfigSource; secrets: SecretCatalogService }): HindsightLiveProjection {
  const configured = resolveHindsightConfig(input.config);
  if (configured.state !== "ready") return { state: configured.state, fingerprint: null, projection: null };
  const fingerprint = hindsightConnectionFingerprint(configured.projection, createHindsightConnectionSecret(input.secrets).marker());
  return { state: "ready", fingerprint, projection: configured.projection };
}

export function readHindsightLiveConnection(input: { config: ConfigSource; secrets: SecretCatalogService }): HindsightLiveConnection {
  const live = readHindsightLiveProjection(input);
  return live.state === "ready" ? { state: "ready", fingerprint: live.fingerprint } : { state: live.state, fingerprint: null };
}

export function createHindsightRuntimeConnection(input: HindsightRuntimeConnectionInput) {
  const authority = createCanonicalMemoryAuthorityRepo(input.db); const epoch = authority.authorityEpoch(input.epochId);
  if (epoch.providerId !== "hindsight") throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const configured = resolveHindsightConfig(input.config);
  if (configured.state !== "ready") throw new Error("HINDSIGHT_APPLICATION_CONNECTION_UNAVAILABLE");
  const connection = HindsightConnectionProjectionSchema.parse(configured.projection);
  const secret = createHindsightConnectionSecret(input.secrets); const secretMarker = secret.marker();
  const configFingerprint = hindsightConnectionFingerprint(connection, secretMarker);
  const setup = createHindsightBankSetupRepo(input.db);
  // Changing the template revision is a Stage 5 upgrade; a runtime bound to mismatched Banks would serve the wrong template.
  if (verifiedRows(setup).some((bank) => bank.templateRevision !== connection.desiredTemplateRevision)) throw new Error("HINDSIGHT_TEMPLATE_CONFLICT");
  let stopped = false;
  const driftReason = (): HindsightConnectionDrift => {
    if (stopped) throw new Error("MEMORY_OPERATION_CANCELLED");
    const current = authority.authorityEpoch(input.epochId);
    if (current.providerId !== "hindsight" || current.providerLineageId !== epoch.providerLineageId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    const live = readHindsightLiveConnection(input);
    if (live.state !== "ready") return "connection_disabled";
    return live.fingerprint === configFingerprint ? "none" : "config_changed";
  };
  const assertConnection = () => { if (driftReason() !== "none") throw new Error("MEMORY_AUTHORITY_MISMATCH"); };
  const banks = (): MemoryReplicaBank[] => {
    assertConnection();
    const rows = verifiedRows(setup).map((bank) => {
      if (bank.scope === "global" && bank.canonicalIdentity !== "global"
        || bank.scope === "character" && !bank.canonicalIdentity.startsWith("character:")) throw new Error("MEMORY_AUTHORITY_MISMATCH");
      return MemoryReplicaBankSchema.parse({ bankId: bank.externalBankId, scope: bank.scope,
        characterId: bank.scope === "global" ? null : bank.canonicalIdentity.slice("character:".length) });
    });
    if (new Set(rows.map((bank) => bank.bankId)).size !== rows.length) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    return rows;
  };
  const bank = (bankId: string) => banks().find((candidate) => candidate.bankId === bankId) ?? missingRoute();
  /** Global + Character routes, or undefined while the Character has no verified Bank; a missing Global Bank is an integrity failure. */
  const routedBanks = (characterId: string): [MemoryReplicaBank, MemoryReplicaBank] | undefined => {
    const rows = banks(); const global = rows.find((entry) => entry.scope === "global");
    if (!global) throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
    const character = rows.find((entry) => entry.scope === "character" && entry.characterId === characterId);
    return character ? [global, character] : undefined;
  };
  return { authority, epoch, connection, secretMarker, configFingerprint, assertConnection, driftReason, banks, bank, routedBanks,
    /** Local B3 read without the connection guard: whether background work has any Bank to write into for this Character. */
    characterRouted: (characterId: string) => verifiedRows(setup).some((row) => row.canonicalIdentity === `character:${characterId}`),
    stop: () => { stopped = true; },
    client: input.client ?? createHindsightClient({ endpoint: connection.endpoint, resolveApiKey: secret.resolve }),
    resolveBanks: (characterId: string) => routedBanks(characterId) ?? missingRoute() };
}
export type HindsightRuntimeConnection = ReturnType<typeof createHindsightRuntimeConnection>;

function missingRoute(): never { throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH"); }

function verifiedRows(setup: ReturnType<typeof createHindsightBankSetupRepo>) {
  return setup.list().filter((bank) => bank.status === "verified");
}
