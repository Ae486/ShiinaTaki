/**
 * INPUT: existing Core owners and process-local handles for explicit analysis or selected recommendation preparation
 * OUTPUT: immutable purpose, retained acceptance/currentness and ordinary Run settlement with explicit-only Delivery
 * POS: core/co-watching — analysis-only bindings; all execution evidence remains in existing repositories
 */
import type { MediaAccessProbeResult, MediaAnalysisFailure, MediaAnalysisJob, MediaAnalysisStart,
  MediaRecommendationStart, MediaRecommendationControlResult } from "@taki/shared";
import type { ChatAgent } from "../agents/chat-agent.ts";
import type { TurnQueue } from "../agents/turn-queue.ts";
import type { TurnRegistry } from "../agents/turn-registry.ts";
import type { RunAdmissionResult } from "../db/run-repo.ts";
import type { RunDeliveryRepo } from "../db/run-delivery-repo.ts";
import type { DeliveryCoordinator } from "../delivery/delivery-coordinator.ts";
import type { PreparedPublicationOwner } from "../delivery/prepared-publication.ts";
import { createPreparedPublicationSource, type PreparedPublicationSourceOwner } from "../delivery/prepared-publication-source.ts";
import { createPreparedPublicationAuthorization } from "../harness/prepared-publication-authorization.ts";
import type { RunService } from "../harness/run-service.ts";
import type { AcceptedWorkBinding } from "../harness/run-work-binding.ts";
import type { InteractionPatternPrimarySource } from "../initiative/patterns/pattern-source.ts";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import type { Logger } from "../logging/logger.ts";
import type { CoWatchingCatalog } from "./analysis-catalog.ts";
import type { CoWatchingAnalysisTools } from "./runtime-types.ts";
import type { CoWatchingNative } from "./native-result.ts";
import type { NativeAnalysisProgress } from "./native-analysis-progress.ts";

export interface MediaAnalysisDependencies {
  catalog: CoWatchingCatalog; ownerHostId: string; workspaceRoot: string;
  runs: RunService<TurnInteractive>; queue: TurnQueue; turns: TurnRegistry; agent: ChatAgent;
  deliveries: RunDeliveryRepo; delivery: DeliveryCoordinator; logger: Logger;
  analysisTools(): CoWatchingAnalysisTools[];
  targetReady(characterId: string): boolean;
  primarySource?: {
    register(source: InteractionPatternPrimarySource): boolean;
    isCurrent(source: InteractionPatternPrimarySource): boolean;
  };
  onChanged?(characterId: string): void;
}
export interface MediaAnalysisBinding extends NativeAnalysisProgress {
  readonly key: string; readonly purpose: "explicit_analysis" | "recommendation_preanalysis";
  request: Omit<MediaAnalysisStart, "instruction"> & Partial<Pick<MediaAnalysisStart, "instruction">>;
  expiresAt: string; revision: string;
  status: MediaAnalysisJob["status"]; reason: MediaAnalysisFailure | null;
  closed: boolean; working: boolean; publishing: boolean; workRequired: boolean;
  lifetime: AbortController; controller?: AbortController;
  poll?: ReturnType<typeof setTimeout>; deadline?: ReturnType<typeof setTimeout>;
  yieldRequested?: boolean;
  interactive: TurnInteractive; root?: RunAdmissionResult;
  binding?: AcceptedWorkBinding; predecessor?: MediaAnalysisBinding;
  source?: PreparedPublicationSourceOwner; owner?: PreparedPublicationOwner;
  probe?: MediaAccessProbeResult; native?: CoWatchingNative; complete?: unknown;
  text?: string;
}
export interface MediaRecommendationState {
  request: MediaRecommendationStart; jobs: MediaAnalysisBinding[]; admitted: boolean;
  admission?: Promise<MediaRecommendationControlResult>;
}
export interface MediaAnalysisState {
  deps: MediaAnalysisDependencies; jobs: Map<string, MediaAnalysisBinding>; closing: boolean;
  recommendations: Map<string, MediaRecommendationState>;
  scheduled: boolean; work: Set<Promise<void>>; schedule(): void;
}

