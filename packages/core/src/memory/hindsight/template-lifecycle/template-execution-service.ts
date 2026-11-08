/**
 * INPUT:  one claimed generic template operation and the original producer plan
 * OUTPUT: service stop signal, abort-bounded rollout, lease renewal and guarded durable final checkpoint
 * POS:    template executor lifetime — cancellation never releases a possible-effect hold in finally
 */
import type { MemoryTemplateProducerRef } from "@taki/shared";
import { readMemoryAuthoritySelection } from "../../legacy-migration/legacy-activation-repo.ts";
import { readHindsightLiveProjection } from "../hindsight-runtime-connection.ts";
import { templateErrorCode } from "./template-errors.ts";
import { activeTemplateHold, readTemplatePlan, readTemplatePublication } from "./template-execution-reads.ts";
import { assertTemplateExecutor, checkpointTemplateExecutor, claimTemplateExecutor, TEMPLATE_EXECUTOR_HEARTBEAT_MS,
  type TemplateExecutor, type TemplateExecutorLease } from "./template-executor-store.ts";
import { assertTemplateLocalPlan } from "./template-plan-guard.ts";
import type { TemplatePlan, TemplatePublication } from "./template-plan-schema.ts";
import type { TemplatePreviewDependencies } from "./template-preview-service.ts";
import { boundedTemplateWork, executeTemplateRollout, type TemplateRolloutContext, type TemplateRuntimeControl } from "./template-rollout.ts";
import { readTemplateSelectionIdentity } from "./template-runtime-selection.ts";

export interface TemplateExecutionDependencies extends TemplatePreviewDependencies { runtime: TemplateRuntimeControl }
interface Running { controller: AbortController; epochId: string }
export function createTemplateExecutionService(deps: TemplateExecutionDependencies) {
  const running = new Map<string, Running>();
  const stopped = new AbortController();
  return {
    stopped: () => stopped.signal.aborted,
    get stopSignal(): AbortSignal { return stopped.signal; },
    stop: () => { stopped.abort(); for (const entry of running.values()) entry.controller.abort(); },
    emergencyAdmitted: (epochId: string) => { for (const entry of running.values()) if (entry.epochId === epochId) entry.controller.abort(); },
    execute: async (input: { operationId: string; producer: MemoryTemplateProducerRef; signal?: AbortSignal;
      checkpoint(producer: MemoryTemplateProducerRef): void }): Promise<void> => {
      if (stopped.signal.aborted) throw new Error("MEMORY_TEMPLATE_LEASE_LOST");
      const plan = readTemplatePlan(deps.db, input.producer.planId);
      const live = readHindsightLiveProjection(deps);
      if (live.state !== "ready") throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
      let lease = claimTemplateExecutor(deps.db, { planId: plan.planId, operationId: input.operationId, bootId: deps.bootId, now: deps.now() });
      running.get(plan.planId)?.controller.abort();
      const entry = { controller: new AbortController(), epochId: plan.guard.epochId };
      const signal = input.signal ? AbortSignal.any([input.signal, entry.controller.signal]) : entry.controller.signal;
      running.set(plan.planId, entry);
      const clearTimers = executionTimers({ signal, timeoutMs: live.projection.setupTimeoutMs,
        abort: () => entry.controller.abort(), renew: () => { lease = checkpointTemplateExecutor(deps.db, { lease, now: deps.now() }); } });
      const checkpoint = (phase: TemplateExecutor["phase"]) => {
        lease = checkpointTemplateExecutor(deps.db, { lease, now: deps.now(), phase });
        input.checkpoint({ ...input.producer, phase });
      };
      try {
        const context = executionContext(deps, { plan, lease: () => lease, signal,
          checkpoint, timeoutMs: live.projection.requestTimeoutMs, client: deps.client(live.projection) });
        // The owner must settle before shutdown closes SQLite even if an already sent
        // transport ignores abort. The detached rollout retains its pre-access guards.
        const publication = readTemplatePublication(deps.db, plan.planId)
          ?? await boundedTemplateWork(signal, executeTemplateRollout(context));
        checkpoint("rebinding");
        await bindPublishedTemplate(deps, { plan, publication, lease: () => lease, signal });
        lease = checkpointTemplateExecutor(deps.db, { lease, now: deps.now(), phase: "settled", finish: true });
      } catch (cause) {
        try {
          const published = readTemplatePublication(deps.db, plan.planId);
          lease = checkpointTemplateExecutor(deps.db, { lease, now: deps.now(), phase: "settled", finish: true,
            errorCode: published ? "MEMORY_TEMPLATE_BINDING_UNAVAILABLE" : templateErrorCode(cause, "MEMORY_TEMPLATE_OUTCOME_UNKNOWN") });
        } catch { /* Lost or quarantined executors have no authority to rewrite their checkpoint or hold. */ }
      } finally {
        clearTimers();
        if (running.get(plan.planId) === entry) running.delete(plan.planId);
      }
    },
  };
}

