/**
 * INPUT:  replay pressure, captured Timeline/Summary state, optional Legacy flush, Utility Slot, and durable operation repo
 * OUTPUT: fenced, CAS-protected summary replacement with presentation-independent canonical source identity
 * POS:    core/agents — detached Slice 3 compaction lifecycle; one operation per Character, never a Run/Timeline authority
 */
import { createHash, randomUUID } from "node:crypto";
import { generateText } from "ai";
import { withMaintenanceUsageOwner } from "../observability/model-usage-context.ts";
import type { TimelineEntry } from "@taki/shared";
import type {
  CompactionFailureCode,
  CompactionLease,
  CompactionOperationRepo,
} from "../db/compaction-operation-repo.ts";
import type { SummaryRepo } from "../db/summary-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { AutoMemoryCompact } from "../memory/auto-memory.ts";
import type { MemoryFlushOutcome, MemoryFlushPort } from "../memory/memory-flush-port.ts";
import { renderSafeTranscript, sanitizeCompactionText } from "./context-reduction.ts";
import type { UtilitySlot } from "../memory/utility-slot.ts";
import { COMPACTION_RETAIN_RATIO, selectRetirementRange } from "./retirement-selector.ts";
import { loadReplaySource } from "./replay-source-loader.ts";
import type { RequestMeasurement } from "./request-measurement.ts";
import { evaluateSummaryQuality, isCharacterCooldownElapsed } from "./compaction-policy.ts";
import type { SummaryQualityResult } from "./summary-quality.ts";

// The established migration runner uses the same ten-minute lease for model-backed offline work. A pass that outlives this bound loses its fence.
const COMPACTION_LEASE_MS = 600_000;

export interface CompactionView {
  estimatedTokens(characterId: string): number;
  budget(): number;
  /** Complete projected-input measurement for Slice 4; omitted callers use legacy history-only compatibility. */
  measureRequest?(characterId: string): RequestMeasurement | undefined;
  effectiveWindowTokens?(): number;
}

/** Counts/ids/codes only. Summary text, prompts, provider exceptions, and payloads never cross this seam. */
export interface CompactionLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface CompactionCoordinatorDeps {
  view: CompactionView;
  timeline: TimelineRepo;
  summaries: SummaryRepo;
  operations: CompactionOperationRepo;
  /** Only Legacy requires extraction before summary replacement; the selected port is captured per operation. */
  legacyFlush?: () => MemoryFlushPort | undefined;
  slot: UtilitySlot;
  config: {
    triggerRatio: number;
    keepMessages: number;
    summaryQuality?: boolean;
    retryBudget?: number;
    retryCooldownMs?: number;
  };
  logger: CompactionLogger;
  buildPrompt(previousSummary: string | null, retiringSpan: string, at: number | Date): string;
  now?: () => Date;
  owner?: string;
  leaseMs?: number;
  validateSummary?: (input: {
    text: string;
    sourceText: string;
    finishReason?: string;
    protectedContent?: string[];
  }) => SummaryQualityResult;
  protectedContent?: () => string[];
}

export interface CompactionCorrelation {
  runId?: string;
  attemptId?: string;
}

export interface CompactionCoordinator extends AutoMemoryCompact {
  maybeRun(characterId: string, correlation?: CompactionCorrelation): Promise<void>;
  cancel(characterId: string): boolean;
  reconcile(): number;
}

interface CapturedCompaction {
  characterId: string;
  oldThrough: number;
  newThrough: number;
  expectedSummaryRevision: number;
  previousSummary: string | null;
  capturedTailSeq: number;
  sourceDigest: string;
  span: TimelineEntry[];
  before: number;
}

interface ActiveController {
  operationId: string;
  fence: number;
  controller: AbortController;
}