export function mediaAnalysisCurrent(state: MediaAnalysisState, job: MediaAnalysisBinding): boolean {
  if (state.closing || job.closed || state.jobs.get(job.key) !== job
    || Date.now() >= Date.parse(job.expiresAt)) return false;
  if (job.root && state.deps.runs.context(job.root.run.runId)?.authorityCurrent?.() !== true) return false;
  return !job.analysis || state.deps.catalog.get(job.analysis.analysisId)?.revision === job.analysis.revision;
}

export function mediaAnalysisView(job: MediaAnalysisBinding): MediaAnalysisJob {
  return { requestId: job.request.requestId, characterId: job.request.characterId, videoUrl: job.request.videoUrl,
    status: job.status, reason: job.reason, expiresAt: job.expiresAt, runId: job.root?.run.runId ?? null,
    analysisId: job.analysis?.analysisId ?? job.analysisRequest?.analysisId ?? null,
    title: job.analysis?.title ?? job.probe?.title.slice(0, 240) ?? null };
}

export function createMediaAnalysisSource(state: MediaAnalysisState, job: MediaAnalysisBinding): PreparedPublicationSourceOwner {
  const accepted = { sourceRef: `media-analysis:${job.request.requestId}`, acceptanceRef: job.request.requestId,
    characterId: job.request.characterId, revision: job.revision, validity: { kind: "expires_at" as const, expiresAt: job.expiresAt } };
  // A direct request for a result is Class A. It grants neither Co-Watching consent nor timestamped commentary.
  const authorization = createPreparedPublicationAuthorization({ scope: { sourceRef: accepted.sourceRef,
    acceptanceRef: accepted.acceptanceRef, characterId: accepted.characterId, validity: accepted.validity, deliveryClass: "class_a" },
    isCurrent: () => mediaAnalysisCurrent(state, job) });
  return createPreparedPublicationSource({ readAccepted: () => accepted,
    isCurrent: () => mediaAnalysisCurrent(state, job), gate: () => "ready",
    resolve: ({ candidateRef, expectedRevision }) => candidateRef === "analysis-result" && expectedRevision === job.revision && job.text
      ? { candidateRef, revision: job.revision, text: job.text, expiresAt: job.expiresAt } : undefined,
  }, authorization);
}

export function holdMediaAnalysis(state: MediaAnalysisState, job: MediaAnalysisBinding): void {
  if (!job.root || !job.binding || job.closed) return;
  const run = state.deps.runs.status(job.root.run.runId).run;
  if (run.state === "waiting") return;
  if (!state.deps.runs.holdWork({ runId: run.runId, attemptId: job.root.attempt.attemptId,
    expectedRunVersion: run.stateVersion, reasonRef: job.binding.sourceRef }).changed) throw new Error("MEDIA_ANALYSIS_HOLD_REFUSED");
}

export function settleMediaAnalysis(state: MediaAnalysisState, job: MediaAnalysisBinding): void {
  if (!job.root) return;
  const run = state.deps.runs.status(job.root.run.runId).run;
  if (!["queued", "running", "waiting", "cancel_requested"].includes(run.state)) return;
  const cancelled = ["cancelled", "shutdown"].includes(job.reason ?? "");
  const outcome = cancelled ? "cancelled" : job.reason === "analysis_unknown" ? "outcome_unknown" : job.reason ? "failed" : "completed";
  state.deps.runs.settle(run.runId, job.root.attempt.attemptId, outcome,
    { retryable: false, ...(job.reason ? { errorCode: job.reason, summary: "Requested media analysis did not complete" } : {}) });
}

export function retireMediaAnalysis(state: MediaAnalysisState, job: MediaAnalysisBinding, reason: MediaAnalysisFailure): void {
  if (job.closed) return;
  job.closed = true; job.reason = reason;
  job.status = ["cancelled", "shutdown"].includes(reason) ? "cancelled" : "failed";
  clearTimeout(job.poll); clearTimeout(job.deadline);
  job.lifetime.abort(reason); job.controller?.abort(reason);
  try {
    job.owner?.stop(); job.source?.retire();
    if (job.root && !job.owner) state.deps.runs.requestCancel(job.root.run.runId, reason);
    if (!job.working) settleMediaAnalysis(state, job);
  } catch { state.deps.logger.error({ code: "MEDIA_ANALYSIS_RETIREMENT_FAILED" }, "Media analysis retirement failed"); }
  state.deps.onChanged?.(job.request.characterId);
}
