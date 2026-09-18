/**
 * INPUT:  exact current application records, structured Core Blocks and the active Character's Bank pair
 * OUTPUT: admitted frozen prompt/T5 rows, with explicit refusal when a required pin needs native-policy rebinding
 * POS:    core/memory/hindsight — internal staging; mood-gated intentions reach the prompt only after the outgoing query matches
 */
import { readHindsightRuntimeMemoryRecords } from "../../db/hindsight-runtime-memory-view.ts";
import { canonicalMemoryRow } from "../canonical-memory-view.ts";
import { getBlock } from "../block-registry.ts";
import { isPinnedEligible } from "../pinned-block.ts";
import type { HindsightApplicationWorkCursor } from "../../db/hindsight-application-replica-contract.ts";
import type { TidyEngineView } from "../memory-engine.ts";
import { hindsightApplicationEvidenceReader, hindsightApplicationPolicyContext } from "./hindsight-application-binding-context.ts";
import { projectHindsightApplicationNativeUnit, readHindsightApplicationNative,
  type HindsightApplicationEvidenceReader } from "./hindsight-application-projection.ts";
import { requireSafeHindsightMemoryIngress } from "./hindsight-application-policy.ts";
import { hindsightPolicyAdmission, hindsightPolicyRetentionEligible } from "./hindsight-policy-admission.ts";
import type { HindsightApplicationScope } from "./hindsight-application-integrity.ts";
import type { HindsightRuntimeState } from "./hindsight-runtime-state.ts";

export function captureHindsightRuntimeRows(state: HindsightRuntimeState, input: { characterId: string; intentions: boolean }) {
  state.runtime.assertConnection(); const at = state.now?.() ?? new Date().toISOString();
  return state.runtime.resolveBanks(input.characterId).flatMap((route) => {
    const binding = state.replica.bankBinding(route.bankId);
    if (!binding?.bank || binding.bankDeleted || binding.bindingState !== "bound") throw new Error("HINDSIGHT_APPLICATION_BANK_UNAVAILABLE");
    const scope = { bankId: route.bankId, namespace: binding.namespace };
    const evidence = hindsightApplicationEvidenceReader(state.replica, scope);
    requirePinnedBindings({ state, scope, evidence, at });
    return readHindsightRuntimeMemoryRecords(state, scope).flatMap((record) => {
      const head = state.replica.nativeHead({ ...scope, objectKind: "memory_unit", objectId: record.unit.memoryId });
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
}

function requirePinnedBindings(input: {
  state: HindsightRuntimeState; scope: HindsightApplicationScope; evidence: HindsightApplicationEvidenceReader; at: string;
}): void {
  let after: HindsightApplicationWorkCursor | undefined;
  for (;;) {
    const work = input.state.replica.bindingWork({ ...input.scope, limit: 256, ...(after ? { after } : {}) });
    if (work.length === 0) return;
    for (const entry of work) {
      after = entry.cursor;
      const policy = entry.memory?.policy;
      if (!policy || entry.artifact?.tombstoned || !isPinnedEligible({ layer: policy.layerId,
        importance: policy.importance, visibility: policy.visibility })) continue;
      const native = readHindsightApplicationNative({ ...input.scope, evidence: input.evidence, head: entry.head });
      const unit = projectHindsightApplicationNativeUnit({ ...input.scope, native,
        authorityEpochId: input.state.runtime.epoch.epochId });
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