export function createCompactionCoordinator(deps: CompactionCoordinatorDeps): CompactionCoordinator {
  const now = deps.now ?? (() => new Date());
  const owner = deps.owner ?? randomUUID();
  const leaseMs = deps.leaseMs ?? COMPACTION_LEASE_MS;
  const controllers = new Map<string, ActiveController>();
  deps.operations.reconcileExpired(now().toISOString());

  async function maybeRun(characterId: string, correlation: CompactionCorrelation = {}): Promise<void> {
    let lease: CompactionLease | null = null;
    try {
      const captured = capture({ deps, characterId });
      if (!captured) return;
      const operationId = operationIdOf(captured);
      deps.operations.reconcileExpired(now().toISOString());
      const attemptAt = now();
      if (!attemptAllowed({ deps, characterId, operationId, at: attemptAt })) return;
      const legacyFlush = deps.legacyFlush?.();
      const startedAt = now();
      const route = modelRoute(deps.slot.model);
      const begun = deps.operations.begin({
        operationId, characterId, ...correlation, reason: "pressure",
        selectedFromSeq: captured.oldThrough + 1, selectedThroughSeq: captured.newThrough,
        capturedTailSeq: captured.capturedTailSeq, expectedSummaryRevision: captured.expectedSummaryRevision,
        expectedSummaryThrough: captured.oldThrough, sourceDigest: captured.sourceDigest, beforeTokens: captured.before,
        provider: route.provider, modelId: route.modelId, owner,
        now: startedAt.toISOString(), expiresAt: future(startedAt, leaseMs),
      });
      if (begun.status !== "started") return;
      lease = begun.lease;
      const controller = new AbortController();
      controllers.set(characterId, { operationId, fence: lease.fence, controller });
      await execute({ deps, captured, lease, controller, now, leaseMs, legacyFlush });
    } catch {
      if (lease) deps.operations.fail({ lease, code: "COMPACTION_INTERNAL_ERROR", now: now().toISOString() });
      deps.logger.warn({ characterId, code: "COMPACTION_INTERNAL_ERROR" }, "compaction pass failed; will retry");
    } finally {
      const active = controllers.get(characterId);
      if (active && active.operationId === lease?.operationId && active.fence === lease.fence) controllers.delete(characterId);
    }
  }

  function cancel(characterId: string): boolean {
    const cancelled = deps.operations.cancelActive({ characterId, now: now().toISOString() });
    if (!cancelled) return false;
    const active = controllers.get(characterId);
    if (active?.operationId === cancelled.operationId) active.controller.abort("COMPACTION_CANCELLED");
    return true;
  }

  return { maybeRun, cancel, reconcile: () => deps.operations.reconcileExpired(now().toISOString()) };
}

async function execute(input: {
  deps: CompactionCoordinatorDeps; captured: CapturedCompaction; lease: CompactionLease;
  controller: AbortController; now: () => Date; leaseMs: number; legacyFlush?: MemoryFlushPort;
}): Promise<void> {
  const { deps, captured, controller, now, leaseMs } = input;
  let lease = input.lease;
  if (input.legacyFlush) {
    const flushed = await flushRetiringSpan(deps, { captured, lease, now, port: input.legacyFlush });
    if (!flushed || controller.signal.aborted) return;
    const renewedAt = now();
    const renewed = deps.operations.recordFlush({ lease, status: flushed.status, writes: flushed.writes,
      now: renewedAt.toISOString(), expiresAt: future(renewedAt, leaseMs) });
    if (!renewed) return;
    lease = renewed;
  }
  if (controller.signal.aborted) return;

  const previousSummary = captured.previousSummary === null ? null : sanitizeCompactionText(captured.previousSummary);
  const prompt = deps.buildPrompt(previousSummary, renderSafeTranscript(captured.span), now());
  let dispatchSkipped = false;
  const result = await deps.slot.run("compact", () => {
    if (controller.signal.aborted) return Promise.resolve(undefined);
    const dispatchAt = now();
    const renewed = deps.operations.renewLease({ lease, now: dispatchAt.toISOString(), expiresAt: future(dispatchAt, leaseMs) });
    if (!renewed) {
      dispatchSkipped = true;
      deps.operations.reconcileExpired(dispatchAt.toISOString());
      return Promise.resolve(undefined);
    }
    lease = renewed;
    return withMaintenanceUsageOwner({ kind: "compact", operationId: lease.operationId, characterId: lease.characterId },
      () => generateText({ model: deps.slot.model, prompt, abortSignal: controller.signal }));
  });
  if (controller.signal.aborted || dispatchSkipped) return;
  if (result === undefined) {
    failSummary(deps, { lease, code: "SUMMARY_GENERATION_FAILED", captured, now });
    return;
  }
  settleSummary({ deps, captured, lease, result, now });
}

