/**
 * INPUT:  Local authority metadata, captured canonical revisions and registry retention policy
 * OUTPUT: real retention operations and a counts-only sweep over canonical records
 * POS:    core/memory — Local maintenance adapter; only the authorized store performs durable mutations
 */
import type { CanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import type { CanonicalMemoryMaintenanceRepo, CanonicalMaintenanceRetentionRow } from "../db/canonical-memory-maintenance-contract.ts";
import type { RetentionRow } from "../db/memory-repo.ts";
import { stableRequestHash } from "../db/canonical-memory-repo.ts";
import type { SweepCounts } from "../scheduler/sweep-runner.ts";
import { canonicalMemoryReference, parseCanonicalMemoryReference } from "./canonical-memory-view.ts";
import { getLayer, type MemoryLayerDefinition } from "./layer-registry.ts";
import { memoryRetentionVerdict, type MemoryRetentionOps } from "./retention-sweeper.ts";

export function createCanonicalLocalRetention(input: {
  repo: CanonicalMemoryMaintenanceRepo;
  authority: CanonicalMemoryAuthorityRepo;
  epochId: string;
  intentionsDefaultDays: number;
  now?: () => number;
}): { ops: MemoryRetentionOps; sweep(): SweepCounts | undefined } {
  const now = input.now ?? Date.now;
  const apply = (row: CanonicalMaintenanceRetentionRow, verdict: "archive" | "delete", at: number): void => {
    const common = { epochId: row.epochId, bankId: row.bankId, characterId: row.characterId, memoryId: row.memoryId,
      expectedRevision: row.revision, requestId: `retention:${stableRequestHash({ epochId: row.epochId,
        bankId: row.bankId, memoryId: row.memoryId, expectedRevision: row.revision, verdict })}`, now: new Date(at).toISOString() };
    if (verdict === "delete") input.repo.hardDeleteRolling(common);
    else input.repo.invalidate({ ...common, reason: "retention" });
  };
  const operate = (ref: string, expected: "archive" | "delete"): void => {
    const target = parseCanonicalMemoryReference(ref);
    if (target.epochId !== input.epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    const row = input.repo.listRetention({ epochId: input.epochId }).find((candidate) => candidate.bankId === target.bankId
      && candidate.memoryId === target.memoryId && candidate.revision === target.expectedRevision);
    if (!row) throw new Error("MEMORY_REVISION_MISMATCH");
    const at = now();
    if (verdictFor(row, at, input.intentionsDefaultDays) !== expected) throw new Error("MEMORY_CAPABILITY_UNSUPPORTED");
    apply(row, expected, at);
  };
  return {
    ops: {
      listActive: (layer) => input.repo.listRetention({ epochId: input.epochId })
        .filter((row) => row.policy.layerId === layer).map(retentionRow),
      archive: (ref) => operate(ref, "archive"),
      hardDelete: (ref) => operate(ref, "delete"),
    },
    sweep: () => {
      input.authority.activeEpoch(input.epochId);
      const at = now(); let archived = 0; let deleted = 0; let failed = 0;
      for (const row of input.repo.listRetention({ epochId: input.epochId })) {
        const verdict = verdictFor(row, at, input.intentionsDefaultDays);
        if (verdict === "keep") continue;
        try { apply(row, verdict, at); if (verdict === "delete") deleted += 1; else archived += 1; }
        catch { failed += 1; }
      }
      return archived + deleted + failed > 0 ? { archived, deleted, failed } : undefined;
    },
  };
}

function retentionRow(row: CanonicalMaintenanceRetentionRow): RetentionRow {
  return { path: canonicalMemoryReference({ epochId: row.epochId, bankId: row.bankId,
    memoryId: row.memoryId, expectedRevision: row.revision }), layer: row.policy.layerId, importance: row.policy.importance,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    expiresAt: row.policy.retention.kind === "expiring" ? row.policy.retention.expiresAt : null };
}

function verdictFor(row: CanonicalMaintenanceRetentionRow, at: number, intentionsDefaultDays: number) {
  const layer = getLayer(row.policy.layerId);
  if (!layer || layer.retention === "permanent") return "keep";
  const policy = row.policy.retention;
  let retention: MemoryLayerDefinition["retention"];
  switch (policy.kind) {
    case "permanent": return "keep";
    case "expiring": retention = "expiring"; break;
    case "rolling-window":
      if (layer.writePolicy !== "machine" || typeof layer.retention !== "object" || !("rollingDays" in layer.retention)) return "keep";
      retention = { rollingDays: policy.days }; break;
    case "importance-decay": retention = { afterDays: policy.afterDays, archiveBelowImportance: policy.archiveBelowImportance }; break;
  }
  return memoryRetentionVerdict(retention, retentionRow(row), { at, intentionsDefaultDays });
}
