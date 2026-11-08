/**
 * INPUT:  claimed admitted work and its actual effective prompt evidence
 * OUTPUT: live proposal-only tools with addressed-record currentness checks before immutable result persistence
 * POS:    core/memory/hindsight — no native text/lifecycle mutation and no direct Core Block replacement
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { MemoryErrorCodeSchema, TakiMemoryPolicyProjectionSchema, TakiApplicationBlockBodySchema, hindsightApplicationWireJson } from "@taki/shared";
import { fenceUntrusted } from "../../agents/untrusted-fence.ts";
import { policyWorkClaim } from "../../db/hindsight-policy-work-repo.ts";
import { policyAssessmentTarget, type HindsightPolicyWorkRecord, type HindsightPolicyWorkResult } from "../../db/hindsight-policy-work-contract.ts";
import { isSafeAutomaticMemoryText } from "../canonical-ingestion-source.ts";
import { proposeHindsightPolicyAssessment } from "./hindsight-policy-assessment.ts";
import { HindsightPolicyRefusal } from "./hindsight-policy-context.ts";
import { assertCuratorReviewOpen, assertCuratorWorkCurrent } from "./hindsight-policy-curator-targets.ts";
import { HINDSIGHT_POLICY_FINISH_TOOL } from "./hindsight-policy-curator-prompt.ts";
import type { HindsightPolicyCuratorReview } from "./hindsight-policy-curator-context.ts";

const PolicyInput = TakiMemoryPolicyProjectionSchema.pick({ layerId: true, importance: true, visibility: true,
  disclosure: true, emotionalWeight: true, retention: true }).extend({ id: z.string().min(1).max(256) }).strict();

export function createHindsightPolicyCuratorTools(review: HindsightPolicyCuratorReview): ToolSet {
  const policies = [...review.records.values()].some((record) => record.target.kind === "policy");
  const blocks = [...review.records.values()].some((record) => record.target.kind === "block");
  return { ...(policies ? { memory_policy_assess: tool({
    description: "Save one final Taki policy assessment for a supplied work ID. Facts, source evidence, Bank ownership and existing deliberate visibility remain protected.",
    inputSchema: PolicyInput, execute: (input) => guarded(review, () => assess(review, input)),
  }) } : {}), ...(blocks ? { block_update: tool({
    description: "Save a complete replacement proposal for one listed background-owned Block. The user's own card cannot be changed.",
    inputSchema: z.strictObject({ id: z.string().min(1).max(256), content: z.string().max(100_000) }),
    execute: (input) => guarded(review, () => updateBlock(review, input)),
  }) } : {}), block_read: tool({
    description: "Read an already admitted Core Block snapshot, including the read-only user card. No other Character or hidden content is available.",
    toModelOutput: ({ output }) => ({ type: "text", value: fenceUntrusted({ source: "hindsight-policy-block",
      content: hindsightApplicationWireJson(output) }) }),
    inputSchema: z.strictObject({ id: z.string().min(1).max(256) }), execute: ({ id }) => guarded(review, () => {
      const block = review.blocks.find((value) => value.blockId === id);
      if (!block) throw new Error("MEMORY_CAPABILITY_UNSUPPORTED");
      return { ok: true, id, value: block.value, readOnly: id === "user-card" };
    }),
  }), [HINDSIGHT_POLICY_FINISH_TOOL]: tool({
    description: "Finish this scoped policy review. Untouched background Blocks are explicitly kept unchanged; unassessed policy work remains retryable.",
    inputSchema: z.strictObject({}), execute: () => guarded(review, () => {
      for (const record of review.records.values()) if (record.target.kind === "block" && record.result === null) {
        save(review, record, { kind: "block-unchanged", prompt: review.prompt, at: now(review) });
      }
      review.finished = true; return { ok: true, status: "review_finished" };
    }),
  }) };
}

function assess(review: HindsightPolicyCuratorReview, input: z.infer<typeof PolicyInput>) {
  const { id, ...policy } = input;
  const record = review.records.get(id);
  if (!record || record.target.kind !== "policy") throw new Error("MEMORY_CAPABILITY_UNSUPPORTED");
  assertCuratorWorkCurrent(review.run, { scope: record.key, target: record.target });
  if (policy.disclosure?.trim() && !isSafeAutomaticMemoryText(policy.disclosure)) throw new Error("MEMORY_INVALID_REQUEST");
  const at = now(review);
  const body = proposeHindsightPolicyAssessment({ ...policyAssessmentTarget(record.key, record.target),
    policy, intent: "automatic", prompt: review.prompt, completedAt: at });
  return save(review, record, { kind: "assessment", body, prompt: review.prompt, at });
}
function updateBlock(review: HindsightPolicyCuratorReview, input: { id: string; content: string }) {
  const record = [...review.records.values()].find((value) => value.target.kind === "block" && value.target.blockId === input.id);
  if (!record || record.target.kind !== "block" || input.id === "user-card") throw new Error("MEMORY_CAPABILITY_UNSUPPORTED");
  assertCuratorWorkCurrent(review.run, { scope: record.key, target: record.target });
  if (input.content.trim() && !isSafeAutomaticMemoryText(input.content)) throw new Error("MEMORY_INVALID_REQUEST");
  const at = now(review);
  const body = TakiApplicationBlockBodySchema.parse({ block_id: record.target.blockId, scope: record.target.bank.scope,
    content: input.content, block_revision: (record.target.block?.block_revision ?? 0) + 1, updated_at: at,
    writer: "background", block_contract_version: 1 });
  return save(review, record, { kind: "block-update", body, prompt: review.prompt, at });
}
function save(review: HindsightPolicyCuratorReview, record: HindsightPolicyWorkRecord, result: HindsightPolicyWorkResult) {
  const next = review.run.deps.work.saveResult({ claim: policyWorkClaim(record), result });
  review.records.set(record.key.workId, next);
  return { ok: true, status: "proposal_saved", workId: record.key.workId };
}
function guarded(review: HindsightPolicyCuratorReview, action: () => object): object {
  try {
    assertCuratorReviewOpen(review);
    return action();
  }
  catch (error) {
    const code = MemoryErrorCodeSchema.safeParse(error instanceof Error ? error.message : "");
    return { ok: false, code: code.success ? code.data : error instanceof HindsightPolicyRefusal ? "MEMORY_INVALID_REQUEST" : "MEMORY_INTERNAL_ERROR",
      message: "The policy proposal was not accepted." };
  }
}
function now(review: HindsightPolicyCuratorReview): string { return review.run.deps.now?.() ?? new Date().toISOString(); }
