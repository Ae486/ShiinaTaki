/**
 * INPUT: model-selected child and optional explicit work, accepted operation identity
 * OUTPUT: current ordinary-message target without silently retargeting explicit historical work
 * POS: core/harness — transaction-scoped target resolution; exact controls retain the strict schema
 */
import type { SubagentTarget } from "@taki/shared";
import type { SubagentState } from "./subagent-state.ts";
import { assertSubagentCharacter } from "./subagent-queries.ts";

export function resolveOrdinarySubagentTarget(state: SubagentState, input: {
  characterId: string; subagentId: string; workInputId?: string | null; operationKey: string;
}): SubagentTarget {
  const { deps } = state;
  assertSubagentCharacter(state, input.characterId, input.subagentId);
  const child = deps.children.get(input.subagentId);
  const prior = deps.db.prepare("SELECT work_input_id FROM subagent_inputs WHERE subagent_id=:child AND operation_key=:key")
    .get({ child: input.subagentId, key: input.operationKey });
  const latest = deps.db.prepare("SELECT work_input_id FROM subagent_inputs WHERE subagent_id=:child ORDER BY input_seq DESC LIMIT 1").get({ child: input.subagentId });
  const workInputId = input.workInputId ?? (prior ? String(prior.work_input_id) : child.activeRunId
    ? deps.executions.get(child.activeRunId).workInputId : latest ? String(latest.work_input_id) : null);
  if (!workInputId) throw new Error("SUBAGENT_WORK_NOT_FOUND");
  const work = deps.inputs.get(workInputId);
  if (work.subagentId !== child.subagentId || work.kind !== "work") throw new Error("SUBAGENT_WORK_MISMATCH");
  // Ordinary input digests remain stable across Run/control drift and response-loss retries.
  return { subagentId: child.subagentId, workInputId, expectedControlVersion: 0 };
}
