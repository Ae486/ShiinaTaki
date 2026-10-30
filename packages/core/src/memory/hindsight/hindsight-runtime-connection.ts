/**
 * INPUT:  active Hindsight epoch, effective B3 configuration, verified Bank setup and the Secret Catalog
 * OUTPUT: one captured authenticated client and guards for connection, epoch and Bank route changes
 * POS:    core/memory/hindsight — runtime consumes existing operator setup; construction performs no network or Authority write
 */
import { HindsightConnectionProjectionSchema, MemoryReplicaBankSchema, type MemoryReplicaBank } from "@taki/shared";
import type { ConfigSource } from "../../config/config-source.ts";
import { resolveHindsightConfig } from "../../config/hindsight-config.ts";
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

export function createHindsightRuntimeConnection(input: HindsightRuntimeConnectionInput) {
  const authority = createCanonicalMemoryAuthorityRepo(input.db); const epoch = authority.authorityEpoch(input.epochId);
  if (epoch.providerId !== "hindsight") throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const configured = resolveHindsightConfig(input.config);
  if (configured.state !== "ready") throw new Error("HINDSIGHT_APPLICATION_CONNECTION_UNAVAILABLE");
  const connection = HindsightConnectionProjectionSchema.parse(configured.projection);
  const secret = createHindsightConnectionSecret(input.secrets); const secretMarker = secret.marker();
  const configFingerprint = hindsightConnectionFingerprint(connection, secretMarker);
  const setup = createHindsightBankSetupRepo(input.db);
  let stopped = false;
  const assertConnection = () => {
    if (stopped) throw new Error("MEMORY_OPERATION_CANCELLED");
    const current = authority.authorityEpoch(input.epochId); const config = resolveHindsightConfig(input.config);
    if (current.providerId !== "hindsight" || current.providerLineageId !== epoch.providerLineageId || config.state !== "ready"
      || hindsightConnectionFingerprint(config.projection, secret.marker()) !== configFingerprint) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  };
  const banks = (): MemoryReplicaBank[] => {
    assertConnection();
    const rows = setup.list().filter((bank) => bank.status === "verified").map((bank) => {
      if (bank.scope === "global" && bank.canonicalIdentity !== "global"
        || bank.scope === "character" && !bank.canonicalIdentity.startsWith("character:")) throw new Error("MEMORY_AUTHORITY_MISMATCH");
      return MemoryReplicaBankSchema.parse({ bankId: bank.externalBankId, scope: bank.scope,
        characterId: bank.scope === "global" ? null : bank.canonicalIdentity.slice("character:".length) });
    });
    if (new Set(rows.map((bank) => bank.bankId)).size !== rows.length) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    return rows;
  };
  const bank = (bankId: string) => {
    const value = banks().find((candidate) => candidate.bankId === bankId);
    if (!value) throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH"); return value;
  };
  return { authority, epoch, connection, secretMarker, configFingerprint, assertConnection, banks, bank,
    stop: () => { stopped = true; },
    client: input.client ?? createHindsightClient({ endpoint: connection.endpoint, resolveApiKey: secret.resolve }),
    resolveBanks: (characterId: string) => {
      const rows = banks(); const global = rows.find((entry) => entry.scope === "global");
      const character = rows.find((entry) => entry.scope === "character" && entry.characterId === characterId);
      if (!global || !character) throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
      return [global, character];
    } };
}
export type HindsightRuntimeConnection = ReturnType<typeof createHindsightRuntimeConnection>;
