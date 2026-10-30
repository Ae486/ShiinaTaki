/**
 * INPUT: accepted live Co-Watching root, verified native material and shared SubagentService
 * OUTPUT: revision-specific private child work and committed validated plans for the original publication owner
 * POS: core/co-watching — business adapter only; shared Runtime owns model execution, controls and terminal truth
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CO_WATCHING_SKILL, CoWatchingPlanSchema, type SourceContext, type SubagentTarget,
  type SubagentWorkToken, type CoWatchingPlan } from "@taki/shared";
import { digestRunValue } from "../db/run-row-mappers.ts";
import type { OwnedSubagentExecution, SubagentWorkBinding } from "../harness/subagent-state.ts";
import { SubagentValidationError } from "../harness/subagent-state.ts";
import { coWatchingCurrent, retireCoWatching } from "./runtime-source.ts";
import { coWatchingPaths, readCoWatchingPlan, writeCoWatchingCurrent } from "./task-workspace.ts";
import type { CoWatchingBinding, CoWatchingRuntimeState } from "./runtime-types.ts";

const CompletedPlan = z.strictObject({ sessionId: z.uuid(), analysisId: z.uuid(), nativeRevision: z.int().positive(),
  artifactDigest: z.string().regex(/^[a-f0-9]{64}$/), plan: CoWatchingPlanSchema });

interface Artifact {
  runId: string; revision: string; reference: string; edit: NonNullable<CoWatchingBinding["edit"]>;
  committedDigest: string;
}
export interface CoWatchingChildWork {
  subagentId?: string; workInputId?: string; binding: SubagentWorkBinding;
  artifact?: Artifact; ownerYield: boolean; acceptedCompletionId?: string;
  planToken?: SubagentWorkToken; generatedBy?: SourceContext["generatedBy"];
}

export async function submitCoWatchingChild(state: CoWatchingRuntimeState, session: CoWatchingBinding, instruction?: string): Promise<void> {
  if (!session.root || !session.owner || !session.analysis || !session.native) throw new Error("CO_WATCHING_NOT_READY");
  session.edit ??= session.owner.beginEdit(session.revision);
  if (!session.edit) throw new Error("CO_WATCHING_EDIT_REFUSED");
  session.status = session.plan ? "revising" : "preparing";
  // No bounded moment is Core's deterministic no-publication outcome, never a fabricated model result.
  if (!session.native.analysis.moments.some((moment) => moment.end_seconds !== null)) {
    await installPlan(state, session, { plan: { revision: randomUUID(), candidates: [] }, edit: session.edit });
    return;
  }
  if (!state.deps.subagents) throw new Error("CO_WATCHING_NOT_READY");
  if (session.child) { reviseCoWatchingChild(state, session, instruction ?? "Continue the accepted preparation."); return; }
  const binding: SubagentWorkBinding = {
    parentRunId: session.root.run.runId, scheduling: "yieldable_character_background",
    source: { ownerRef: `co-watching:${session.id}`, revision: String(session.analysis.revision) },
    checkCurrent: () => coWatchingCurrent(state, session) ? { state: "current" } : { state: "retired", reason: "source_retired" },
    prepareExecution: (execution) => prepareExecution(state, session, execution),
    validateAndPropose: (execution) => validateAndPropose(state, session, execution),
    onCommittedResult: (completionId) => acceptCommittedResult(state, session, completionId),
    onControlChanged: () => controlChanged(state, session),
  };
  session.child = { binding, ownerYield: false };
  const paths = coWatchingPaths(session);
  const accepted = await state.deps.subagents.submitOwnedWork(binding, {
    characterId: session.request.characterId, operationKey: `co-watching:${session.id}`, label: `Co-Watching: ${session.analysis.title}`.slice(0, 200),
    initialContext: { kind: "fresh" }, direction: instruction ?? "Prepare grounded companion reactions for this accepted video.",
    materials: [{ key: "accepted-video", text: `Verified analysis: ${paths.input}/analysis.json. Complete native result: ${paths.input}/native-result.json.`,
      source: mediaSource(session) }], completionPolicy: "record_only", lifetimeMinutes: session.request.lifetimeMinutes,
  });
  session.child.subagentId = accepted.conversation.subagentId;
  session.child.workInputId = accepted.input!.workInputId;
  if (session.closed) stopCoWatchingChild(state, session);
  state.deps.onChanged(session.request.characterId);
}

async function prepareExecution(state: CoWatchingRuntimeState, session: CoWatchingBinding, execution: OwnedSubagentExecution): Promise<string> {
  if (!session.child || !session.edit || !coWatchingCurrent(state, session) || execution.signal.aborted) throw new Error("CO_WATCHING_SOURCE_LOST");
  const paths = coWatchingPaths(session); const revision = randomUUID();
  session.child.subagentId = execution.token().subagentId; session.child.workInputId = execution.token().workInputId;
  session.child.artifact = { runId: execution.runId, revision, reference: `${paths.output}/${revision}.json`, edit: session.edit,
    committedDigest: digestRunValue([...session.committed]) };
  session.pending = undefined;
  session.status = session.plan ? "revising" : "preparing";
  if (session.plan) await writeCoWatchingCurrent(state.deps.workspaceRoot, session);
  if (!coWatchingCurrent(state, session) || execution.signal.aborted) throw new Error("CO_WATCHING_SOURCE_LOST");
  state.deps.onChanged(session.request.characterId);
  return `Use load_skill to load ${CO_WATCHING_SKILL}. The user explicitly accepted this selected video.
Read ${paths.input}/analysis.json; the complete original result is available at ${paths.input}/native-result.json.
Only boundedMomentIds in analysis.json can anchor automatic reactions. Unknown ends remain unknown.
${session.plan ? `Read ${paths.input}/current-plan.json first. Keep delivered candidates unchanged; revise future content only.` : "Prepare a few optional concise Chinese companion reactions; no obligation to cover every moment."}
Write the proposed strict JSON plan to ${paths.output}/${revision}.json with revision ${revision}.
Preserve the video's speaker and relevant quotation; the video's first person is not the user's experience.
This is private preparation. Do not publish, activate other tasks, run analysis, or call presentation tools.`;
}

async function validateAndPropose(state: CoWatchingRuntimeState, session: CoWatchingBinding, execution: OwnedSubagentExecution) {
  const artifact = session.child?.artifact;
  if (!artifact || artifact.runId !== execution.runId || !session.analysis) throw new Error("CO_WATCHING_PLAN_INVALID");
  let plan: CoWatchingPlan;
  try { plan = await readCoWatchingPlan(state.deps.workspaceRoot, session, artifact.revision); }
  catch {
    throw new SubagentValidationError({ text: "Co-Watching plan validation failed: missing, incomplete or invalid proposal.",
      artifact: { reference: artifact.reference, revision: artifact.revision } });
  }
  if (execution.signal.aborted || !coWatchingCurrent(state, session) || session.child?.artifact !== artifact
    || session.edit !== artifact.edit || artifact.committedDigest !== digestRunValue([...session.committed])) throw new Error("CO_WATCHING_PLAN_INVALID");
  const sourceContext: SourceContext = { generatedBy: { runId: execution.runId, attemptId: execution.attemptId(),
    subagentId: execution.token().subagentId }, materials: [mediaSource(session)] };
  return { text: JSON.stringify({ sessionId: session.id, analysisId: session.analysis.analysisId,
    nativeRevision: session.analysis.revision, artifactDigest: digestRunValue(plan), plan }), sourceContext,
    artifact: { reference: artifact.reference, revision: artifact.revision } };
}

async function acceptCommittedResult(state: CoWatchingRuntimeState, session: CoWatchingBinding, completionId: string): Promise<void> {
  const child = session.child; const service = state.deps.subagents;
  if (!child || !service || session.closed || child.acceptedCompletionId === completionId) return;
  const result = service.result({ characterId: session.request.characterId, completionId }).result.child;
  if (result.workInputId !== child.workInputId || result.runId !== child.artifact?.runId) return;
  if (service.summary(result.subagentId).stopOrigin) { controlChanged(state, session); return; }
  if (result.outcome === "cancelled" || session.pending !== undefined || child.ownerYield) return;
  if (result.outcome !== "completed" || result.outputKind !== "validated" || !result.body) {
    retireCoWatching(state, session, "plan_invalid"); return;
  }
  const value = CompletedPlan.parse(JSON.parse(result.body));
  if (!coWatchingCurrent(state, session) || value.sessionId !== session.id || value.analysisId !== session.analysis?.analysisId
    || value.nativeRevision !== session.analysis.revision || value.plan.revision !== child.artifact.revision
    || value.artifactDigest !== digestRunValue(value.plan) || result.artifact?.reference !== child.artifact.reference
    || session.edit !== child.artifact.edit || child.artifact.committedDigest !== digestRunValue([...session.committed])) return;
  child.planToken = { subagentId: result.subagentId, workInputId: result.workInputId, throughWorkSeq: result.throughWorkSeq,
    controlVersion: service.summary(result.subagentId).controlVersion, source: child.binding.source };
  if (service.isWorkCurrent(child.planToken, "publication").state !== "current") return;
  child.generatedBy = result.sourceContext.generatedBy;
  child.acceptedCompletionId = completionId;
  await installPlan(state, session, { plan: value.plan, edit: child.artifact.edit });
  state.schedule();
}

async function installPlan(state: CoWatchingRuntimeState, session: CoWatchingBinding, input: { plan: CoWatchingPlan; edit: NonNullable<CoWatchingBinding["edit"]> }): Promise<void> {
  const { plan, edit } = input;
  session.plan = plan; session.revision = plan.revision; session.settledCandidates = new Set(session.committed.keys());
  if (!session.owner?.confirmEdit(edit, plan.revision)) throw new Error("CO_WATCHING_EDIT_REFUSED");
  session.edit = undefined; session.status = "ready";
  await writeCoWatchingCurrent(state.deps.workspaceRoot, session);
  state.deps.onChanged(session.request.characterId);
}

function childTarget(state: CoWatchingRuntimeState, session: CoWatchingBinding): SubagentTarget | undefined {
  const child = session.child;
  if (!child?.subagentId || !child.workInputId || !state.deps.subagents) return;
  const current = state.deps.subagents.summary(child.subagentId);
  return { subagentId: child.subagentId, workInputId: child.workInputId,
    expectedRunId: current.activeRunId, expectedControlVersion: current.controlVersion };
}

function controlChanged(state: CoWatchingRuntimeState, session: CoWatchingBinding): void {
  const target = childTarget(state, session);
  if (!target || session.closed) return;
  const current = state.deps.subagents!.summary(target.subagentId);
  session.edit ??= session.owner?.beginEdit(session.revision);
  session.status = current.stopOrigin ? "paused_child" : session.plan ? "revising" : "preparing";
  state.deps.onChanged(session.request.characterId);
}

export function reviseCoWatchingChild(state: CoWatchingRuntimeState, session: CoWatchingBinding, instruction: string): void {
  const target = childTarget(state, session); const child = session.child;
  if (!target || !child) return;
  session.pending = instruction; child.ownerYield = false;
  state.deps.subagents!.resumeOwnedWork(child.binding, { characterId: session.request.characterId, target,
    operationKey: randomUUID(), direction: instruction, materials: [] });
  if (target.expectedRunId) state.deps.subagents!.yieldOwnedWork(target);
}

export function yieldCoWatchingChild(state: CoWatchingRuntimeState, session: CoWatchingBinding): void {
  const target = childTarget(state, session);
  if (!target?.expectedRunId || !session.child) return;
  session.child.ownerYield = true;
  if (!state.deps.subagents!.yieldOwnedWork(target)) session.child.ownerYield = false;
}

export function resumeCoWatchingChild(state: CoWatchingRuntimeState, session: CoWatchingBinding): void {
  const target = childTarget(state, session); const child = session.child;
  if (!target || !child?.ownerYield || target.expectedRunId || session.closed || !coWatchingCurrent(state, session)) return;
  if (state.deps.subagents!.summary(target.subagentId).stopOrigin) return;
  child.ownerYield = false;
  state.deps.subagents!.resumeOwnedWork(child.binding, { characterId: session.request.characterId, target,
    operationKey: randomUUID(), direction: "Resume the accepted preparation after foreground work released its lane.", materials: [] });
}

export function stopCoWatchingChild(state: CoWatchingRuntimeState, session: CoWatchingBinding): void {
  const target = childTarget(state, session);
  if (!target || state.deps.subagents!.summary(target.subagentId).stopOrigin === "user") return;
  state.deps.subagents!.stop({ characterId: session.request.characterId, target }, "parent");
}

export function coWatchingCandidateSource(session: CoWatchingBinding, momentId: string): SourceContext | undefined {
  const moment = session.native?.analysis.moments.find((item) => item.moment_id === momentId);
  if (!moment || !session.child?.generatedBy) return;
  return { generatedBy: session.child.generatedBy, materials: [{ ...mediaSource(session),
    time: `${moment.at_seconds}-${moment.end_seconds} seconds; moment ${moment.moment_id}` }] };
}

function mediaSource(session: CoWatchingBinding) {
  const media = session.playback.source.media;
  return { label: session.analysis?.title ?? media.bvid,
    reference: `https://www.bilibili.com/video/${media.bvid}/?p=${media.page}` };
}
