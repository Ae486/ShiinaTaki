/**
 * INPUT:  exact primary commits, Hindsight authority, durable source journal, retain port and one Utility Slot
 * OUTPUT: source-only ingestion with restart-safe gate/Bank coverage, pre-retirement flush and owned stop/drain
 * POS:    core/memory/hindsight — background source orchestration; native extraction and Pending replay stay provider-owned
 */
import { RetainRequestSchema, MemoryErrorCodeSchema, type MemoryReplicaBank } from "@taki/shared";
import { z } from "zod";
import type { MemoryConfig } from "../../config/memory-config.ts";
import type { CanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import type { HindsightIngestionRepo } from "../../db/hindsight-ingestion-repo.ts";
import type { TimelineRepo } from "../../db/timeline-repo.ts";
import type { PrimaryConversationSourceRepo } from "../../db/primary-conversation-source-repo.ts";
import { EPISODIC_EVERY_N } from "../auto-memory.ts";
import { createCanonicalIngestionModel, type CanonicalIngestionModel } from "../canonical-ingestion-model.ts";
import { sanitizeCommittedPrimarySpan, retainedIngestionSource, importRetainedPrimarySources, type PrimaryConversationCommit,
  type ProvenPrimaryEntry, type IngestionCoverageGap, type PrimarySourceImportResult } from "../canonical-ingestion-source.ts";
import type { MemoryFlushPort, MemoryFlushRequest } from "../memory-flush-port.ts";
import type { MemoryProvider } from "../memory-provider.ts";
import type { UtilitySlot } from "../utility-slot.ts";
import type { HindsightIngestionCoverage, HindsightIngestionState } from "./hindsight-ingestion-contract.ts";
import { assertHindsightIngestionAlive, createHindsightIngestionLifetime } from "./hindsight-ingestion-lifetime.ts";

export interface HindsightIngestionRunResult {
  throughSeq: number; eligibilityStartSeq: number; hasApplicableSource: boolean;
  /** Newly recorded durable source-Bank coverages in this run, never a native extracted-fact count. */
  writes: number;
  sources: number; confirmedSources: number; pendingSources: number; skippedSpans: number;
  coverageGap?: IngestionCoverageGap;
  sourceImport: PrimarySourceImportResult;
}
export interface HindsightIngestion {
  initializeBaseline(characterId: string): void;
  recordPrimaryCommitted(input: PrimaryConversationCommit): void;
  importPrimarySources(characterId: string): PrimarySourceImportResult;
  maybeRun(input: { characterId: string }): Promise<HindsightIngestionRunResult | null>;
  run(input: { characterId: string; throughSeq?: number }): Promise<HindsightIngestionRunResult>;
  stop(): Promise<void>;
  settle(): Promise<void>;
  readonly flushPort: MemoryFlushPort;
}
export interface HindsightIngestionDeps {
  authority: Pick<CanonicalMemoryAuthorityRepo, "authorityEpoch">; journal: HindsightIngestionRepo;
  timeline: Pick<TimelineRepo, "latestSeq">; slot: UtilitySlot; provider: Pick<MemoryProvider, "retain">;
  resolveBanks(characterId: string): readonly MemoryReplicaBank[];
  config?: MemoryConfig; now?: () => string;
  primarySources?: PrimaryConversationSourceRepo;
}
interface Context extends HindsightIngestionDeps {
  epochId: string; providerLineageId: string; model: Pick<CanonicalIngestionModel, "gate">; signal: AbortSignal;
}

export function createHindsightIngestion(deps: HindsightIngestionDeps): HindsightIngestion {
  const epoch = deps.authority.authorityEpoch();
  if (epoch.providerId !== "hindsight") throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const lifetime = createHindsightIngestionLifetime(deps.slot);
  const ctx: Context = { ...deps, epochId: epoch.epochId, providerLineageId: epoch.providerLineageId,
    signal: lifetime.signal, provider: { retain: deps.provider.retain.bind(deps.provider) },
    model: createCanonicalIngestionModel(lifetime.slot) };
  const run: HindsightIngestion["run"] = (input) => {
    const captured = { ...input }; return lifetime.enqueue(captured.characterId, () => runRange(ctx, captured));
  };
  return { run, stop: lifetime.stop, settle: lifetime.settle,
    importPrimarySources: (characterId) => importPrimarySources(ctx, characterId),
    flushPort: { prepareRetirement: (request) => flush(ctx, run, request) },
    maybeRun: ({ characterId }) => lifetime.enqueue(characterId, () => {
      assertAuthority(ctx);
      const sourceImport = importPrimarySources(ctx, characterId);
      const scope = { epochId: ctx.epochId, characterId };
      return ctx.journal.pending(scope) || ctx.journal.unprocessedCount(scope) >= EPISODIC_EVERY_N
        ? runRange(ctx, { characterId }, sourceImport) : Promise.resolve(null);
    }),
    initializeBaseline: (characterId) => {
      assertAuthority(ctx);
      ctx.journal.initializeBaseline({ epochId: ctx.epochId, characterId, throughSeq: deps.timeline.latestSeq(characterId), now: now(ctx) });
    },
    recordPrimaryCommitted: (input) => {
      assertAuthority(ctx); ctx.journal.recordPrimaryCommitted({ ...input, epochId: ctx.epochId, now: now(ctx) });
    } };
}

async function runRange(ctx: Context, input: { characterId: string; throughSeq?: number }, imported?: PrimarySourceImportResult): Promise<HindsightIngestionRunResult> {
  try {
    assertAuthority(ctx);
    const sourceImport = imported ?? importPrimarySources(ctx, input.characterId);
    const scope = { epochId: ctx.epochId, characterId: input.characterId };
    const eligibilityStartSeq = ctx.journal.eligibilityStartSeq(scope);
    if (eligibilityStartSeq === undefined) throw new Error("MEMORY_INGESTION_BASELINE_MISSING");
    const requested = input.throughSeq ?? Math.max(ctx.journal.cursor(scope), ctx.journal.latestPrimarySeq(scope));
    if (!Number.isSafeInteger(requested) || requested < 0) throw new Error("MEMORY_INVALID_REQUEST");
    const target = Math.min(requested, ctx.timeline.latestSeq(input.characterId));
    const totals = await drain(ctx, { characterId: input.characterId, target, forcePending: input.throughSeq === undefined });
    assertAuthority(ctx);
    const hasApplicableSource = ctx.journal.hasApplicableSource({ ...scope, throughSeq: target });
    const throughSeq = ctx.journal.advanceCoverage({ ...scope, throughSeq: target, now: now(ctx) });
    return { ...totals, sourceImport, throughSeq, eligibilityStartSeq, hasApplicableSource,
      coverageGap: ctx.journal.coverageGap({ ...scope, throughSeq: target }) };
  } catch (error) {
    assertHindsightIngestionAlive(ctx.signal);
    // Model, schema and transport messages may contain private source text. Only closed codes leave this boundary.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(failureCode(error));
  }
}

function importPrimarySources(ctx: Context, characterId: string): PrimarySourceImportResult {
  assertAuthority(ctx);
  if (!ctx.primarySources) return { imported: 0, unresolvedSourceIds: [] };
  return importRetainedPrimarySources({ sources: ctx.primarySources, characterId,
    memory: { providerId: "hindsight", authorityEpochId: ctx.epochId, providerLineageId: ctx.providerLineageId },
    record: (commit) => ctx.journal.recordPrimaryCommitted({ ...commit, epochId: ctx.epochId, now: now(ctx) }) });
}

async function drain(ctx: Context, input: { characterId: string; target: number; forcePending: boolean }) {
  const scope = { epochId: ctx.epochId, characterId: input.characterId };
  const totals = { writes: 0, sources: 0, confirmedSources: 0, pendingSources: 0, skippedSpans: 0 };
  while (true) {
    assertAuthority(ctx);
    const pending = ctx.journal.pending(scope);
    const entries = ctx.journal.pendingEntries({ ...scope, throughSeq: input.target });
    if (!entries.length && (!pending || !input.forcePending && !pending.source.proofs.some((ref) => ref.seq <= input.target))) break;
    const state = pending ?? ctx.journal.start({ ...scope, source: captureSpan(input.characterId, entries), now: now(ctx) });
    const known = new Set(state.receipts.map((receipt) => receipt.requestId));
    const completed = await ingest(ctx, state);
    assertAuthority(ctx);
    for (const receipt of completed.receipts) if (!known.has(receipt.requestId)) addCoverage(totals, receipt);
    if (completed.gate?.decision === "skip") totals.skippedSpans += 1;
  }
  return totals;
}

function captureSpan(characterId: string, entries: ProvenPrimaryEntry[]) {
  // Match the existing source/metadata domains: split at original message boundaries, never truncate wording.
  const bounded = entries.slice(0, 256); const first = bounded[0];
  if (!first) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  while (bounded.length > 0) {
    const last = bounded.at(-1);
    if (!last) break;
    const span = sanitizeCommittedPrimarySpan({ characterId, fromSeq: first.entry.seq - 1, throughSeq: last.entry.seq, entries: bounded });
    if (span.messages.length === 0 || RetainRequestSchema.shape.content.safeParse(retainedIngestionSource(span.messages).text).success) return span;
    bounded.pop();
  }
  throw new Error("MEMORY_INGESTION_SOURCE_TOO_LARGE");
}

async function ingest(ctx: Context, initial: HindsightIngestionState): Promise<HindsightIngestionState> {
  assertAuthority(ctx);
  let state = initial;
  if (state.gate === null) {
    const gate = await ctx.model.gate(structuredClone(state.source));
    assertAuthority(ctx);
    state = ctx.journal.saveGate({ state, gate, now: now(ctx) });
  }
  if (state.gate?.decision === "keep" && state.batches.length === 0) {
    assertAuthority(ctx);
    state = ctx.journal.prepareBanks({ state, banks: ctx.resolveBanks(state.characterId), now: now(ctx) });
  }
  let failure: string | undefined;
  for (const batch of state.batches) {
    try { state = await ingestBank(ctx, { state, bankId: batch.bank.bankId }); assertAuthority(ctx); }
    catch (error) { assertHindsightIngestionAlive(ctx.signal); failure ??= failureCode(error); }
  }
  if (failure) throw new Error(failure);
  assertAuthority(ctx);
  return ctx.journal.complete({ state, now: now(ctx) });
}

async function ingestBank(ctx: Context, input: { state: HindsightIngestionState; bankId: string }): Promise<HindsightIngestionState> {
  assertAuthority(ctx);
  const { state, bankId } = input;
  const batch = state.batches.find((value) => value.bank.bankId === bankId);
  if (!batch) throw new Error("MEMORY_INGESTION_INCOMPLETE");
  if (state.receipts.some((receipt) => receipt.bankId === bankId) || ctx.journal.pendingCoverage(input)) {
    assertAuthority(ctx);
    return ctx.journal.acknowledgeBank({ state, bankId, now: now(ctx) });
  }
  let result: unknown;
  try {
    result = await ctx.provider.retain({ authorityEpochId: ctx.epochId, requestId: batch.requestId,
      actor: "background-policy", signal: ctx.signal }, structuredClone(batch.request));
  } catch (error) {
    assertAuthority(ctx);
    // A lost response can still have a proven local outbox commit. Reuse that exact durable identity.
    if (!ctx.journal.pendingCoverage(input)) throw error;
  }
  assertAuthority(ctx);
  return ctx.journal.acknowledgeBank({ state, bankId, result, now: now(ctx) });
}

async function flush(ctx: Context, run: HindsightIngestion["run"], request: MemoryFlushRequest) {
  if (!Number.isSafeInteger(request.fromSeq) || request.fromSeq < 0 || !Number.isSafeInteger(request.throughSeq)
    || request.throughSeq < request.fromSeq || !z.string().min(1).max(256).safeParse(request.operationId).success) {
    return { status: "retryable_failure" as const, code: "MEMORY_FLUSH_INCOMPLETE" as const };
  }
  try {
    const result = await run({ characterId: request.characterId, throughSeq: request.throughSeq });
    assertAuthority(ctx);
    if (request.throughSeq < result.eligibilityStartSeq && !result.hasApplicableSource) {
      return { status: "not_required" as const, reason: "before_canonical_ingestion_eligibility" as const };
    }
    if (Math.max(result.throughSeq, result.eligibilityStartSeq - 1) < request.throughSeq) {
      return { status: "retryable_failure" as const, code: "MEMORY_FLUSH_INCOMPLETE" as const };
    }
    return { status: "success" as const, writes: result.writes, throughSeq: Math.max(result.throughSeq, request.throughSeq) };
  } catch (error) {
    return { status: "retryable_failure" as const, code: failureCode(error) === "MEMORY_AUTHORITY_MISMATCH"
      ? "MEMORY_AUTHORITY_FENCED" as const : "MEMORY_FLUSH_INCOMPLETE" as const };
  }
}

function assertAuthority(ctx: Context): void {
  assertHindsightIngestionAlive(ctx.signal);
  const current = ctx.authority.authorityEpoch(ctx.epochId);
  if (current.providerId !== "hindsight" || current.providerLineageId !== ctx.providerLineageId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
}
function addCoverage(totals: { writes: number; sources: number; confirmedSources: number; pendingSources: number }, receipt: HindsightIngestionCoverage): void {
  totals.writes += 1; totals.sources += 1;
  if (receipt.status === "confirmed") totals.confirmedSources += 1; else totals.pendingSources += 1;
}
function now(ctx: HindsightIngestionDeps): string { return z.iso.datetime({ offset: true }).parse(ctx.now?.() ?? new Date().toISOString()); }
function failureCode(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  const own = ["MEMORY_INGESTION_BASELINE_MISSING", "MEMORY_INGESTION_SOURCE_UNPROVEN", "MEMORY_INGESTION_INCOMPLETE",
    "MEMORY_INGESTION_SOURCE_TOO_LARGE", "MEMORY_INGESTION_GATE_FAILED", "MEMORY_INGESTION_RECEIPT_UNPROVEN",
    "MEMORY_INGESTION_STATE_INVALID", "MEMORY_INGESTION_STALE_REVISION", "MEMORY_INGESTION_NOT_FOUND"];
  return MemoryErrorCodeSchema.safeParse(code).success || own.includes(code) ? code : "MEMORY_INGESTION_FAILED";
}
