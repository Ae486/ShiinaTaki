/**
 * INPUT: one trusted analysis-purpose binding and existing Run snapshot/interactive authority
 * OUTPUT: tracked internal accepted admission with bounded expiry and shared shutdown ownership
 * POS: core/co-watching — admission composition shared by explicit answers and retained recommendation results
 */
import { ACCEPTED_WORK_PROVIDER } from "@taki/shared";
import { retireMediaAnalysis, settleMediaAnalysis, type MediaAnalysisBinding, type MediaAnalysisState } from "./media-analysis-state.ts";

export async function admitMediaAnalysis(state: MediaAnalysisState, job: MediaAnalysisBinding, parentRunId?: string): Promise<boolean> {
  const binding = job.binding;
  if (!binding) return false;
  const admission = state.deps.runs.admitAcceptedWork({ triggerRequestId: job.request.requestId,
    idempotencyKey: `media-analysis:${job.request.requestId}`, characterId: job.request.characterId, initiator: "primary",
    provenance: { provider: ACCEPTED_WORK_PROVIDER, sourceRef: binding.sourceRef, ...(parentRunId ? { parentRunId } : {}) },
    deliveryClass: "internal", contextMode: "autonomous", deadlineAt: job.expiresAt }, binding, job.interactive);
  // Include snapshot capture in shutdown tracking; a late admission must settle under the original cancellation.
  const tracked = admission.then((root) => { job.root = root; job.interactive.attemptId = root.attempt.attemptId; });
  state.work.add(tracked);
  try { await tracked; } finally { state.work.delete(tracked); }
  if (job.closed || state.closing) { settleMediaAnalysis(state, job); return false; }
  job.deadline = setTimeout(() => retireMediaAnalysis(state, job, "expired"), Math.max(1, Date.parse(job.expiresAt) - Date.now()));
  job.deadline.unref();
  return true;
}

export function canonicalVideoUrl(value: string): string | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return; }
  const match = /^\/video\/(BV[0-9A-Za-z]{10})\/?$/.exec(url.pathname);
  const parts = url.searchParams.getAll("p"); const page = parts[0] ?? "1";
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || !["bilibili.com", "www.bilibili.com"].includes(url.hostname) || !match
    || parts.length > 1 || !/^[1-9][0-9]*$/.test(page) || !Number.isSafeInteger(Number(page))) return;
  // Canonical syntax does not prove access or CID; the selected native service still performs that probe.
  return `https://www.bilibili.com/video/${match[1]}?p=${Number(page)}`;
}
