/**
 * INPUT: one accepted source, captured governed MCP result tool and ordinary Agent/Skill execution
 * OUTPUT: validated future candidates committed behind the existing edit gate, then a quiescent root
 * POS: core/co-watching — accepted-work preparation adapter over existing governed native tools and Agent execution
 */
import { ACCEPTED_WORK_PROVIDER } from "@taki/shared";
import { createPreparedPublication } from "../delivery/prepared-publication.ts";
import { coWatchingCurrent, retireCoWatching } from "./runtime-source.ts";
import { verifyCoWatchingNative } from "./native-result.ts";
import { writeCoWatchingInput } from "./task-workspace.ts";
import { submitCoWatchingChild } from "./child-adapter.ts";
import type { CoWatchingBinding, CoWatchingRuntimeState } from "./runtime-types.ts";
import { advanceCoWatchingAnalysis, executeCoWatchingTool } from "./native-analysis.ts";

async function admit(state: CoWatchingRuntimeState, session: CoWatchingBinding): Promise<void> {
  if (session.root || !session.source) return;
  session.root = await state.deps.runs.admitAcceptedWork({ triggerRequestId: session.request.requestId,
    idempotencyKey: `co-watching:${session.request.requestId}`, characterId: session.request.characterId,
    initiator: "primary", provenance: { provider: ACCEPTED_WORK_PROVIDER, sourceRef: session.source.binding.sourceRef },
    deliveryClass: "internal", contextMode: "autonomous", deadlineAt: session.expiresAt }, session.source.binding, session.interactive);
  session.interactive.attemptId = session.root.attempt.attemptId;
  if (!coWatchingCurrent(state, session)) throw new Error("CO_WATCHING_SOURCE_LOST");
  const host = session.root.snapshot.hosts.find((entry) => entry.hostId === session.playback.hostId);
  if (!host?.available || host.connectionGeneration !== session.playback.connectionGeneration
    || host.catalogGeneration !== session.playback.catalogGeneration) throw new Error("CO_WATCHING_SOURCE_LOST");
  state.deps.runs.start(session.root.run.runId, session.root.attempt.attemptId);
  session.owner = createPreparedPublication({ rootRunId: session.root.run.runId, source: session.source,
    runs: state.deps.runs, repo: state.deps.deliveries, delivery: state.deps.delivery, queue: state.deps.queue, turns: state.deps.turns });
}

async function readNative(state: CoWatchingRuntimeState, session: CoWatchingBinding): Promise<void> {
  if (session.native || !session.root) return;
  if (!session.analysis) throw new Error("CO_WATCHING_ANALYSIS_UNAVAILABLE");
  session.status = "reading"; state.deps.onChanged(session.request.characterId);
  // This is the captured governed closure, including approval, Effect intent and MCP generation lease.
  const raw = await executeCoWatchingTool(state, session, { key: session.nativeTool.toolKey,
    args: { client_request_id: session.analysis.native.requestId, job_id: session.analysis.native.jobId, include_complete: true } });
  if (!coWatchingCurrent(state, session)) throw new Error("CO_WATCHING_SOURCE_LOST");
  const result = verifyCoWatchingNative(raw, session.analysis);
  session.native = result.native;
  await writeCoWatchingInput(state.deps.workspaceRoot, session, result.complete);
}

function hold(state: CoWatchingRuntimeState, session: CoWatchingBinding): void {
  if (!session.root || !session.source || session.closed) return;
  const { runId } = session.root.run; const status = state.deps.runs.status(runId);
  if (status.run.state === "waiting") return;
  const result = state.deps.runs.holdWork({ runId, attemptId: session.root.attempt.attemptId,
    expectedRunVersion: status.run.stateVersion, reasonRef: session.source.binding.sourceRef });
  if (!result.changed) throw new Error("CO_WATCHING_HOLD_REFUSED");
}

export async function prepareCoWatching(state: CoWatchingRuntimeState, session: CoWatchingBinding): Promise<void> {
  const instruction = session.pending; session.pending = undefined; session.workRequired = false;
  const controller = new AbortController(); session.controller = controller;
  const cancel = () => controller.abort(session.lifetime.signal.reason);
  session.lifetime.signal.addEventListener("abort", cancel, { once: true });
  const deadline = setTimeout(() => controller.abort("preparation deadline"), 240_000); deadline.unref();
  let registered = false;
  try {
    await admit(state, session);
    if (!session.root || session.closed) return;
    const previous = state.deps.runs.status(session.root.run.runId).run;
    if (previous.state === "waiting" && !state.deps.runs.resumeWork({ runId: previous.runId,
      attemptId: session.root.attempt.attemptId, expectedRunVersion: previous.stateVersion }).changed) throw new Error("CO_WATCHING_RESUME_REFUSED");
    state.deps.turns.begin(session.request.characterId, controller, session.root.run.runId); registered = true;
    if (!await advanceCoWatchingAnalysis(state, session)) { hold(state, session); return; }
    await readNative(state, session);
    if (controller.signal.aborted) throw new Error("CO_WATCHING_PREPARATION_FAILED");
    await submitCoWatchingChild(state, session, instruction);
    if (controller.signal.aborted && !session.pending && !session.closed) throw new Error("CO_WATCHING_PREPARATION_FAILED");
    hold(state, session);
  } catch (error) {
    if (!session.closed && session.yieldRequested && controller.signal.aborted) {
      // Preserve the semantic edit through a cooperative yield; never replay an interrupted model stream.
      session.pending ??= instruction;
      session.workRequired = true;
      try { hold(state, session); } catch { retireCoWatching(state, session, "preparation_failed"); }
    } else if (!session.closed && session.pending !== undefined && controller.signal.aborted) {
      try { hold(state, session); } catch { retireCoWatching(state, session, "preparation_failed"); }
    } else if (!session.closed) {
      const code = error instanceof Error ? error.message : "";
      retireCoWatching(state, session, code === "CO_WATCHING_ANALYSIS_MISMATCH" ? "analysis_mismatch"
        : code === "CO_WATCHING_ANALYSIS_FAILED" ? "analysis_failed"
        : code === "CO_WATCHING_ANALYSIS_UNKNOWN" ? "analysis_unknown"
        : code === "CO_WATCHING_ANALYSIS_UNAVAILABLE" ? "analysis_unavailable"
        : code === "CO_WATCHING_PLAN_INVALID" ? "plan_invalid" : "preparation_failed");
    }
  } finally {
    clearTimeout(deadline); session.lifetime.signal.removeEventListener("abort", cancel);
    session.controller = undefined; session.yieldRequested = false;
    if (registered) state.deps.turns.end(session.request.characterId, controller);
    if (session.closed && session.root) {
      const status = state.deps.runs.status(session.root.run.runId).run;
      if (["queued", "running", "waiting", "cancel_requested"].includes(status.state)) {
        state.deps.runs.settle(status.runId, session.root.attempt.attemptId, "cancelled", { retryable: false });
      }
    }
    state.deps.onChanged(session.request.characterId);
  }
}
