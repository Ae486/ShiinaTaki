/**
 * INPUT:  original fixed Bank plan, current executor guards and controlled runtime drain/synchronization
 * OUTPUT: original-request Native recovery followed by one all-Bank Core publication
 * POS:    template effect driver — partial commits keep their hold; published plans never enter this driver again
 */
import { randomUUID } from "node:crypto";
import type { MemoryTemplateErrorCode } from "@taki/shared";
import type { HindsightCallContext, HindsightClient } from "../hindsight-client.ts";
import type { Database } from "../../../db/sqlite.ts";
import { requireHindsightTemplateCapability } from "../hindsight-template-capability.ts";
import { templateHash } from "./template-integrity.ts";
import { templateIdentityKey } from "./template-store-documents.ts";
import { recordTemplateBankReceipt, recordTemplateDispatch, recordTemplateObservation, readTemplateBankReceipt } from "./template-native-evidence-store.ts";
import { publishTemplatePlan } from "./template-publication.ts";
import type { TemplatePlan, TemplatePlanBank, TemplateObservation, TemplatePublication } from "./template-plan-schema.ts";
import type { TemplateExecutorLease, TemplateExecutor } from "./template-executor-store.ts";

export interface TemplateRuntimeCall {
  plan: TemplatePlan; signal: AbortSignal; assertCurrent(): void;
}
export interface TemplateRuntimeControl {
  quiesce(input: TemplateRuntimeCall): Promise<void>;
  synchronize(input: TemplateRuntimeCall & { bank: TemplatePlanBank }): Promise<void>;
  replaceBinding(epochId: string): Promise<void>;
  boundSelectionIdentity(): string | null;
}
export interface TemplateRolloutContext {
  db: Database; plan: TemplatePlan; client: HindsightClient; signal: AbortSignal; runtime: TemplateRuntimeControl;
  lease(): TemplateExecutorLease; now(): string; request(): HindsightCallContext;
  assertCurrent(publication?: TemplatePublication): void; assertExecutor(): void;
  checkpoint(phase: TemplateExecutor["phase"]): void;
}

export async function executeTemplateRollout(context: TemplateRolloutContext): Promise<TemplatePublication> {
  const { plan } = context;
  context.checkpoint("quiescing");
  await boundedTemplateWork(context.signal, context.runtime.quiesce({ plan, signal: context.signal, assertCurrent: () => context.assertCurrent() }));
  context.assertCurrent();
  await verifyManifest(context);
  context.checkpoint("applying");
  for (const bank of plan.banks) {
    await applyBank(context, bank);
    await boundedTemplateWork(context.signal, context.runtime.synchronize({ plan, bank, signal: context.signal, assertCurrent: () => context.assertCurrent() }));
    context.assertCurrent();
  }
  context.checkpoint("verifying");
  const observations: TemplateObservation[] = [];
  for (const bank of plan.banks) observations.push(await verifyBank(context, bank));
  const manifest = await verifyManifest(context);
  context.checkpoint("publishing");
  return publishTemplatePlan(context.db, { plan, observations, manifest, committedAt: context.now(),
    assertExecutor: context.assertExecutor, assertCurrent: (publication) => context.assertCurrent(publication ?? undefined) });
}

async function applyBank(context: TemplateRolloutContext, bank: TemplatePlanBank): Promise<void> {
  const client = context.client; const request = bank.preview.request;
  if (!client.templateResult || !client.templateApply) throw new Error("MEMORY_TEMPLATE_UNSUPPORTED");
  const original = await client.templateResult({ request: { contract_version: "1.0.0", target: request.target,
    request_id: request.request_id, request_hash: request.request_hash }, context: context.request() });
  context.assertCurrent();
  if (original.state === "committed") {
    recordTemplateBankReceipt(context.db, { lease: context.lease(), bank, receipt: original.receipt, now: context.now() });
    return;
  }
  if (readTemplateBankReceipt(context.db, { planId: context.plan.planId, bank })) throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID");
  // Persist before the transport is invoked. A timeout or synchronous throw cannot prove that no write was sent.
  recordTemplateDispatch(context.db, { lease: context.lease(), bank, now: context.now() });
  const receipt = await client.templateApply({ request, context: context.request() });
  context.assertCurrent();
  recordTemplateBankReceipt(context.db, { lease: context.lease(), bank, receipt, now: context.now() });
}

async function verifyBank(context: TemplateRolloutContext, bank: TemplatePlanBank): Promise<TemplateObservation> {
  const receipt = readTemplateBankReceipt(context.db, { planId: context.plan.planId, bank });
  if (!receipt || !context.client.templateSnapshot || !context.client.templateRefreshResult) throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID");
  const children = [];
  for (const child of receipt.children) {
    children.push(await context.client.templateRefreshResult({ request: { contract_version: "1.0.0", target: receipt.target,
      request_id: receipt.request_id, request_hash: receipt.request_hash, child_id: child.child_id }, context: context.request() }));
  }
  const snapshot = await context.client.templateSnapshot({ request: { contract_version: "1.0.0", target: receipt.target,
    selectors: bank.preview.request.expected_snapshot.selectors }, context: context.request() });
  context.assertCurrent();
  const value: TemplateObservation = { observationId: randomUUID(), planId: context.plan.planId, bankKey: templateIdentityKey(bank.identity),
    receipt, snapshot, children, verifiedAt: context.now() };
  recordTemplateObservation(context.db, { lease: context.lease(), bank, observation: value, now: context.now() });
  return value;
}

async function verifyManifest(context: TemplateRolloutContext) {
  const manifest = await context.client.compatibility(context.request());
  context.assertCurrent();
  requireHindsightTemplateCapability(manifest);
  if (templateHash("definition", manifest) !== context.plan.guard.manifestHash) throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
  return manifest;
}

/** Stop the owner promptly even when a runtime delegate ignores abort; late work retains guards and has no completion authority. */
export function boundedTemplateWork<T>(signal: AbortSignal, work: Promise<T>, interruptedCode: MemoryTemplateErrorCode = "MEMORY_TEMPLATE_OUTCOME_UNKNOWN"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error(interruptedCode));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void work.then((value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (cause: unknown) => { signal.removeEventListener("abort", abort); reject(cause); });
  });
}
