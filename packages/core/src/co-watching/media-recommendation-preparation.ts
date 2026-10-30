/**
 * INPUT: one real primary Run/Attempt source and one to three explicitly selected Bilibili URLs
 * OUTPUT: sequential native-only accepted work with exact batch/item inspection and cancellation
 * POS: core/co-watching — bounded composition in the existing analysis owner; no speech authorization or scheduler
 */
import { randomUUID } from "node:crypto";
import { MediaRecommendationStartSchema, type MediaRecommendationStart,
  type MediaRecommendationBatch, type MediaRecommendationControlResult } from "@taki/shared";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import type { InteractionPatternPrimarySource } from "../initiative/patterns/pattern-source.ts";
import { admitMediaAnalysis, canonicalVideoUrl } from "./media-analysis-admission.ts";
import { mediaAnalysisCurrent, mediaAnalysisView, retireMediaAnalysis,
  type MediaAnalysisBinding, type MediaAnalysisState, type MediaRecommendationState } from "./media-analysis-state.ts";

export interface MediaRecommendationAuthority {
  readonly runId: string; readonly attemptId: string; readonly interactive: TurnInteractive;
  readonly userTimelineSeq: number; readonly userTimelineId: string;
}

export async function prepareRecommendations(state: MediaAnalysisState, candidate: MediaRecommendationStart,
  authority: MediaRecommendationAuthority): Promise<MediaRecommendationControlResult> {
  const parsed = MediaRecommendationStartSchema.safeParse(candidate);
  if (!parsed.success) return { accepted: false, reason: "invalid_request" };
  const videoUrls = parsed.data.videoUrls.map(canonicalVideoUrl);
  if (videoUrls.some((url) => !url) || new Set(videoUrls).size !== videoUrls.length) return { accepted: false, reason: "invalid_request" };
  const request = { ...parsed.data, videoUrls: videoUrls as string[] };
  // Transport messageId, Run trigger identity and the committed Timeline row have distinct UUIDs.
  // Reuse the existing primary-source owner to bind the actual row; equality with transport identity is not proof.
  const source = primarySource(request.characterId, authority);
  try {
    if (request.requestId !== source.userTimelineId || state.deps.primarySource?.register(source) !== true) {
      return { accepted: false, reason: "source_unavailable" };
    }
  } catch { return { accepted: false, reason: "source_unavailable" }; }
  if (!sourceCurrent(state, request, authority)) return { accepted: false, reason: "source_unavailable" };
  const previous = state.recommendations.get(request.characterId);
  if (previous?.request.requestId === request.requestId) return JSON.stringify(previous.request) === JSON.stringify(request)
    ? previous.admitted ? { accepted: true, batch: batchView(previous) } : previous.admission ?? { accepted: false, reason: "not_ready" }
    : { accepted: false, reason: "request_conflict" };
  if (previous?.jobs.some((job) => !job.closed)) return { accepted: false, reason: "already_active" };
  if (state.closing || !state.deps.targetReady(request.characterId)
    || state.jobs.size - (previous?.jobs.length ?? 0) + videoUrls.length > 64) return { accepted: false, reason: "not_ready" };
  const choices = state.deps.analysisTools().filter((tools) => tools.isCurrent());
  if (choices.length !== 1) return { accepted: false, reason: "not_ready" };
  const batch: MediaRecommendationState = { request, jobs: [], admitted: false };
  for (const videoUrl of request.videoUrls) {
    const lifetime = new AbortController(); const requestId = randomUUID();
    const job: MediaAnalysisBinding = { key: `recommendation:${requestId}`, purpose: "recommendation_preanalysis",
      request: { requestId, characterId: request.characterId, videoUrl, lifetimeMinutes: request.lifetimeMinutes },
      revision: randomUUID(), expiresAt: new Date(Date.now() + request.lifetimeMinutes * 60_000).toISOString(),
      status: "accepted", reason: null, closed: false, working: false, publishing: false, workRequired: false,
      lifetime, interactive: { connection: authority.interactive.connection, signal: lifetime.signal },
      analysisTools: choices[0], predecessor: batch.jobs.at(-1) };
    // A real primary request authorizes only this bounded preparation. No publication field/Class A handle exists.
    job.binding = Object.freeze({ sourceRef: `recommendation-preanalysis:${request.requestId}:${requestId}`,
      isCurrent: () => mediaAnalysisCurrent(state, job) && (batch.admitted || sourceCurrent(state, request, authority)) });
    batch.jobs.push(job);
  }
  for (const job of previous?.jobs ?? []) state.jobs.delete(job.key);
  state.recommendations.set(request.characterId, batch);
  for (const job of batch.jobs) state.jobs.set(job.key, job);
  batch.admission = admitBatch(state, batch, authority);
  return batch.admission;
}

