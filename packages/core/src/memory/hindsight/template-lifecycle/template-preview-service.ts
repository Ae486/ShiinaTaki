/**
 * INPUT:  live Core guards, authenticated client factory, operator intentions and the service stop signal
 * OUTPUT: short-lived genuine plans and bounded review projections guarded from before the first Native await
 * POS:    template preview cache — no SQLite writes, no enrollment side effect and no caller-supplied snapshot trust
 */
import { randomUUID } from "node:crypto";
import { HINDSIGHT_TEMPLATE_MAX_BYTES, MEMORY_TEMPLATE_DETAIL_MAX_BYTES, MemoryTemplateDetailSchema, MemoryTemplatePreviewParamsSchema,
  type HindsightConnectionProjection, type MemoryTemplatePreviewParams, type MemoryTemplatePreview, type MemoryTemplateDetail } from "@taki/shared";
import type { HindsightClient } from "../hindsight-client.ts";
import { requireHindsightTemplateCapability } from "../hindsight-template-capability.ts";
import { readHindsightLiveProjection } from "../hindsight-runtime-connection.ts";
import { activeTemplateHold, templatePlanHash } from "./template-execution-reads.ts";
import { templateErrorCode } from "./template-errors.ts";
import { templateEqual, templateHash } from "./template-integrity.ts";
import { buildTemplatePlanBank } from "./template-plan-builder.ts";
import { captureTemplateLocalGuard, captureTemplatePlanGuard, type TemplateGuardDependencies } from "./template-plan-guard.ts";
import { TemplatePreviewPlanSchema, type TemplatePreviewPlan } from "./template-plan-schema.ts";
import { TemplatePreviewConflict } from "./template-preview-conflict.ts";
import { templateDefaultCatalogs } from "./template-default-catalogs.ts";
import { boundedTemplateWork } from "./template-rollout.ts";

export const TEMPLATE_PREVIEW_TTL_MS = 300_000;
const MAX_CACHED_PLANS = 4;
export interface TemplatePreviewDependencies extends TemplateGuardDependencies {
  client(projection: HindsightConnectionProjection): HindsightClient; bootId: string; now(): string;
}
export function createTemplatePreviewService(deps: TemplatePreviewDependencies, stopSignal?: AbortSignal) {
  const cached = new Map<string, TemplatePreviewPlan>();
  const resolve = (id: string, hash: string): TemplatePreviewPlan => {
    const plan = cached.get(id);
    if (!plan || plan.bootId !== deps.bootId || Date.parse(plan.expiresAt) <= Date.parse(deps.now())) throw new Error("MEMORY_TEMPLATE_PREVIEW_EXPIRED");
    if (templatePlanHash(plan) !== hash) throw new Error("MEMORY_TEMPLATE_CONFLICT");
    return structuredClone(plan);
  };
  return {
    resolve,
    preview: async (params: MemoryTemplatePreviewParams): Promise<MemoryTemplatePreview> => {
      try {
        const plan = await buildPreview(deps, MemoryTemplatePreviewParamsSchema.parse(params), stopSignal);
        while (cached.size >= MAX_CACHED_PLANS) cached.delete(cached.keys().next().value!);
        cached.set(plan.planId, plan);
        return { state: "ready", previewId: plan.planId, previewHash: templatePlanHash(plan), expiresAt: plan.expiresAt,
          changesDefaults: plan.params.target.kind === "defaults", banks: plan.banks.map((bank) => bank.summary) };
      } catch (cause) { return { state: "refused", reason: templateErrorCode(cause),
        bankId: cause instanceof TemplatePreviewConflict ? cause.snapshot.target.bank_id : params.target.kind === "bank" ? params.target.bankId : null,
        review: cause instanceof TemplatePreviewConflict ? cause.snapshot : null }; }
    },
    detail: (input: { previewId: string; previewHash: string; bankId: string }): MemoryTemplateDetail => {
      const plan = resolve(input.previewId, input.previewHash);
      const bank = plan.banks.find((entry) => entry.identity.target.bank_id === input.bankId);
      if (!bank) throw new Error("MEMORY_TEMPLATE_CONFLICT");
      const detail = MemoryTemplateDetailSchema.parse({ previewId: input.previewId, previewHash: input.previewHash,
        bank: bank.summary, before: bank.preview.request.expected_snapshot, changes: bank.preview.request.changes,
        deletions: bank.preview.consequences.deletions, refresh: bank.preview.request.refresh.map((child) => ({ modelId: child.model_id, childId: child.child_id })) });
      if (new TextEncoder().encode(JSON.stringify(detail)).byteLength > MEMORY_TEMPLATE_DETAIL_MAX_BYTES) throw new Error("MEMORY_TEMPLATE_TOO_LARGE");
      return detail;
    },
  };
}

