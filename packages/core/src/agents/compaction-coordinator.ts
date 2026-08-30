/**
 * INPUT:  replay pressure, captured Timeline/Summary state, MemoryFlushPort, Utility Slot, and durable operation repo
 * OUTPUT: restart-reconciled maybeRun/cancel coordinator with fenced, CAS-protected summary replacement
 * POS:    core/agents — detached Slice 3 compaction lifecycle; one operation per Character, never a Run/Timeline authority
 */
import { createHash, randomUUID } from "node:crypto";
import { generateText } from "ai";
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
import { renderTranscript } from "../memory/render-transcript.ts";
import type { UtilitySlot } from "../memory/utility-slot.ts";
import { COMPACTION_RETAIN_RATIO, selectRetirementRange } from "./retirement-selector.ts";
import { loadReplaySource } from "./replay-source-loader.ts";

// The established migration runner uses the same ten-minute lease for model-backed offline work. A pass that outlives
// this bound loses its fence and cannot commit; Slice 4 may add policy-driven retry/cooldown without changing that truth.
const COMPACTION_LEASE_MS = 600_000;

export interface CompactionView {
  estimatedTokens(characterId: string): number;
  budget(): number;
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
  flush: MemoryFlushPort;
  slot: UtilitySlot;
  config: { triggerRatio: number; keepMessages: number };
  logger: CompactionLogger;
  buildPrompt(previousSummary: string | null, retiringSpan: string, at: number | Date): string;
  now?: () => Date;
  owner?: string;
  leaseMs?: number;
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
      const captured = capture(deps, characterId);
      if (!captured) return;
      const startedAt = now();
      const operationId = operationIdOf(captured);
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
      await execute({ deps, captured, lease, controller, now, leaseMs });
    } catch {
      if (lease) deps.operations.fail({ lease, code: "COMPACTION_INTERNAL_ERROR", now: now().toISOString() });
      deps.logger.warn({ characterId, code: "COMPACTION_INTERNAL_ERROR" }, "compaction pass failed; will retry");
    } finally {
      const active = controllers.get(characterId);
      if (active && active.operationId === lease?.operationId && active.fence === lease.fence) {
        controllers.delete(characterId);
      }
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
  controller: AbortController; now: () => Date; leaseMs: number;
}): Promise<void> {
  const { deps, captured, controller, now, leaseMs } = input;
  const flushed = await flushRetiringSpan(deps, { captured, lease: input.lease, now });
  if (!flushed || controller.signal.aborted) return;
  const renewedAt = now();
  const lease = deps.operations.recordFlush({ lease: input.lease, status: flushed.status, writes: flushed.writes,
    now: renewedAt.toISOString(), expiresAt: future(renewedAt, leaseMs) });
  if (!lease || controller.signal.aborted) return;

  const prompt = deps.buildPrompt(captured.previousSummary, renderTranscript(captured.span), now());
  const result = await deps.slot.run("compact", () => generateText({ model: deps.slot.model, prompt, abortSignal: controller.signal }));
  if (controller.signal.aborted) return;
  if (result === undefined) {
    failSummary(deps, { lease, code: "SUMMARY_GENERATION_FAILED", captured, now }); return;
  }
  if (result.text.trim().length === 0) {
    failSummary(deps, { lease, code: "SUMMARY_EMPTY", captured, now }); return;
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

function capture(deps: CompactionCoordinatorDeps, characterId: string): CapturedCompaction | null {
  const before = deps.view.estimatedTokens(characterId);
  const wall = deps.view.budget();
  // Slice 3 preserves the shipped history-wall trigger exactly. Slice 4 owns complete-envelope pressure and >= 0.8.
  if (!Number.isFinite(before) || before < 0 || !Number.isFinite(wall)
    || before <= wall * deps.config.triggerRatio) return null;
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
    capturedTailSeq: deps.timeline.latestSeq(characterId), sourceDigest: sourceDigest(span), span, before: Math.floor(before) };
}

async function flushRetiringSpan(
  deps: CompactionCoordinatorDeps,
  input: { captured: CapturedCompaction; lease: CompactionLease; now: () => Date },
): Promise<{ status: "success" | "not_required"; writes: number } | null> {
  const { captured, lease, now } = input;
  let outcome: MemoryFlushOutcome;
  try {
    outcome = await deps.flush.prepareRetirement({ characterId: captured.characterId,
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
    content: entry.content, parts: entry.parts ?? null, createdAt: entry.createdAt })).update("\0");
  return hash.digest("hex");
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
