/**
 * INPUT: primary URL requests/selected recommendations and existing accepted Run, Character queue and Delivery owners
 * OUTPUT: explicit once-only answers or silent bounded native preparation, with scoped status/cancellation
 * POS: core/co-watching — inert business adapter; no scheduler, playback requirement or independent execution ledger
 */
import { randomUUID } from "node:crypto";
import { MediaAnalysisStartSchema, type MediaAnalysisControlResult, type MediaAnalysisJob, type MediaAnalysisStart,
  type MediaRecommendationStart, type MediaRecommendationBatch, type MediaRecommendationControlResult } from "@taki/shared";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import { fenceUntrusted } from "../agents/untrusted-fence.ts";
import { advanceMediaAnalysis } from "./media-analysis-work.ts";
import { admitMediaAnalysis, canonicalVideoUrl } from "./media-analysis-admission.ts";
import { prepareRecommendations, readRecommendationBatch, cancelRecommendationBatch,
  type MediaRecommendationAuthority } from "./media-recommendation-preparation.ts";
import { createMediaAnalysisSource, mediaAnalysisCurrent, mediaAnalysisView, retireMediaAnalysis, settleMediaAnalysis,
  type MediaAnalysisBinding, type MediaAnalysisDependencies, type MediaAnalysisState } from "./media-analysis-state.ts";

export interface MediaAnalysisRuntime {
  analyze(request: MediaAnalysisStart, interactive: TurnInteractive): Promise<MediaAnalysisControlResult>;
  prepare(request: MediaRecommendationStart, authority: MediaRecommendationAuthority): Promise<MediaRecommendationControlResult>;
  preparation(characterId: string, batchId?: string): MediaRecommendationBatch | null;
  cancelPreparation(characterId: string, selection: { batchId: string; jobRequestId?: string }): MediaRecommendationControlResult;
  read(characterId: string): MediaAnalysisJob | null;
  context(characterId: string): string;
  yieldToPrimary(characterId: string): void;
  cancel(characterId: string, requestId: string): MediaAnalysisControlResult;
  released(): void;
  close(): Promise<void>;
}

export function createMediaAnalysisRuntime(deps: MediaAnalysisDependencies): MediaAnalysisRuntime {
  const state: MediaAnalysisState = { deps, jobs: new Map(), recommendations: new Map(), closing: false, scheduled: false,
    work: new Set(), schedule: () => schedule(state) };
  return {
    analyze: (request, interactive) => analyze(state, request, interactive),
    prepare: (request, authority) => prepareRecommendations(state, request, authority),
    preparation: (characterId, batchId) => readRecommendationBatch(state, characterId, batchId),
    cancelPreparation: (characterId, selection) => cancelRecommendationBatch(state, characterId, selection),
    read: (characterId) => { const job = state.jobs.get(characterId); return job ? mediaAnalysisView(job) : null; },
    context(characterId) {
      const job = state.jobs.get(characterId);
      return job ? fenceUntrusted({ source: "explicit-video-analysis-status", content: JSON.stringify(mediaAnalysisView(job)) }) : "";
    },
    yieldToPrimary(characterId) {
      for (const job of state.jobs.values()) {
        if (job.request.characterId !== characterId || job.closed || !job.working || !job.controller || !["probing", "analyzing"].includes(job.status)) continue;
        // Native calls reconcile safely. A final explicit answer is never interrupted and silently regenerated.
        job.yieldRequested = true; job.workRequired = true; job.controller.abort("foreground conversation reserved");
      }
    },
    cancel(characterId, requestId) {
      const job = state.jobs.get(characterId);
      if (!job || job.request.requestId !== requestId) return { accepted: false, reason: "not_found" };
      if (!job.closed) retireMediaAnalysis(state, job, "cancelled");
      return { accepted: true, job: mediaAnalysisView(job) };
    },
    released: state.schedule,
    async close() {
      state.closing = true;
      for (const job of state.jobs.values()) retireMediaAnalysis(state, job, "shutdown");
      await Promise.allSettled([...state.work]);
    },
  };
}

