/**
 * INPUT: accepted operator source and live browser/catalog/Skill/MCP authorities
 * OUTPUT: synchronous source/publication gates and exact owned cancellation
 * POS: core/co-watching — business authorization only; no model call or IO in a publication gate
 */
import { CO_WATCHING_SKILL, type CoWatchingFailure, type CoWatchingSession, type PreparedPublicationCandidate } from "@taki/shared";
import type { CoWatchingBinding, CoWatchingRuntimeState } from "./runtime-types.ts";
import { stopCoWatchingChild } from "./child-adapter.ts";

export function coWatchingCurrent(state: CoWatchingRuntimeState, session: CoWatchingBinding): boolean {
  if (state.closing || session.closed || Date.now() >= Date.parse(session.expiresAt)) return false;
  const { deps } = state;
  const source = deps.sources.resolve(session.playback.sourceRef);
  if (!source || source.hostId !== session.playback.hostId || source.connectionGeneration !== session.playback.connectionGeneration
    || source.catalogGeneration !== session.playback.catalogGeneration) return false;
  if (session.analysis && deps.catalog.get(session.analysis.analysisId)?.revision !== session.analysis.revision) return false;
  if (!session.analysis && !deps.catalog.request(session.request.analysisId)) return false;
  if (deps.skills.describe(CO_WATCHING_SKILL)?.contentRevision !== session.skillRevision || !session.nativeTool.isCurrent()
    || (session.analysisTools && !session.analysisTools.isCurrent())) return false;
  if (session.root && deps.runs.context(session.root.run.runId)?.authorityCurrent?.() !== true) return false;
  return true;
}

export function coWatchingGate(state: CoWatchingRuntimeState, session: CoWatchingBinding,
  candidate: PreparedPublicationCandidate): "ready" | "hold" | "suppress" {
  if (!coWatchingCurrent(state, session)) return "suppress";
  if (session.child && (!session.child.planToken || state.deps.subagents?.isWorkCurrent(session.child.planToken, "publication").state !== "current")) return "hold";
  const source = state.deps.sources.resolve(session.playback.sourceRef);
  const item = session.plan?.candidates.find((entry) => entry.candidateRef === candidate.candidateRef);
  const moment = session.native?.analysis.moments.find((entry) => entry.moment_id === item?.momentId);
  if (!source || !moment || source.sample.positionSeconds === null) return "hold";
  // A valid native point does not supply an automatic publication window. Never coerce null to zero or infer an end.
  if (moment.end_seconds === null) return "suppress";
  if (Math.max(source.sample.positionSeconds, session.furthestPositionSeconds ?? 0) > moment.end_seconds) return "suppress";
  if (source.sample.state !== "playing" || (!source.sample.visible && !source.sample.pictureInPicture)
    || source.sample.positionSeconds < moment.at_seconds) return "hold";
  return "ready";
}

export function coWatchingView(session: CoWatchingBinding): CoWatchingSession {
  return { sessionId: session.id, sourceRef: session.playback.sourceRef, analysisId: session.request.analysisId,
    title: session.analysis?.title ?? `${session.playback.source.media.bvid} · P${session.playback.source.media.page}`, status: session.status, reason: session.reason, expiresAt: session.expiresAt,
    preparedCount: session.plan?.candidates.length ?? null, sentCount: session.sent.size,
    pendingRevision: !session.closed && (session.edit !== undefined || session.pending !== undefined || session.status === "revising"),
    ...(session.child?.subagentId ? { subagentId: session.child.subagentId, workInputId: session.child.workInputId } : {}) };
}

export function retireCoWatching(state: CoWatchingRuntimeState, session: CoWatchingBinding, reason: CoWatchingFailure): void {
  if (session.closed) return;
  session.closed = true; session.reason = reason;
  session.status = ["stopped", "expired", "source_lost", "shutdown"].includes(reason) ? "stopped" : "failed";
  clearTimeout(session.deadline); clearTimeout(session.analysisPoll); session.lifetime.abort(reason); session.controller?.abort(reason);
  // Closure is immediate even if a durable control write fails; no late callback can reopen publication.
  try {
    if (session.owner) session.owner.stop();
    else if (session.root) {
      state.deps.runs.requestCancel(session.root.run.runId, reason);
      state.deps.runs.settle(session.root.run.runId, session.root.attempt.attemptId, "cancelled", { retryable: false });
    }
  } catch { state.deps.logger.error({ code: "CO_WATCHING_RETIREMENT_FAILED" }, "Co-Watching control write failed"); }
  try { stopCoWatchingChild(state, session); }
  catch { state.deps.logger.error({ code: "CO_WATCHING_CHILD_STOP_FAILED" }, "Co-Watching child control write failed"); }
  state.deps.onChanged(session.request.characterId);
}