async function admitBatch(state: MediaAnalysisState, batch: MediaRecommendationState,
  authority: MediaRecommendationAuthority): Promise<MediaRecommendationControlResult> {
  try {
    for (const job of batch.jobs) {
      if (!sourceCurrent(state, batch.request, authority) || !await admitMediaAnalysis(state, job, authority.runId)) {
        throw new Error("MEDIA_RECOMMENDATION_SOURCE_LOST");
      }
    }
    if (!sourceCurrent(state, batch.request, authority)) throw new Error("MEDIA_RECOMMENDATION_SOURCE_LOST");
    batch.admitted = true;
    for (const job of batch.jobs) job.workRequired = true;
    state.deps.onChanged?.(batch.request.characterId); state.schedule();
    return { accepted: true, batch: batchView(batch) };
  } catch {
    for (const job of batch.jobs) retireMediaAnalysis(state, job, state.closing ? "shutdown" : "authority_changed");
    return { accepted: false, reason: "source_unavailable" };
  }
}

function sourceCurrent(state: MediaAnalysisState, request: MediaRecommendationStart, authority: MediaRecommendationAuthority): boolean {
  try {
    const { interactive } = authority;
    if (state.closing || interactive.signal?.aborted || interactive.connection?.state.status !== "authenticated"
      || interactive.connection.state.role !== "operator") return false;
    const { run } = state.deps.runs.status(authority.runId);
    return run.characterId === request.characterId && run.state === "running" && run.activeAttemptId === authority.attemptId
      && run.initiator === "primary" && run.deliveryClass === "class_a" && run.provenance.provider === "chat"
      && run.idempotencyKey === run.provenance.triggerRequestId && request.requestId === authority.userTimelineId
      && state.deps.primarySource?.isCurrent(primarySource(request.characterId, authority)) === true
      && state.deps.runs.context(authority.runId)?.authorityCurrent?.() === true;
  } catch { return false; }
}

function primarySource(characterId: string, authority: MediaRecommendationAuthority): InteractionPatternPrimarySource {
  return { characterId, runId: authority.runId, attemptId: authority.attemptId,
    userTimelineSeq: authority.userTimelineSeq, userTimelineId: authority.userTimelineId };
}

function batchView(batch: MediaRecommendationState): MediaRecommendationBatch {
  const active = batch.jobs.some((job) => !job.closed);
  const status = active ? "preparing" : batch.jobs.some((job) => job.status === "failed") ? "failed"
    : batch.jobs.some((job) => job.status === "cancelled") ? "cancelled" : "completed";
  return { batchId: batch.request.requestId, characterId: batch.request.characterId, status, jobs: batch.jobs.map(mediaAnalysisView) };
}

export function readRecommendationBatch(state: MediaAnalysisState, characterId: string, batchId?: string): MediaRecommendationBatch | null {
  const batch = state.recommendations.get(characterId);
  return batch && (!batchId || batchId === batch.request.requestId) ? batchView(batch) : null;
}

export function cancelRecommendationBatch(state: MediaAnalysisState, characterId: string,
  selection: { batchId: string; jobRequestId?: string }): MediaRecommendationControlResult {
  const batch = state.recommendations.get(characterId);
  if (!batch || batch.request.requestId !== selection.batchId) return { accepted: false, reason: "not_found" };
  const jobs = selection.jobRequestId ? batch.jobs.filter((job) => job.request.requestId === selection.jobRequestId) : batch.jobs;
  if (!jobs.length) return { accepted: false, reason: "not_found" };
  for (const job of jobs) retireMediaAnalysis(state, job, "cancelled");
  state.schedule();
  return { accepted: true, batch: batchView(batch) };
}