function settleSummary(input: {
  deps: CompactionCoordinatorDeps;
  captured: CapturedCompaction;
  lease: CompactionLease;
  result: { text: string; finishReason?: string };
  now: () => Date;
}): void {
  const { deps, captured, lease, result, now } = input;
  const quality = evaluateSummaryQuality({
    text: result.text,
    finishReason: result.finishReason,
    span: captured.span,
    previousSummary: captured.previousSummary,
    protectedContent: deps.protectedContent?.(),
    strict: deps.config.summaryQuality ?? deps.view.measureRequest !== undefined,
    validate: deps.validateSummary,
  });
  if (!quality.accepted) {
    const code = quality.code === "blank" ? "SUMMARY_EMPTY" : "SUMMARY_GENERATION_FAILED";
    failSummary(deps, { lease, code, captured, now });
    return;
  }
  if (!deps.operations.recordSummaryGenerated({ lease, outputChars: result.text.length, now: now().toISOString() })) return;
  const currentDigest = sourceDigest(deps.timeline.rangeAscending(captured.characterId, captured.oldThrough, captured.newThrough));
  if (currentDigest !== captured.sourceDigest) {
    deps.operations.fail({ lease, code: "SOURCE_STALE", now: now().toISOString() });
    deps.logger.warn({ characterId: captured.characterId, throughSeq: captured.newThrough, code: "SOURCE_STALE" },
      "compaction source changed; generated summary discarded");
    return;
  }
  const committed = deps.operations.commitSummary({ lease, text: result.text, sourceDigest: captured.sourceDigest,
    now: now().toISOString() });
  if (committed !== "committed") {
    if (committed !== "duplicate") deps.logger.warn({ characterId: captured.characterId, throughSeq: captured.newThrough,
      code: committed === "conflict" ? "SUMMARY_CONFLICT" : "COMPACTION_LEASE_LOST" },
    "compaction commit rejected; generated summary discarded");
    return;
  }
  deps.logger.info({ characterId: captured.characterId, throughSeq: captured.newThrough, before: captured.before,
    after: deps.view.estimatedTokens(captured.characterId) }, "conversation compacted");
}

function capture(input: { deps: CompactionCoordinatorDeps; characterId: string }): CapturedCompaction | null {
  const { deps, characterId } = input;
  const before = deps.view.estimatedTokens(characterId);
  const wall = deps.view.budget();
  const measured = deps.view.measureRequest?.(characterId);
  const effective = deps.view.effectiveWindowTokens?.() ?? wall;
  const pressure = measured?.projectedInputTokens ?? before;
  const threshold = effective * deps.config.triggerRatio;
  const atBoundary = measured !== undefined ? pressure >= threshold : pressure > threshold;
  if (!Number.isFinite(pressure) || pressure < 0 || !Number.isFinite(effective) || !Number.isFinite(wall) || !atBoundary) return null;
  const checkpoint = deps.summaries.getCheckpoint(characterId);
  const oldThrough = checkpoint?.throughSeq ?? 0;
  const retainTokens = Math.floor(wall * COMPACTION_RETAIN_RATIO);
  const source = loadReplaySource({ repo: deps.timeline, characterId, throughSeq: oldThrough,
    candidateBudget: retainTokens, minimumRows: deps.config.keepMessages + 1 });
  if (source.backstopHit) {
    deps.logger.warn({ characterId, loadedRows: source.loadedRows, oldestLoadedSeq: source.oldestLoadedSeq },
      "retirement source backstop reached; compaction deferred");
    return null;
  }
  const selection = selectRetirementRange(source.entries, retainTokens, deps.config.keepMessages);
  if (!selection || selection.newThroughSeq <= oldThrough) return null;
  const span = deps.timeline.rangeAscending(characterId, oldThrough, selection.newThroughSeq);
  if (span.length === 0) return null;
  return { characterId, oldThrough, newThrough: selection.newThroughSeq,
    expectedSummaryRevision: checkpoint?.revision ?? 0, previousSummary: checkpoint?.text ?? null,
    capturedTailSeq: deps.timeline.latestSeq(characterId), sourceDigest: sourceDigest(span), span,
    before: Math.floor(measured?.projectedInputTokens ?? before) };
}

function retryAllowed(deps: CompactionCoordinatorDeps, operationId: string, now: Date): boolean {
  const operation = deps.operations.get(operationId);
  if (!operation) return true;
  if (operation.state === "committed") return false;
  if (operation.state === "open") return false;
  if (operation.state === "cancelled" && operation.failureCode === null) return true;
  const budget = deps.config.retryBudget ?? (deps.config.summaryQuality ? 3 : Number.MAX_SAFE_INTEGER);
  if (operation.attemptNo >= budget) return false;
  const cooldown = Math.max(0, deps.config.retryCooldownMs ?? (deps.config.summaryQuality ? 30_000 : 0));
  if (cooldown === 0) return true;
  const terminalMs = Date.parse(operation.terminalAt ?? operation.updatedAt);
  return !Number.isFinite(terminalMs) || now.getTime() >= terminalMs + cooldown;
}

