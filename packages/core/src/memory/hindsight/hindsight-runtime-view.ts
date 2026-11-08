/**
 * INPUT:  exact current application records, structured Core Blocks and the active Character's Bank pair
 * OUTPUT: admitted prompt/T5 rows from one current SQLite snapshot; required pins refuse incomplete native-policy rebinding
 * POS:    core/memory/hindsight — synchronous staging with locally captured routing; shared replica guards remain independent
 */
import type { MemoryBankScope } from "@taki/shared";
import { createHindsightApplicationReplicaRepo } from "../../db/hindsight-application-replica-repo.ts";
import { readHindsightRuntimeMemoryRecords } from "../../db/hindsight-runtime-memory-view.ts";
import { canonicalMemoryRow, type CanonicalMemoryViewRow } from "../canonical-memory-view.ts";
import { getBlock } from "../block-registry.ts";
import { isPinnedEligible } from "../pinned-block.ts";
import type { HindsightApplicationReplicaRepo, HindsightApplicationWorkCursor } from "../../db/hindsight-application-replica-contract.ts";
import type { TidyEngineView } from "../memory-engine.ts";
import { hindsightApplicationEvidenceReader, hindsightApplicationPolicyContext } from "./hindsight-application-binding-context.ts";
import { projectHindsightApplicationNativeUnit, readHindsightApplicationNative,
  type HindsightApplicationEvidenceReader } from "./hindsight-application-projection.ts";
import { requireSafeHindsightMemoryIngress } from "./hindsight-application-policy.ts";
import { hindsightPolicyAdmission, hindsightPolicyRetentionEligible } from "./hindsight-policy-admission.ts";
import type { HindsightApplicationScope } from "./hindsight-application-integrity.ts";
import type { HindsightRuntimeState } from "./hindsight-runtime-state.ts";

export function captureHindsightRuntimeRows(state: HindsightRuntimeState, input: { characterId: string; intentions: boolean }) {
  let rows: CanonicalMemoryViewRow[] = [];
  state.db.transaction(() => {
    const routes = state.runtime.resolveBanks(input.characterId);
    const at = state.now?.() ?? new Date().toISOString();
    // The complete guard and all consumers share this synchronous snapshot. Only
    // these captured routes may bypass repeated connection checks; nothing escapes.
    const replica = createHindsightApplicationReplicaRepo({ db: state.db, tokenizer: state.tokenizer, now: state.now,
      bankScope: (bankId): MemoryBankScope => {
        const route = routes.find((candidate) => candidate.bankId === bankId);
        if (!route) throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
        return route.scope === "global" ? { kind: "global", characterId: null }
          : { kind: "character", characterId: route.characterId as string };
      } });
    rows = routes.flatMap((route) => {
      const binding = replica.bankBinding(route.bankId);
      if (!binding?.bank || binding.bankDeleted || binding.bindingState !== "bound") throw new Error("HINDSIGHT_APPLICATION_BANK_UNAVAILABLE");
      const scope = { bankId: route.bankId, namespace: binding.namespace };
      const evidence = hindsightApplicationEvidenceReader(replica, scope);
      requirePinnedBindings({ replica, authorityEpochId: state.runtime.epoch.epochId, scope, evidence, at });
      return readHindsightRuntimeMemoryRecords({ db: state.db, replica }, scope).flatMap((record) => {
        const head = replica.nativeHead({ ...scope, objectKind: "memory_unit", objectId: record.unit.memoryId });
        if (!head?.bound_artifact || head.binding_state !== "bound") throw new Error("MEMORY_INTEGRITY_ERROR");
        const native = readHindsightApplicationNative({ ...scope, head, evidence });
        const context = hindsightApplicationPolicyContext({ ...scope, bank: binding.bank!, bankScope: binding.scope,
          authorityEpochId: state.runtime.epoch.epochId }, native);
        const body = evidence.body(evidence.artifact(head.bound_artifact).body_ref).content;
        if (body.body_schema !== "application-memory.v1") throw new Error("MEMORY_INTEGRITY_ERROR");
        const admission = hindsightPolicyAdmission({ context, state: { status: "present", ...scope,
          native: native.version, artifact: head.bound_artifact, body: body.value }, query: "", at });
        if (!admission.eligible && !(input.intentions && admission.reason === "mood-gated")) return [];
        requireSafeHindsightMemoryIngress(context);
        const row = canonicalMemoryRow(record, route.characterId);
        // An app-only policy edit is real maintenance activity even when the native
        // fact's timestamp did not change; report counters use the actual later stamp.
        return [{ ...row, updatedAt: row.updatedAt !== null && row.updatedAt > record.policy.updatedAt ? row.updatedAt : record.policy.updatedAt }];
      });
    });
  });
  return rows;
}

function requirePinnedBindings(input: {
  replica: HindsightApplicationReplicaRepo; authorityEpochId: string;
  scope: HindsightApplicationScope; evidence: HindsightApplicationEvidenceReader; at: string;
}): void {
  let after: HindsightApplicationWorkCursor | undefined;
  for (;;) {
    const work = input.replica.bindingWork({ ...input.scope, limit: 256, ...(after ? { after } : {}) });
    if (work.length === 0) return;
    for (const entry of work) {
      after = entry.cursor;
      const policy = entry.memory?.policy;
      if (!policy || entry.artifact?.tombstoned || !isPinnedEligible({ layer: policy.layerId,
        importance: policy.importance, visibility: policy.visibility })) continue;
      const native = readHindsightApplicationNative({ ...input.scope, evidence: input.evidence, head: entry.head });
      const unit = projectHindsightApplicationNativeUnit({ ...input.scope, native,
        authorityEpochId: input.authorityEpochId });
      // A newly captured Run cannot silently omit an existing required pin while
      // offline rebinding is pending. This only refuses incomplete admission;
      // neither old text nor the unbound replacement enters a model prompt.
      if (unit.state === "valid" && hindsightPolicyRetentionEligible({ unit, policy, at: Date.parse(input.at) })) {
        throw new Error("HINDSIGHT_APPLICATION_PINNED_NOT_READY");
      }
    }
  }
}

export function createHindsightRuntimeTidyView(state: HindsightRuntimeState): TidyEngineView {
  const listActive = (characterId: string) => captureHindsightRuntimeRows(state, { characterId, intentions: false });
  return { listActive,
    countSince: (characterId, since) => listActive(characterId).filter((row) => (row.updatedAt ?? row.createdAt) > (since ?? "")).length,
    readBlock: ({ id, characterId }) => {
      state.runtime.assertConnection(); const definition = getBlock(id);
      if (!definition) throw new Error("MEMORY_INVALID_REQUEST");
      const scope = definition.ownership === "global" ? { kind: "global" as const, characterId: null }
        : { kind: "character" as const, characterId: characterId ?? "" };
      return state.blocks.read(id, scope)?.content;
    },
    createTools: () => { throw new Error("MEMORY_CAPABILITY_UNSUPPORTED"); } };
}
