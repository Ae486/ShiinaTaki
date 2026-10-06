/**
 * INPUT:  complete local scope inventory, replica checkpoints and an optional last verified backup
 * OUTPUT: offline per-Bank evidence and unknown loss disclosure, including safe refusal facts
 * POS:    core/memory/transitions — no bounded status display, credential, Native probe or invented generation
 */
import type { HindsightBackupManifest, MemoryEmergencyTransitionPreview, MemoryBankScope } from "@taki/shared";
import { readReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import { readApplicationCheckpoint, applicationCheckpointHash } from "../../db/hindsight-application-replica-checkpoint.ts";
import { createPendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import { countPendingHindsightMemoryWrites } from "../../db/hindsight-memory-write-repo.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import type { Database } from "../../db/sqlite.ts";

type Bank = MemoryEmergencyTransitionPreview["banks"][number];
type Disclosure = Pick<MemoryEmergencyTransitionPreview, "banks" | "inventory" | "blocking" | "lastVerifiedBackupId" | "backupAgeSeconds">;
export function readEmergencyPreviewDisclosure(db: Database, backup: HindsightBackupManifest | null, now: string): Disclosure {
  const verified = backup?.verifiedAt ? backup : null;
  const common = { lastVerifiedBackupId: verified?.backupId ?? null,
    backupAgeSeconds: verified ? Math.max(0, Math.floor((Date.parse(now) - Date.parse(verified.createdAt)) / 1000)) : null };
  const blocking: MemoryEmergencyTransitionPreview["blocking"] = [];
  try {
    const selected = db.prepare("SELECT mode,active_epoch_id,provider_lineage_id FROM memory_authority_selection WHERE singleton=1").get();
    if (selected?.mode !== "hindsight" || !selected.active_epoch_id || !selected.provider_lineage_id) blocking.push("source-unavailable");
    const setup = db.prepare("SELECT * FROM hindsight_bank_setup ORDER BY external_bank_id").all();
    const scopes = new Map<string, { scope: MemoryBankScope; bankId: string | null }>();
    scopes.set("global", { scope: { kind: "global", characterId: null }, bankId: null });
    for (const row of db.prepare(`SELECT character_id FROM timeline_messages UNION SELECT character_id FROM primary_memory_groups WHERE assigned_epoch_id=:epoch
      UNION SELECT character_id FROM canonical_memory_banks WHERE authority_epoch_id=:epoch AND character_id IS NOT NULL
      UNION SELECT character_id FROM taki_memory_blocks WHERE character_id IS NOT NULL`).all({ epoch: selected?.active_epoch_id ?? null })) {
      const characterId = String(row.character_id); scopes.set(`character:${characterId}`, { scope: { kind: "character", characterId }, bankId: null });
    }
    for (const row of setup) {
      const key = String(row.canonical_identity);
      if (row.scope_kind === "global" && key === "global") scopes.set(key, { scope: { kind: "global", characterId: null }, bankId: String(row.external_bank_id) });
      else if (row.scope_kind === "character" && key.startsWith("character:")) scopes.set(key,
        { scope: { kind: "character", characterId: key.slice(10) }, bankId: String(row.external_bank_id) });
      else throw new Error("unreadable scope");
    }
    const banks = [...scopes.values()].map((entry) => bankDisclosure(db, { ...entry, backup: verified,
      epochId: String(selected?.active_epoch_id ?? ""), lineage: String(selected?.provider_lineage_id ?? "") }));
    if (banks.some((bank) => bank.bankId === null)) blocking.push("scope-unmapped");
    if (banks.some((bank) => bank.evidence !== "paired-replica")) blocking.push("incomplete-replica");
    if (banks.length > 1024) throw new Error("inventory limit");
    return { ...common, banks, inventory: "complete" as const, blocking };
  } catch {
    return { ...common, banks: [] as Bank[], inventory: "unreadable" as const, blocking: ["inventory-unreadable" as const] };
  }
}
function bankDisclosure(db: Database, input: { scope: MemoryBankScope; bankId: string | null; epochId: string;
  lineage: string; backup: HindsightBackupManifest | null }): Bank {
  const { bankId, epochId, lineage, backup } = input;
  const native = bankId ? safely(() => readReplicaCheckpoint(db, bankId)) : { value: undefined, failed: false };
  const application = bankId ? safely(() => readApplicationCheckpoint(db, bankId)) : { value: undefined, failed: false };
  const paired = native.value && application.value && !application.value.bankDeleted
    && native.value.authorityEpochId === epochId && application.value.authorityEpochId === epochId
    && native.value.providerLineageId === lineage && application.value.namespace.provider_lineage === lineage
    && transitionLocalHash(native.value) === transitionLocalHash(application.value.native)
    && transitionLocalHash(application.value.bankScope) === transitionLocalHash(input.scope);
  const saved = backup?.native.proof.banks.find((bank) => bank.bankId === bankId);
  const comparable = native.value && backup?.authority.epochId === epochId && backup.authority.providerLineageId === lineage
    && backup.native.proof.providerLineage === lineage && saved?.bankGeneration === native.value.bankGeneration;
  const pending = bankId ? safely(() => createPendingMemoryRepo(db).summary({ authorityEpochId: epochId, bankId }).pendingCount
    + countPendingHindsightMemoryWrites(db, { authorityEpochId: epochId, bankId })) : { value: undefined, failed: false };
  return { bankId, scope: input.scope, nativeGeneration: native.value?.bankGeneration ?? application.value?.namespace.bank_generation ?? null,
    replicaCursor: native.value?.endCursor ?? null, applicationNativeCursor: application.value?.checkpoint.native_cursor ?? null,
    applicationStateCursor: application.value?.checkpoint.state_cursor ?? null, pendingCount: pending.value ?? null,
    checkpointHash: paired ? applicationCheckpointHash(application.value!) : null,
    backupNativeCursor: comparable ? saved!.currentCursor : null,
    backupApplicationNativeCursor: comparable && paired ? saved!.application?.nativeCursor ?? null : null,
    backupApplicationStateCursor: comparable && paired ? saved!.application?.stateCursor ?? null : null,
    evidence: native.failed || application.failed ? "unreadable" : paired ? "paired-replica"
      : !native.value && !application.value ? "missing" : native.value && !application.value ? "native-only" : "incompatible",
    remoteHead: "unknown", remoteLoss: "unknown" };
}
function safely<T>(read: () => T) { try { return { value: read(), failed: false }; } catch { return { value: undefined, failed: true }; } }