/** Abort revokes the timers immediately, independently of a hung transport's eventual settlement. */
function executionTimers(input: { signal: AbortSignal; timeoutMs: number; abort(): void; renew(): void }): () => void {
  const timer = setTimeout(input.abort, input.timeoutMs); timer.unref();
  const heartbeat = setInterval(() => {
    try { input.renew(); } catch { input.abort(); }
  }, TEMPLATE_EXECUTOR_HEARTBEAT_MS); heartbeat.unref();
  const clear = () => { clearInterval(heartbeat); clearTimeout(timer); input.signal.removeEventListener("abort", clear); };
  input.signal.addEventListener("abort", clear, { once: true });
  if (input.signal.aborted) clear();
  return clear;
}

async function bindPublishedTemplate(deps: TemplateExecutionDependencies, input: {
  plan: TemplatePlan; publication: TemplatePublication; lease(): TemplateExecutorLease; signal: AbortSignal;
}): Promise<void> {
  assertPublished(deps, { ...input, lease: input.lease() });
  if (deps.runtime.boundSelectionIdentity() !== input.publication.selectionIdentity) {
    await boundedTemplateWork(input.signal, deps.runtime.replaceBinding(input.plan.guard.epochId));
  }
  // The existing heartbeat may renew while replacement waits; read the same owner's current checkpoint.
  assertPublished(deps, { ...input, lease: input.lease() });
  if (deps.runtime.boundSelectionIdentity() !== input.publication.selectionIdentity) throw new Error("MEMORY_TEMPLATE_BINDING_UNAVAILABLE");
}

function executionContext(deps: TemplateExecutionDependencies, input: {
  plan: TemplatePlan; lease(): TemplateExecutorLease; signal: AbortSignal; checkpoint(phase: TemplateExecutor["phase"]): void;
  timeoutMs: number; client: TemplateRolloutContext["client"];
}): TemplateRolloutContext {
  const assertExecutor = () => { input.signal.throwIfAborted(); assertTemplateExecutor(deps.db, { lease: input.lease(), now: deps.now() }); };
  const assertCurrent = (publication?: TemplatePublication) => {
    assertExecutor(); assertTemplateLocalPlan(deps, { plan: input.plan, publication });
    assertExecutor();
  };
  return { db: deps.db, plan: input.plan, client: input.client, signal: input.signal, runtime: deps.runtime, lease: input.lease,
    now: deps.now, checkpoint: input.checkpoint, assertCurrent, assertExecutor,
    request: () => { assertCurrent(); return { signal: input.signal, timeoutMs: input.timeoutMs }; } };
}

function assertPublished(deps: TemplateExecutionDependencies, input: {
  plan: TemplatePlan; publication: TemplatePublication; lease: TemplateExecutorLease; signal: AbortSignal;
}): void {
  input.signal.throwIfAborted(); assertTemplateExecutor(deps.db, { lease: input.lease, now: deps.now() });
  const selected = deps.verifySelectedAuthority?.() ?? readMemoryAuthoritySelection(deps.db);
  if (selected.mode !== "hindsight" || selected.epochId !== input.plan.guard.epochId
    || activeTemplateHold(deps.db, selected.epochId) || readTemplateSelectionIdentity(deps.db, selected.epochId) !== input.publication.selectionIdentity) {
    throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
  }
}