async function analyze(state: MediaAnalysisState, candidate: MediaAnalysisStart, interactive: TurnInteractive): Promise<MediaAnalysisControlResult> {
  const parsed = MediaAnalysisStartSchema.safeParse(candidate);
  const videoUrl = parsed.success && canonicalVideoUrl(parsed.data.videoUrl);
  if (!parsed.success || !videoUrl) return { accepted: false, reason: "invalid_request" };
  const request = { ...parsed.data, videoUrl }; const existing = state.jobs.get(request.characterId);
  if (existing?.request.requestId === request.requestId) return JSON.stringify(existing.request) === JSON.stringify(request)
    ? { accepted: true, job: mediaAnalysisView(existing) } : { accepted: false, reason: "request_conflict" };
  if (existing && !existing.closed) return { accepted: false, reason: "already_active" };
  if (state.closing || !state.deps.targetReady(request.characterId) || (!existing && state.jobs.size >= 64)) return { accepted: false, reason: "not_ready" };
  const choices = state.deps.analysisTools().filter((tools) => tools.isCurrent());
  if (choices.length !== 1) return { accepted: false, reason: "not_ready" };
  const lifetime = new AbortController();
  const job: MediaAnalysisBinding = { key: request.characterId, purpose: "explicit_analysis", request,
    expiresAt: new Date(Date.now() + request.lifetimeMinutes * 60_000).toISOString(),
    revision: randomUUID(), status: "accepted", reason: null, closed: false, working: false, publishing: false,
    workRequired: true, lifetime, interactive: { ...interactive, signal: lifetime.signal }, analysisTools: choices[0] };
  state.jobs.set(request.characterId, job);
  try {
    job.source = createMediaAnalysisSource(state, job);
    job.binding = job.source.binding;
    if (!await admitMediaAnalysis(state, job)) return { accepted: false, reason: "not_ready" };
    state.deps.onChanged?.(request.characterId); state.schedule();
    return { accepted: true, job: mediaAnalysisView(job) };
  } catch {
    retireMediaAnalysis(state, job, "authority_changed");
    return { accepted: false, reason: "not_ready" };
  }
}

function schedule(state: MediaAnalysisState): void {
  if (state.closing || state.scheduled) return;
  state.scheduled = true;
  queueMicrotask(() => {
    state.scheduled = false;
    for (const job of state.jobs.values()) {
      if (job.closed || !job.root || job.working || job.publishing || job.predecessor && !job.predecessor.closed) continue;
      if (!mediaAnalysisCurrent(state, job)) { retireMediaAnalysis(state, job, "authority_changed"); continue; }
      if (job.text) publish(state, job);
      else if (job.workRequired) advance(state, job);
    }
  });
}

function advance(state: MediaAnalysisState, job: MediaAnalysisBinding): void {
  const release = state.deps.queue.tryAcquireBackground(job.request.characterId);
  if (!release) return;
  job.working = true;
  const work = advanceMediaAnalysis(state, job).catch(() => {
    retireMediaAnalysis(state, job, "analysis_unavailable");
  }).finally(() => {
    job.working = false; release(); state.work.delete(work); state.schedule();
  });
  state.work.add(work);
}

function publish(state: MediaAnalysisState, job: MediaAnalysisBinding): void {
  if (job.purpose !== "explicit_analysis" || !job.owner || !job.text) return;
  job.publishing = true;
  const work = job.owner.publish({ candidateRef: "analysis-result", expectedRevision: job.revision }).then((result) => {
    if (job.closed || result.status === "deferred") return;
    if (result.status === "refused") { retireMediaAnalysis(state, job, "delivery_failed"); return; }
    if (["staged", "held"].includes(result.state)) return;
    if (["expired", "suppressed"].includes(result.state)) { retireMediaAnalysis(state, job, "delivery_failed"); return; }
    // Keep the root alive through the child's final synchronous publication check. Transport uncertainty is committed.
    settleMediaAnalysis(state, job);
    job.closed = true; job.status = job.reason ? "failed" : "completed";
    clearTimeout(job.deadline); clearTimeout(job.poll); job.source?.retire();
    state.deps.onChanged?.(job.request.characterId);
  }).catch(() => retireMediaAnalysis(state, job, "delivery_failed"))
    .finally(() => {
      job.publishing = false; state.work.delete(work);
      if (!job.closed && !state.deps.queue.isBusy(job.request.characterId)) state.schedule();
    });
  state.work.add(work);
}