async function buildPreview(deps: TemplatePreviewDependencies, params: MemoryTemplatePreviewParams, stopSignal?: AbortSignal): Promise<TemplatePreviewPlan> {
  stopSignal?.throwIfAborted();
  templateDefaultCatalogs(deps.db, params.target);
  const live = readHindsightLiveProjection(deps);
  if (live.state !== "ready") throw new Error("MEMORY_TEMPLATE_UNSUPPORTED");
  const client = deps.client(live.projection);
  const deadline = AbortSignal.timeout(Math.min(live.projection.setupTimeoutMs, TEMPLATE_PREVIEW_TTL_MS));
  const context = { timeoutMs: live.projection.requestTimeoutMs, signal: stopSignal ? AbortSignal.any([stopSignal, deadline]) : deadline };
  const before = captureTemplateLocalGuard(deps);
  const manifest = await boundedTemplateWork(context.signal, client.compatibility(context), "MEMORY_TEMPLATE_NATIVE_REFUSED");
  context.signal.throwIfAborted();
  requireHindsightTemplateCapability(manifest);
  const guard = captureTemplatePlanGuard(deps, templateHash("definition", manifest));
  if (!templateEqual(guard, { ...before, manifestHash: guard.manifestHash })
    || manifest.provider.lineage !== guard.providerLineage) throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
  if (activeTemplateHold(deps.db, guard.epochId)) throw new Error("MEMORY_TEMPLATE_HOLD");
  const request = () => {
    context.signal.throwIfAborted();
    if (!templateEqual(captureTemplatePlanGuard(deps, guard.manifestHash), guard)) throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
    if (activeTemplateHold(deps.db, guard.epochId)) throw new Error("MEMORY_TEMPLATE_HOLD");
    return context;
  };
  const target = params.target;
  const targets = target.kind === "bank" ? guard.banks.filter((bank) => bank.identity.target.bank_id === target.bankId) : guard.banks;
  if (!targets.length || [...params.directives, ...params.refresh].some((option) => !targets.some((bank) => bank.identity.target.bank_id === option.bankId))) {
    throw new Error("MEMORY_TEMPLATE_CONFLICT");
  }
  const banks = [];
  for (const bank of targets) banks.push(await boundedTemplateWork(context.signal,
    buildTemplatePlanBank({ db: deps.db, client, request, bank, params }), "MEMORY_TEMPLATE_NATIVE_REFUSED"));
  request();
  const createdAt = deps.now();
  const plan = TemplatePreviewPlanSchema.parse({ planId: randomUUID(), bootId: deps.bootId, params, guard, banks,
    createdAt, expiresAt: new Date(Date.parse(createdAt) + TEMPLATE_PREVIEW_TTL_MS).toISOString() });
  if (new TextEncoder().encode(JSON.stringify(plan)).byteLength > HINDSIGHT_TEMPLATE_MAX_BYTES * 256) throw new Error("MEMORY_TEMPLATE_TOO_LARGE");
  return plan;
}