function attemptAllowed(input: {
  deps: CompactionCoordinatorDeps;
  characterId: string;
  operationId: string;
  at: Date;
}): boolean {
  const cooldownMs = Math.max(0, input.deps.config.retryCooldownMs
    ?? (input.deps.config.summaryQuality ? 30_000 : 0));
  return isCharacterCooldownElapsed({
    latestFailure: input.deps.operations.latestFailure(input.characterId),
    operationId: input.operationId,
    now: input.at,
    cooldownMs,
  }) && retryAllowed(input.deps, input.operationId, input.at);
}

async function flushRetiringSpan(
  deps: CompactionCoordinatorDeps,
  input: { captured: CapturedCompaction; lease: CompactionLease; now: () => Date; port: MemoryFlushPort },
): Promise<{ status: "success" | "not_required"; writes: number } | null> {
  const { captured, lease, now } = input;
  let outcome: MemoryFlushOutcome;
  try {
    outcome = await input.port.prepareRetirement({ characterId: captured.characterId,
      fromSeq: captured.oldThrough + 1, throughSeq: captured.newThrough, operationId: lease.operationId });
  } catch {
    outcome = { status: "retryable_failure", code: "MEMORY_FLUSH_FAILED" };
  }
  if (outcome.status === "not_required") return { status: "not_required", writes: 0 };
  if (outcome.status === "success" && Number.isInteger(outcome.throughSeq) && outcome.throughSeq >= captured.newThrough) {
    return { status: "success", writes: Math.max(0, Math.floor(outcome.writes)) };
  }
  const failure = outcome.status === "success"
    ? { status: "retryable_failure" as const, code: "MEMORY_FLUSH_INCOMPLETE" as const }
    : outcome;
  deps.operations.fail({ lease, code: failure.code, now: now().toISOString() });
  deps.logger.warn({ characterId: captured.characterId, throughSeq: captured.newThrough,
    status: failure.status, code: failure.code }, "pre-retire memory flush unavailable; compaction deferred");
  return null;
}

function failSummary(
  deps: CompactionCoordinatorDeps,
  input: {
    lease: CompactionLease;
    code: Extract<CompactionFailureCode, "SUMMARY_GENERATION_FAILED" | "SUMMARY_EMPTY">;
    captured: CapturedCompaction;
    now: () => Date;
  },
): void {
  const { lease, code, captured, now } = input;
  deps.operations.fail({ lease, code, now: now().toISOString() });
  deps.logger.warn({ characterId: captured.characterId, through: captured.newThrough, code },
    "summary generation failed; will retry");
}

function sourceDigest(entries: TimelineEntry[]): string {
  const hash = createHash("sha256");
  hash.update("taki/conversation-compaction-source/v1\0");
  for (const entry of entries) hash.update(JSON.stringify({ seq: entry.seq, id: entry.id, role: entry.role,
    content: entry.content, parts: canonicalSourceParts(entry.parts) ?? null, createdAt: entry.createdAt,
    ...(entry.sourceContext ? { sourceContext: entry.sourceContext } : {}) })).update("\0");
  return hash.digest("hex");
}

function canonicalSourceParts(parts: TimelineEntry["parts"]): TimelineEntry["parts"] {
  return parts?.map((part) => {
    if (part.type !== "tool-call" && part.type !== "tool-result") return part;
    // UI labels cannot change retry/source identity. Preserve every other field and its legacy serialization order.
    const canonical = { ...part };
    delete canonical.displayName;
    return canonical;
  });
}

function operationIdOf(captured: CapturedCompaction): string {
  const digest = createHash("sha256").update(JSON.stringify({ characterId: captured.characterId,
    oldThrough: captured.oldThrough, newThrough: captured.newThrough, revision: captured.expectedSummaryRevision,
    sourceDigest: captured.sourceDigest })).digest("hex");
  return `compact:${digest}`;
}

function bounded(value: string, max: number): string {
  const normalized = value.trim();
  return (normalized.length === 0 ? "unknown" : normalized).slice(0, max);
}

function modelRoute(model: UtilitySlot["model"]): { provider: string; modelId: string } {
  if (typeof model === "string") return { provider: "registry", modelId: bounded(model, 200) };
  return { provider: bounded(model.provider, 100), modelId: bounded(model.modelId, 200) };
}

function future(now: Date, ms: number): string {
  return new Date(now.getTime() + ms).toISOString();
}
